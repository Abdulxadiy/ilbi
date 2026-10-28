import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from django.db.models import Sum
from django.utils import timezone
from rest_framework.test import APIClient

from apps.catalog.services import ProductService
from apps.inventory.models import Stock, StockBatch
from apps.inventory.services import StockService, StockServiceError
from apps.inventory.services.transfer_service import TenantTransferService
from apps.sales.services import SaleService
from tests.factories import CategoryFactory, EmployeeFactory, ProductVariantFactory, TenantFactory

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def retail_test_mode(settings):
    settings.DEBUG = True


def intake(tenant, owner, variant, quantity, cost, code, expiry):
    return StockService.intake(
        tenant=tenant,
        product_variant=variant,
        quantity=Decimal(quantity),
        cost_price=Decimal(cost),
        created_by=owner,
        batch_code=code,
        expires_on=expiry,
    )


def assert_balance(variant):
    assert (
        StockBatch.objects.filter(product_variant=variant).aggregate(s=Sum("quantity"))["s"]
        == Stock.objects.get(product_variant=variant).quantity
    )


def test_fefo_uses_expired_stock_without_blocking_and_preserves_cost_snapshot_rule(tenant, owner):
    variant = ProductVariantFactory(tenant=tenant)
    today = timezone.localdate()
    intake(tenant, owner, variant, "10", "9000", "LATE", today + timedelta(days=60))
    intake(tenant, owner, variant, "2", "1000", "EXPIRED", today - timedelta(days=1))
    intake(tenant, owner, variant, "3", "2000", "SOON", today + timedelta(days=7))
    sale = SaleService.create_sale(
        tenant=tenant, user=owner, items_data=[{"product_variant_id": variant.pk, "quantity": "4"}], payment_type="cash"
    )[0]
    assert sale.items.get().cost_price == Decimal("2000.00")
    assert StockBatch.objects.get(product_variant=variant, batch_code="EXPIRED").quantity == 0
    assert StockBatch.objects.get(product_variant=variant, batch_code="SOON").quantity == 1
    assert StockBatch.objects.get(product_variant=variant, batch_code="LATE").quantity == 10
    assert_balance(variant)


def test_sale_return_restores_original_batches_and_expiry(tenant, owner):
    variant = ProductVariantFactory(tenant=tenant)
    expiry = timezone.localdate() + timedelta(days=7)
    intake(tenant, owner, variant, "2", "1000", "FIRST", expiry)
    intake(tenant, owner, variant, "3", "3000", "SECOND", expiry + timedelta(days=30))
    sale = SaleService.create_sale(
        tenant=tenant, user=owner, items_data=[{"product_variant_id": variant.pk, "quantity": "4"}], payment_type="cash"
    )[0]
    from apps.sales.services.void_service import VoidService

    VoidService.void_sale_item(sale_item=sale.items.get(), user=owner, reason="Qaytarildi", quantity=Decimal("3"))
    assert StockBatch.objects.get(product_variant=variant, batch_code="FIRST").quantity == 2
    second = StockBatch.objects.get(product_variant=variant, batch_code="SECOND")
    assert second.quantity == 2
    assert second.expires_on == expiry + timedelta(days=30)
    assert_balance(variant)


def test_selected_batch_insufficient_quantity_rolls_back_all_balances(tenant, owner):
    variant = ProductVariantFactory(tenant=tenant)
    intake(tenant, owner, variant, "1", "1000", "ONE", None)
    intake(tenant, owner, variant, "4", "1000", "FOUR", None)
    batch = StockBatch.objects.get(product_variant=variant, batch_code="ONE")
    with pytest.raises(StockServiceError, match="partiyada"):
        StockService.write_off(
            tenant=tenant, product_variant=variant, quantity=Decimal("2"), created_by=owner, batch_id=batch.pk
        )
    batch.refresh_from_db()
    assert batch.quantity == 1
    assert_balance(variant)


def test_legacy_stock_is_seeded_before_first_movement_and_safe_delete_archives(tenant, owner):
    variant = ProductVariantFactory(tenant=tenant)
    Stock.objects.create(tenant=tenant, product_variant=variant, quantity=5, last_cost_price=8000)
    StockService.write_off(tenant=tenant, product_variant=variant, quantity=Decimal("1"), created_by=owner)
    batch = StockBatch.objects.get(product_variant=variant)
    assert batch.quantity == 4
    assert batch.expires_on is None
    assert batch.cost_price == 8000
    assert_balance(variant)
    untouched = ProductVariantFactory(tenant=tenant)
    StockBatch.objects.create(tenant=tenant, product_variant=untouched, quantity=1)
    ProductService.delete(untouched.product)
    untouched.product.refresh_from_db()
    assert not untouched.product.is_active


def test_transfer_and_physical_return_preserve_batch_dates_and_cost(tenant, owner):
    destination = TenantFactory(owner=owner, seller_profile=tenant.seller_profile)
    EmployeeFactory(user=owner, tenant=destination, is_owner=True)
    category = CategoryFactory(tenant=destination)
    variant = ProductVariantFactory(tenant=tenant)
    expiry = timezone.localdate() + timedelta(days=7)
    intake(tenant, owner, variant, "3", "1000", "ONE", expiry)
    intake(tenant, owner, variant, "4", "2000", "TWO", expiry + timedelta(days=30))
    transfer = TenantTransferService.dispatch(
        source=tenant,
        destination_id=destination.pk,
        actor=owner,
        request_key=uuid.uuid4(),
        items=[{"source_variant_id": variant.pk, "quantity": Decimal("5"), "destination_category_id": category.pk}],
    )
    line = transfer.items.get()
    lots = list(
        StockBatch.objects.filter(product_variant=line.destination_variant)
        .order_by("expires_on")
        .values_list("batch_code", "quantity", "cost_price")
    )
    assert lots == [("ONE", Decimal("3"), Decimal("1000")), ("TWO", Decimal("2"), Decimal("2000"))]
    returned = TenantTransferService.start_return(
        transfer_id=transfer.pk,
        source=destination,
        actor=owner,
        request_key=uuid.uuid4(),
        items=[{"original_item_id": line.pk, "quantity": Decimal("4")}],
        note="Qaytish",
    )
    assert returned.items.get().batch_manifest[0]["batch_code"] == "ONE"
    assert list(
        StockBatch.objects.filter(product_variant=variant, quantity__gt=0, batch_code="ONE").values_list(
            "expires_on", flat=True
        )
    ) == [expiry]
    assert_balance(variant)
    assert_balance(line.destination_variant)


def test_batch_api_scopes_shop_and_reports_expiry(tenant, owner):
    variant = ProductVariantFactory(tenant=tenant)
    intake(tenant, owner, variant, "1", "1000", "BAD", timezone.localdate() - timedelta(days=1))
    intake(tenant, owner, variant, "1", "1000", "SOON", timezone.localdate() + timedelta(days=1))
    foreign = ProductVariantFactory()
    intake(foreign.tenant, foreign.tenant.owner, foreign, "1", "1000", "OTHER", None)
    client = APIClient()
    client.force_authenticate(owner)
    response = client.get("/api/v1/inventory/batches/?status=expired")
    assert response.status_code == 200, response.data
    assert len(response.data) == 1
    assert response.data[0]["batch_code"] == "BAD"
    variants = client.get("/api/v1/catalog/variants/").data
    assert variants[0]["expired_batches"][0]["batch_code"] == "BAD"


def test_b2b_partial_accept_and_return_restore_the_remaining_batch(tenant, owner):
    from apps.sales.services import B2BTransferService
    from tests.factories import CounterpartyFactory

    destination = TenantFactory()
    EmployeeFactory(user=destination.owner, tenant=destination, is_owner=True)
    category = CategoryFactory(tenant=destination)
    variant = ProductVariantFactory(tenant=tenant)
    expiry = timezone.localdate() + timedelta(days=10)
    intake(tenant, owner, variant, "3", "1000", "FIRST", expiry)
    intake(tenant, owner, variant, "4", "2000", "SECOND", expiry + timedelta(days=30))
    counterparty = CounterpartyFactory(tenant=tenant, target_tenant=destination)
    sale = SaleService.create_sale(
        tenant=tenant,
        user=owner,
        counterparty=counterparty,
        payment_type="debt",
        items_data=[{"product_variant_id": variant.pk, "quantity": "7", "unit_price": "5000"}],
    )[0]
    item = sale.items.get()
    accepted = B2BTransferService.accept_transfer(
        sale=sale,
        tenant=destination,
        accepting_user=destination.owner,
        items_payload=[{"sale_item_id": item.pk, "accepted_quantity": Decimal("4"), "target_category_id": category.pk}],
    )
    destination_variant = accepted.items.get().b2b_target_variant
    lots = list(StockBatch.objects.filter(product_variant=destination_variant).order_by("pk"))
    assert [(lot.batch_code, lot.quantity, lot.cost_price) for lot in lots] == [
        ("FIRST", Decimal("3"), Decimal("5000")),
        ("SECOND", Decimal("1"), Decimal("5000")),
    ]
    assert lots[0].expires_on == expiry
    rejected = B2BTransferService.reject_transfer(
        sale=accepted, tenant=destination, rejecting_user=destination.owner, reason="Qoldiq qaytadi"
    )
    for key, quantity in (("RETURN-1", "2"), ("RETURN-2", "1")):
        B2BTransferService.receive_return(
            sale=rejected,
            tenant=tenant,
            receiving_user=owner,
            reason="Qaytib keldi",
            idempotency_key=key,
            items_payload=[{"sale_item_id": item.pk, "quantity": Decimal(quantity)}],
        )
    first = StockBatch.objects.get(product_variant=variant, batch_code="FIRST")
    second = StockBatch.objects.get(product_variant=variant, batch_code="SECOND")
    assert first.quantity == 0
    assert second.quantity == 3
    assert second.cost_price == 2000
    assert second.expires_on == expiry + timedelta(days=30)
    assert_balance(variant)
    assert_balance(destination_variant)


def test_batches_preserve_existing_inventory_valuation_rule(tenant, owner):
    from apps.analytics.services.analytics_service import AnalyticsService

    variant = ProductVariantFactory(tenant=tenant)
    intake(tenant, owner, variant, "2", "1000", "FIRST", None)
    intake(tenant, owner, variant, "3", "2000", "SECOND", None)
    result = AnalyticsService.get_dashboard_summary(tenant=tenant)
    assert Decimal(result["store_overview"]["inventory_cost_value_uzs"]) == Decimal("10000")


def test_batch_migration_preserves_existing_stock_once(tenant):
    from importlib import import_module
    from types import SimpleNamespace

    from django.apps import apps
    from django.db import connection

    variant = ProductVariantFactory(tenant=tenant)
    Stock.objects.create(tenant=tenant, product_variant=variant, quantity=Decimal("2.5"), last_cost_price=1234)
    migration = import_module("apps.inventory.migrations.0012_existing_stock_batches")
    editor = SimpleNamespace(connection=connection)
    migration.preserve_stock(apps, editor)
    migration.preserve_stock(apps, editor)
    batch = StockBatch.objects.get(product_variant=variant)
    assert batch.quantity == Decimal("2.5")
    assert batch.cost_price == 1234
    assert batch.expires_on is None
    assert_balance(variant)


def test_batch_and_single_intake_record_supplier(tenant, owner):
    variant = ProductVariantFactory(tenant=tenant)
    movement = StockService.intake(
        tenant=tenant,
        product_variant=variant,
        quantity=Decimal("5"),
        cost_price=Decimal("1500"),
        created_by=owner,
        supplier="Akrom Distribyutor",
    )
    assert movement.supplier == "Akrom Distribyutor"
    batch = StockBatch.objects.get(product_variant=variant)
    assert batch.supplier == "Akrom Distribyutor"

    # Test batch intake
    variant2 = ProductVariantFactory(tenant=tenant)
    movements = StockService.batch_intake(
        tenant=tenant,
        items=[
            {"product_variant": variant2, "quantity": Decimal("10"), "cost_price": Decimal("2000"), "batch_code": "B1"}
        ],
        created_by=owner,
        supplier="Global Trade LLC",
        faktura_number="FAK-101",
    )
    assert movements[0].supplier == "Global Trade LLC"
    batch2 = StockBatch.objects.get(product_variant=variant2)
    assert batch2.supplier == "Global Trade LLC"


def test_supplier_visibility_permission_and_endpoint(tenant, owner):
    from apps.accounts.models import Employee
    from apps.permissions.models import Permission

    variant = ProductVariantFactory(tenant=tenant)
    StockService.intake(
        tenant=tenant,
        product_variant=variant,
        quantity=Decimal("10"),
        cost_price=Decimal("1200"),
        created_by=owner,
        supplier="Maxfiy Ta’minotchi",
        note="Ta’minotchi: Maxfiy Ta’minotchi | Ehtiyot qism",
    )

    client = APIClient()

    # 1. Owner can see supplier in batches list
    client.force_authenticate(user=owner)
    res = client.get("/api/v1/inventory/batches/", HTTP_X_TENANT_ID=str(tenant.id))
    assert res.status_code == 200
    assert any(b.get("supplier") == "Maxfiy Ta’minotchi" for b in res.data)

    # 1b. Owner can see suppliers in /suppliers/ endpoint
    res_suppliers = client.get("/api/v1/inventory/suppliers/", HTTP_X_TENANT_ID=str(tenant.id))
    assert res_suppliers.status_code == 200
    assert "Maxfiy Ta’minotchi" in res_suppliers.data

    # 2. Staff without inventory.view_supplier CANNOT see supplier
    perm_view_stock = Permission.objects.get(category="inventory", codename="view_stock")
    emp = EmployeeFactory(tenant=tenant)
    emp.permissions.set([perm_view_stock])
    staff_user = emp.user

    client.force_authenticate(user=staff_user)
    res_staff = client.get("/api/v1/inventory/batches/", HTTP_X_TENANT_ID=str(tenant.id))
    assert res_staff.status_code == 200
    assert len(res_staff.data) > 0
    # supplier field is stripped / popped by SensitiveSupplierSerializerMixin
    for item in res_staff.data:
        assert "supplier" not in item

    # Staff without view_supplier gets 403 on /suppliers/
    res_staff_suppliers = client.get("/api/v1/inventory/suppliers/", HTTP_X_TENANT_ID=str(tenant.id))
    assert res_staff_suppliers.status_code == 403

    # Check StockMovement serializer note masking
    res_movements = client.get("/api/v1/inventory/movements/", HTTP_X_TENANT_ID=str(tenant.id))
    assert res_movements.status_code == 200
    for mov in res_movements.data:
        assert "supplier" not in mov
        assert "Maxfiy Ta’minotchi" not in mov.get("note", "")

    # 3. Grant inventory.view_supplier to staff -> now they can see it
    perm_view_supplier, _ = Permission.objects.get_or_create(
        category="inventory", codename="view_supplier",
        defaults={"name": "Ta’minotchi ma’lumotlarini ko‘rish"}
    )
    employee = Employee.objects.get(user=staff_user, tenant=tenant)
    employee.permissions.add(perm_view_supplier)

    client.force_authenticate(user=staff_user)
    res_allowed = client.get("/api/v1/inventory/batches/", HTTP_X_TENANT_ID=str(tenant.id))
    assert res_allowed.status_code == 200
    assert any(b.get("supplier") == "Maxfiy Ta’minotchi" for b in res_allowed.data)

    res_allowed_suppliers = client.get("/api/v1/inventory/suppliers/", HTTP_X_TENANT_ID=str(tenant.id))
    assert res_allowed_suppliers.status_code == 200
    assert "Maxfiy Ta’minotchi" in res_allowed_suppliers.data
