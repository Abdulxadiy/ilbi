from datetime import datetime
from datetime import timezone as dt_timezone
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.cashbox.models import CashExpense, CashIncome, DailyCashReport
from apps.catalog.models import Product
from apps.core.models import AuditAction, AuditLog
from apps.core.services.audit_service import AuditService
from apps.inventory.models import StockMovement
from tests.factories import (
    CategoryFactory,
    CounterpartyFactory,
    DebtPaymentFactory,
    EmployeeFactory,
    ProductFactory,
    ProductVariantFactory,
    SaleFactory,
    SaleItemFactory,
    StaffFactory,
    TenantFactory,
)

pytestmark = pytest.mark.django_db
URL = "/api/v1/audit/history/"


def client_for(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


def movement(tenant, actor, **kwargs):
    variant = ProductVariantFactory(tenant=tenant, product__tenant=tenant, product__category__tenant=tenant)
    kind = kwargs.pop("type", "kirim")
    direction = kwargs.pop("direction", "in")
    return StockMovement.objects.create(
        tenant=tenant,
        created_by=actor,
        product_variant=variant,
        type=kind,
        direction=direction,
        quantity="5",
        cost_price="1000",
        **kwargs,
    )


def test_history_unifies_existing_business_data_in_reverse_order(tenant, owner):
    sale = SaleFactory(tenant=tenant, sold_by=owner, total_amount="50000")
    stock = movement(tenant, owner)
    audit = AuditService.log(action=AuditAction.EMPLOYEE_UPDATE, tenant=tenant, actor=owner, description="Jamoa")
    cp = CounterpartyFactory(tenant=tenant)
    DebtPaymentFactory(counterparty=cp, recorded_by=owner)
    CashIncome.objects.create(tenant=tenant, recorded_by=owner, amount="100", source="Sinov")
    CashExpense.objects.create(tenant=tenant, recorded_by=owner, amount="50", category="Transport")
    DailyCashReport.objects.create(tenant=tenant, closed_by=owner)
    response = client_for(owner).get(URL)
    assert response.status_code == 200
    rows = response.data["results"]
    assert {row["source"] for row in rows} == {
        "sale",
        "stock",
        "audit",
        "debt",
        "income",
        "expense",
        "shift_open",
        "shift_close",
    }
    assert [row["created_at"] for row in rows] == sorted([row["created_at"] for row in rows], reverse=True)
    assert f"sale:{sale.pk}" in {row["id"] for row in rows}
    assert f"stock:{stock.pk}" in {row["id"] for row in rows}
    assert f"audit:{audit.pk}" in {row["id"] for row in rows}


def test_sale_stock_lines_and_stock_adjustment_audit_do_not_duplicate_events(tenant, owner):
    sale = SaleFactory(tenant=tenant, sold_by=owner)
    movement(tenant, owner, sale=sale, type="sotuv", direction="out")
    stock = movement(tenant, owner)
    AuditService.log(
        action=AuditAction.STOCK_ADJUSTMENT,
        actor=owner,
        tenant=tenant,
        target_model="StockMovement",
        target_id=str(stock.pk),
    )
    rows = client_for(owner).get(URL).data["results"]
    assert [row["source"] for row in rows].count("stock") == 1
    assert not any(row["source"] == "audit" for row in rows)


@pytest.mark.parametrize("category,expected", [("sales", "sale"), ("inventory", "stock"), ("team", "audit")])
def test_history_categories_filter_at_database_level(tenant, owner, category, expected):
    SaleFactory(tenant=tenant, sold_by=owner)
    movement(tenant, owner)
    AuditService.log(action=AuditAction.EMPLOYEE_HIRE, tenant=tenant, actor=owner)
    response = client_for(owner).get(URL, {"category": category})
    assert response.status_code == 200
    assert response.data["count"] == 1
    assert response.data["results"][0]["source"] == expected


def test_tenant_isolation_applies_to_list_and_every_detail(tenant, owner):
    foreign = TenantFactory()
    sale = SaleFactory(tenant=foreign)
    stock = movement(foreign, foreign.owner)
    audit = AuditService.log(action=AuditAction.EMPLOYEE_HIRE, tenant=foreign, actor=foreign.owner)
    client = client_for(owner)
    assert client.get(URL, {"tenant_id": foreign.pk, "category": "sales"}).data["count"] == 0
    for source, obj in (("sale", sale), ("stock", stock), ("audit", audit)):
        assert client.get(f"{URL}{source}/{obj.pk}/").status_code == 404
    assert client.get(URL, HTTP_X_TENANT_ID=str(foreign.pk)).status_code == 403


def test_admin_can_filter_tenant_and_open_receipt(tenant, owner, platform_admin):
    sale = SaleFactory(tenant=tenant, sold_by=owner, receipt_number="HISTORY-001", total_amount="12000")
    variant = ProductVariantFactory(tenant=tenant, product__tenant=tenant, product__category__tenant=tenant)
    SaleItemFactory(
        sale=sale,
        product_variant=variant,
        product_snapshot={
            "version": 1,
            "product_name": "Tarix tovari",
            "product_variant_name": "Standart",
            "unit": "dona",
        },
    )
    foreign_sale = SaleFactory()
    client = client_for(platform_admin)
    response = client.get(URL, {"tenant_id": tenant.pk, "category": "sales"})
    assert response.data["count"] == 1
    assert response.data["results"][0]["reference"] == "HISTORY-001"
    detail = client.get(f"{URL}sale/{sale.pk}/", {"tenant_id": tenant.pk})
    assert detail.status_code == 200
    assert detail.data["sale"]["id"] == sale.pk
    assert detail.data["sale"]["items"][0]["product_name"] == "Tarix tovari"
    assert client.get(f"{URL}sale/{foreign_sale.pk}/", {"tenant_id": tenant.pk}).status_code == 404


def test_stock_detail_shows_actual_intake_quantity_and_cost(tenant, owner):
    stock = movement(tenant, owner, note="Faktura #123")
    response = client_for(owner).get(f"{URL}stock/{stock.pk}/")
    assert response.status_code == 200
    assert response.data["event"]["quantity"] == "5.000"
    fields = {row["label"]: row["value"] for row in response.data["details"]["fields"]}
    assert Decimal(fields["Jami tannarx"]) == Decimal("5000")
    assert response.data["details"]["note"] == "Faktura #123"


def test_audit_references_never_expose_another_tenants_receipt(tenant, owner):
    sale = SaleFactory(receipt_number="FOREIGN_PRIVATE_RECEIPT")
    audit = AuditService.log(
        action=AuditAction.B2B_RETURN_PENDING,
        tenant=tenant,
        actor=owner,
        target_model="Sale",
        target_id=str(sale.pk),
        description="Local receiving event",
    )
    detail = client_for(owner).get(f"{URL}audit/{audit.pk}/")
    assert detail.status_code == 200
    assert detail.data["sale"] is None
    assert detail.data["event"]["sale_id"] is None
    assert "FOREIGN_PRIVATE_RECEIPT" not in str(detail.data)


def test_receiving_intake_linked_to_a_foreign_sale_remains_visible(tenant, owner):
    foreign_sale = SaleFactory(receipt_number="PRIVATE_SENDER_RECEIPT")
    stock = movement(tenant, owner, sale=foreign_sale)
    client = client_for(owner)
    rows = client.get(URL, {"category": "inventory"}).data["results"]
    assert [row["id"] for row in rows] == [f"stock:{stock.pk}"]
    detail = client.get(f"{URL}stock/{stock.pk}/")
    assert detail.status_code == 200
    assert detail.data["sale"] is None
    assert "PRIVATE_SENDER_RECEIPT" not in str(detail.data)


def test_item_void_audit_opens_the_same_local_receipt(tenant, owner):
    sale = SaleFactory(tenant=tenant, sold_by=owner)
    item = SaleItemFactory(sale=sale)
    audit = AuditService.log(
        action=AuditAction.VOID_SALE, tenant=tenant, actor=owner, target_model="SaleItem", target_id=str(item.pk)
    )
    detail = client_for(owner).get(f"{URL}audit/{audit.pk}/")
    assert detail.status_code == 200
    assert detail.data["sale"]["id"] == sale.pk


def test_staff_and_unauthenticated_cannot_read_private_business_history(tenant):
    staff = StaffFactory()
    EmployeeFactory(user=staff, tenant=tenant)
    assert APIClient().get(URL).status_code == 401
    assert client_for(staff).get(URL).status_code == 403
    assert client_for(staff).get(f"{URL}sale/1/").status_code == 403


@pytest.mark.parametrize(
    "params",
    [
        {"category": "unknown"},
        {"actor": "invalid"},
        {"actor": "0"},
        {"date_from": "bad-date"},
        {"date_from": "2026-10-19", "date_to": "2026-10-18"},
    ],
)
def test_invalid_filters_return_400(tenant, owner, params):
    assert client_for(owner).get(URL, params).status_code == 400


def test_admin_invalid_tenant_filter_is_validated(platform_admin):
    assert client_for(platform_admin).get(URL, {"tenant_id": "invalid"}).status_code == 400


def test_search_actor_and_tashkent_date_boundary(tenant, owner):
    first = SaleFactory(tenant=tenant, sold_by=owner, receipt_number="FIND-ME")
    second = SaleFactory(tenant=tenant, sold_by=owner, receipt_number="NOT-THIS-DAY")
    type(first).objects.filter(pk=first.pk).update(created_at=datetime(2026, 10, 18, 19, 0, tzinfo=dt_timezone.utc))
    type(second).objects.filter(pk=second.pk).update(created_at=datetime(2026, 10, 18, 18, 59, tzinfo=dt_timezone.utc))
    response = client_for(owner).get(URL, {"category": "sales", "date_from": "2026-10-19", "date_to": "2026-10-19"})
    assert [row["object_id"] for row in response.data["results"]] == [first.pk]
    assert client_for(owner).get(URL, {"search": "FIND-ME"}).data["count"] == 1
    assert client_for(owner).get(URL, {"category": "sales", "actor": owner.pk}).data["count"] == 2


def test_pagination_is_stable_for_equal_timestamps_and_avoids_n_plus_one(tenant, owner):
    sales = SaleFactory.create_batch(35, tenant=tenant, sold_by=owner)
    type(sales[0]).objects.filter(tenant=tenant).update(created_at=datetime(2026, 10, 19, tzinfo=dt_timezone.utc))
    client = client_for(owner)
    with CaptureQueriesContext(connection) as queries:
        first = client.get(URL, {"category": "sales", "page": 1})
    second = client.get(URL, {"category": "sales", "page": 2})
    ids = [row["object_id"] for row in first.data["results"] + second.data["results"]]
    assert ids == sorted([sale.pk for sale in sales], reverse=True)
    assert first.data["count"] == 35
    assert len(queries) < 15


def test_catalog_create_edit_archive_restore_delete_are_recorded(tenant, owner):
    client = client_for(owner)
    category = CategoryFactory(tenant=tenant)
    response = client.post(
        "/api/v1/catalog/products/",
        {
            "name": "Original tovar",
            "category_id": category.pk,
            "price_partner": "1000",
            "price_min": "1500",
            "price_recommended": "2000",
        },
        format="json",
    )
    assert response.status_code == 201
    pk = response.data["id"]
    created = AuditLog.objects.get(action=AuditAction.CATALOG_CREATE, target_model="Product", target_id=str(pk))
    assert created.actor_id == owner.pk
    assert created.changes["snapshot"]["name"] == "Original tovar"
    assert client.patch(f"/api/v1/catalog/products/{pk}/", {"name": "Yangi tovar"}, format="json").status_code == 200
    edit = AuditLog.objects.get(action=AuditAction.CATALOG_UPDATE, target_model="Product", target_id=str(pk))
    assert edit.changes["name"] == {"old": "Original tovar", "new": "Yangi tovar"}
    # No-op PATCH must not manufacture another event.
    client.patch(f"/api/v1/catalog/products/{pk}/", {"name": "Yangi tovar"}, format="json")
    assert (
        AuditLog.objects.filter(action=AuditAction.CATALOG_UPDATE, target_id=str(pk), target_model="Product").count()
        == 1
    )
    assert client.post(f"/api/v1/catalog/products/{pk}/archive/").status_code == 200
    assert client.post(f"/api/v1/catalog/products/{pk}/unarchive/").status_code == 200
    assert client.delete(f"/api/v1/catalog/products/{pk}/").status_code == 204
    assert not Product.objects.filter(pk=pk).exists()
    detail = client.get(f"{URL}audit/{created.pk}/")
    assert detail.data["details"]["snapshot"]["name"] == "Original tovar"
    actions = set(AuditLog.objects.filter(target_model="Product", target_id=str(pk)).values_list("action", flat=True))
    assert {"catalog_create", "catalog_update", "catalog_archive", "catalog_restore", "catalog_delete"} <= actions


def test_failed_or_foreign_catalog_edit_does_not_leave_history(tenant, owner):
    product = ProductFactory(tenant=tenant, category__tenant=tenant)
    client = client_for(owner)
    assert client.patch(f"/api/v1/catalog/products/{product.pk}/", {"name": ""}, format="json").status_code == 400
    foreign = ProductFactory()
    assert (
        client.patch(f"/api/v1/catalog/products/{foreign.pk}/", {"name": "Blocked"}, format="json").status_code == 404
    )
    assert not AuditLog.objects.filter(action__startswith="catalog_").exists()


def test_catalog_edit_and_audit_are_atomic(tenant, owner):
    product = ProductFactory(tenant=tenant, category__tenant=tenant, name="Before")
    with patch(
        "apps.core.services.catalog_activity.AuditService.log", side_effect=RuntimeError("Synthetic audit failure")
    ):
        with pytest.raises(RuntimeError, match="Synthetic audit"):
            client_for(owner).patch(f"/api/v1/catalog/products/{product.pk}/", {"name": "After"}, format="json")
    product.refresh_from_db()
    assert product.name == "Before"
