import pytest
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.models import AuditAction, AuditLog
from apps.core.services.audit_service import AuditService
from tests.factories import EmployeeFactory, OwnerFactory, PlatformAdminFactory, StaffFactory, TenantFactory

pytestmark = pytest.mark.django_db
AUDIT_LOGS_URL = "/api/v1/audit/logs/"


@pytest.fixture
def api_client():
    return APIClient()


class TestAuditLogAPI:
    def test_unauthenticated_request_is_denied(self, api_client):
        response = api_client.get(AUDIT_LOGS_URL)
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_staff_is_denied_access(self, api_client, tenant):
        staff_user = StaffFactory()
        EmployeeFactory(user=staff_user, tenant=tenant, is_active=True)
        api_client.force_authenticate(user=staff_user)

        response = api_client.get(AUDIT_LOGS_URL)
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_owner_sees_only_own_tenant_audit_logs(self, api_client, tenant, owner):
        other_tenant = TenantFactory()
        other_owner = other_tenant.owner

        # Create logs for this tenant
        AuditService.log(
            action=AuditAction.EMPLOYEE_HIRE,
            actor=owner,
            tenant=tenant,
            description="Tenant 1 log",
        )

        # Create logs for other tenant
        AuditService.log(
            action=AuditAction.EMPLOYEE_FIRE,
            actor=other_owner,
            tenant=other_tenant,
            description="Tenant 2 log",
        )

        api_client.force_authenticate(user=owner)
        response = api_client.get(AUDIT_LOGS_URL)
        assert response.status_code == status.HTTP_200_OK

        results = response.data["results"]
        assert len(results) == 1
        assert results[0]["tenant"] == tenant.id
        assert results[0]["description"] == "Tenant 1 log"

    def test_platform_admin_can_view_all_and_filter_by_tenant(self, api_client, tenant, owner, platform_admin):
        other_tenant = TenantFactory()

        AuditService.log(
            action=AuditAction.EMPLOYEE_HIRE,
            actor=owner,
            tenant=tenant,
            description="Tenant 1 event",
        )
        AuditService.log(
            action=AuditAction.EMPLOYEE_FIRE,
            actor=other_tenant.owner,
            tenant=other_tenant,
            description="Tenant 2 event",
        )

        api_client.force_authenticate(user=platform_admin)

        # No filter: sees all logs
        response = api_client.get(AUDIT_LOGS_URL)
        assert response.status_code == status.HTTP_200_OK
        assert response.data["count"] >= 2

        # Filter by tenant_id
        response = api_client.get(f"{AUDIT_LOGS_URL}?tenant_id={tenant.id}")
        assert response.status_code == status.HTTP_200_OK
        assert response.data["count"] == 1
        assert response.data["results"][0]["tenant"] == tenant.id

    def test_filtering_by_action_and_actor(self, api_client, tenant, owner):
        staff = StaffFactory()

        AuditService.log(
            action=AuditAction.PRICE_CHANGE,
            actor=owner,
            tenant=tenant,
        )
        AuditService.log(
            action=AuditAction.STOCK_ADJUSTMENT,
            actor=staff,
            tenant=tenant,
        )

        api_client.force_authenticate(user=owner)

        # Filter by action
        res = api_client.get(f"{AUDIT_LOGS_URL}?action={AuditAction.PRICE_CHANGE}")
        assert res.status_code == status.HTTP_200_OK
        assert res.data["count"] == 1
        assert res.data["results"][0]["action"] == AuditAction.PRICE_CHANGE

        # Filter by actor
        res = api_client.get(f"{AUDIT_LOGS_URL}?actor={staff.id}")
        assert res.status_code == status.HTTP_200_OK
        assert res.data["count"] == 1
        assert res.data["results"][0]["actor"] == staff.id

    def test_price_change_via_catalog_patch_records_audit_log(self, api_client, tenant, owner):
        from apps.catalog.models import ProductVariant
        from tests.factories import ProductVariantFactory

        variant = ProductVariantFactory(
            tenant=tenant,
            price_partner="1000.00",
            price_min="1200.00",
            price_recommended="1500.00",
        )

        api_client.force_authenticate(user=owner)
        patch_response = api_client.patch(
            f"/api/v1/catalog/variants/{variant.id}/",
            {"price_recommended": "1800.00"},
            format="json",
        )
        assert patch_response.status_code == status.HTTP_200_OK

        # Verify audit log was recorded
        log = AuditLog.objects.filter(
            action=AuditAction.PRICE_CHANGE,
            target_id=str(variant.id),
        ).first()
        assert log is not None
        assert log.actor == owner
        assert log.tenant == tenant
        assert "price_recommended" in log.changes
        assert log.changes["price_recommended"]["new"] == "1800.00"
