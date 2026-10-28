from decimal import Decimal
import pytest
from django.core.exceptions import ValidationError
from django.test import RequestFactory

from apps.accounts.services.employee_service import EmployeeService
from apps.core.models import AuditAction, AuditLog
from apps.core.services.audit_service import AuditService
from apps.inventory.services import StockService
from apps.sales.models import Sale, SaleItem
from apps.sales.services.void_service import VoidService
from apps.tenants.services import TenantService
from tests.factories import (
    CategoryFactory,
    EmployeeFactory,
    OwnerFactory,
    PlatformAdminFactory,
    ProductVariantFactory,
    StaffFactory,
    TenantFactory,
)

pytestmark = pytest.mark.django_db


class TestAuditLogImmutability:
    def test_audit_log_creation_and_attributes(self, tenant, owner):
        log = AuditService.log(
            action=AuditAction.PRICE_CHANGE,
            actor=owner,
            tenant=tenant,
            target_model="ProductVariant",
            target_id="123",
            changes={"price": {"old": "1000", "new": "1500"}},
            description="Price increase",
        )
        assert log.id is not None
        assert log.action == AuditAction.PRICE_CHANGE
        assert log.actor == owner
        assert log.tenant == tenant
        assert log.changes["price"]["new"] == "1500"

    def test_audit_log_cannot_be_updated_via_save(self, tenant, owner):
        log = AuditService.log(
            action=AuditAction.PRICE_CHANGE,
            actor=owner,
            tenant=tenant,
        )
        log.description = "Tampered description"
        with pytest.raises(ValidationError, match="immutable and cannot be updated"):
            log.save()

    def test_audit_log_cannot_be_deleted_via_instance(self, tenant, owner):
        log = AuditService.log(
            action=AuditAction.PRICE_CHANGE,
            actor=owner,
            tenant=tenant,
        )
        with pytest.raises(ValidationError, match="append-only and cannot be deleted"):
            log.delete()

    def test_audit_log_cannot_be_bulk_deleted_or_updated(self, tenant, owner):
        log = AuditService.log(
            action=AuditAction.PRICE_CHANGE,
            actor=owner,
            tenant=tenant,
        )
        with pytest.raises(ValidationError, match="cannot be deleted"):
            AuditLog.objects.filter(pk=log.pk).delete()

        with pytest.raises(ValidationError, match="cannot be updated"):
            AuditLog.objects.filter(pk=log.pk).update(description="Hacked")

    def test_audit_service_extracts_ip_and_user_agent_from_request(self, tenant, owner):
        rf = RequestFactory()
        req = rf.get(
            "/api/v1/catalog/products/",
            HTTP_X_FORWARDED_FOR="198.51.100.42, 10.0.0.1",
            HTTP_USER_AGENT="Mozilla/5.0 SecurityTester",
        )
        req.user = owner
        req.tenant = tenant

        log = AuditService.log(
            action=AuditAction.PRICE_CHANGE,
            request=req,
            target_model="ProductVariant",
            target_id="1",
        )
        assert log.ip_address == "198.51.100.42"
        assert log.user_agent == "Mozilla/5.0 SecurityTester"
        assert log.actor == owner
        assert log.tenant == tenant


class TestAuditTriggersOnCriticalServices:
    def test_employee_hire_and_fire_trigger_audit_logs(self, tenant, owner):
        staff = StaffFactory()
        emp = EmployeeService.hire(
            target_user=staff,
            tenant=tenant,
            hired_by=owner,
            position="Cashier",
        )

        hire_log = AuditLog.objects.filter(
            action=AuditAction.EMPLOYEE_HIRE,
            target_id=str(emp.id),
        ).first()
        assert hire_log is not None
        assert hire_log.actor == owner
        assert hire_log.tenant == tenant
        assert hire_log.changes["role"] == "staff"

        # Fire employee
        EmployeeService.fire(target_user=staff, fired_by=owner)
        fire_log = AuditLog.objects.filter(
            action=AuditAction.EMPLOYEE_FIRE,
            target_id=str(emp.id),
        ).first()
        assert fire_log is not None
        assert fire_log.actor == owner
        assert fire_log.changes["is_active"]["new"] is False

    def test_tenant_owner_transfer_triggers_audit_log(self, tenant, owner, platform_admin):
        new_owner = OwnerFactory()
        TenantService.change_owner(
            tenant=tenant,
            new_owner=new_owner,
            changed_by=platform_admin,
        )

        transfer_log = AuditLog.objects.filter(
            action=AuditAction.OWNER_TRANSFER,
            target_id=str(tenant.id),
        ).first()
        assert transfer_log is not None
        assert transfer_log.actor == platform_admin
        assert transfer_log.changes["owner_id"]["old"] == owner.id
        assert transfer_log.changes["owner_id"]["new"] == new_owner.id

    def test_void_sale_triggers_audit_log(self, tenant, owner):
        sale = Sale.objects.create(
            tenant=tenant,
            sold_by=owner,
            receipt_number="INV-AUDIT-001",
            total_amount=Decimal("50000.00"),
            payment_type=Sale.PAYMENT_CASH,
            status=Sale.STATUS_COMPLETED,
        )
        variant = ProductVariantFactory(tenant=tenant)
        SaleItem.objects.create(
            tenant=tenant,
            sale=sale,
            product_variant=variant,
            quantity=Decimal("2"),
            cost_price=Decimal("15000.00"),
            unit_price=Decimal("25000.00"),
            total_price=Decimal("50000.00"),
        )
        StockService.intake(
            tenant=tenant,
            product_variant=variant,
            quantity=Decimal("10"),
            cost_price=Decimal("15000"),
            created_by=owner,
        )

        VoidService.void_sale(sale=sale, user=owner, reason="Customer error")

        void_log = AuditLog.objects.filter(
            action=AuditAction.VOID_SALE,
            target_id=str(sale.id),
        ).first()
        assert void_log is not None
        assert void_log.actor == owner
        assert void_log.tenant == tenant
        assert void_log.changes["status"]["new"] == Sale.STATUS_VOIDED

    def test_stock_adjust_and_write_off_trigger_audit_logs(self, tenant, owner):
        variant = ProductVariantFactory(tenant=tenant)
        StockService.intake(
            tenant=tenant,
            product_variant=variant,
            quantity=Decimal("10"),
            cost_price=Decimal("15000"),
            created_by=owner,
        )

        # Adjust
        adj_move = StockService.adjust(
            tenant=tenant,
            product_variant=variant,
            quantity=Decimal("2"),
            direction="in",
            created_by=owner,
            note="Found extra box",
        )
        adj_log = AuditLog.objects.filter(
            action=AuditAction.STOCK_ADJUSTMENT,
            target_id=str(adj_move.id),
        ).first()
        assert adj_log is not None
        assert adj_log.changes["direction"] == "in"

        # Write off
        wo_move = StockService.write_off(
            tenant=tenant,
            product_variant=variant,
            quantity=Decimal("1"),
            created_by=owner,
            note="Expired",
        )
        wo_log = AuditLog.objects.filter(
            action=AuditAction.STOCK_ADJUSTMENT,
            target_id=str(wo_move.id),
        ).first()
        assert wo_log is not None
        assert wo_log.changes["type"] == "isrofgarchilik"
