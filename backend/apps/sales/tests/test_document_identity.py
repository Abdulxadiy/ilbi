"""Frozen private document parties, explicit legacy provenance and public redaction."""
from copy import deepcopy
from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from api.v1.sales.serializers import SaleOutputSerializer
from apps.inventory.services import StockService
from apps.sales.models import Sale, SaleItem
from tests.factories import CounterpartyFactory, ProductVariantFactory, TenantFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def variant(tenant, owner):
    value = ProductVariantFactory(tenant=tenant, product__tenant=tenant, product__category__tenant=tenant)
    StockService.intake(tenant=tenant, product_variant=value, quantity=10, cost_price=50, created_by=owner)
    return value


@pytest.mark.parametrize("linked", [False, True])
@pytest.mark.parametrize("visible", [False, True])
def test_saved_parties_survive_changes_without_becoming_public(owner, tenant, variant, linked, visible):
    owner.first_name, owner.last_name = "Original", "Cashier"
    owner.save(update_fields=["first_name", "last_name"])
    tenant.name, tenant.address = "Original shop", "Saved address"
    tenant.receipt_show_cashier = tenant.receipt_show_customer = visible
    tenant.save()
    destination = TenantFactory(name="Original destination") if linked else None
    cp = CounterpartyFactory(
        tenant=tenant, name="Original buyer", phone_number="+998991234881", target_tenant=destination
    )
    client = APIClient()
    client.force_authenticate(owner)
    client.credentials(HTTP_X_TENANT_ID=str(tenant.pk))
    body = {"items": [{"product_variant_id": variant.pk, "quantity": "2", "unit_price": "100.00"}],
            "payment_type": "debt", "counterparty_id": cp.pk, "idempotency_key": "frozen-parties"}
    with patch("apps.sales.services.debt_service.DebtService._notify_owner_telegram"):
        result = client.post("/api/v1/sales/", body, format="json")
    assert result.status_code == 201, result.data
    sale = Sale.objects.get(pk=result.data[0]["id"])
    original = deepcopy(sale.receipt_snapshot)
    owner.first_name, owner.last_name = "Changed", "Cashier"
    owner.save(update_fields=["first_name", "last_name"])
    cp.name, cp.phone_number = "Changed buyer", "+998991234882"
    cp.save(update_fields=["name", "phone_number"])
    tenant.name, tenant.address = "Changed shop", "Changed address"
    tenant.save(update_fields=["name", "address"])
    if destination:
        destination.name = "Changed destination"
        destination.save(update_fields=["name"])
    detail = client.get(f"/api/v1/sales/{sale.pk}/")
    assert detail.status_code == 200
    assert detail.data["sold_by_name"] == "Original Cashier"
    assert detail.data["counterparty_name"] == "Original buyer"
    assert detail.data["counterparty_phone"] == "+998991234881"
    assert detail.data["tenant_name"] == "Original shop" and detail.data["tenant_address"] == "Saved address"
    assert detail.data["items"][0]["receipt_product_snapshot_version"] == 1
    assert detail.data.get("b2b_target_tenant_name") == ("Original destination" if linked else None)
    for term in ("Original buyer", "Original Cashier", "+998991234881", "Changed buyer"):
        found = client.get("/api/v1/sales/", {"search": term, "page": 1})
        assert found.status_code == 200 and [row["id"] for row in found.data["results"]] == [sale.pk], term
    if linked:
        found = client.get("/api/v1/sales/", {"search": "Original destination", "page": 1})
        assert found.status_code == 200 and found.data["results"][0]["id"] == sale.pk
        retail = client.get("/api/v1/sales/", {"b2b_only": "false", "page": 1})
        assert retail.status_code == 200 and retail.data["count"] == 0
        b2b = client.get("/api/v1/sales/", {"b2b_only": "true", "page": 1})
        assert b2b.status_code == 200 and b2b.data["results"][0]["id"] == sale.pk
    replay = client.post("/api/v1/sales/", body, format="json")
    assert replay.status_code == 201 and replay.data[0]["id"] == sale.pk
    assert replay.data[0]["counterparty_name"] == "Original buyer"
    sale.refresh_from_db()
    assert sale.receipt_snapshot == original
    assert original["document_parties"]["version"] == 1
    assert original["document_parties"]["customer_phone"] == "+998991234881"
    # Even show-customer/cashier=true does not grant public-link access to private parties.
    client.force_authenticate(None)
    public = client.get(f"/api/v1/sales/public/receipt/{sale.public_token}/")
    assert public.status_code == 200
    assert public.data["store_name"] == "Original shop" and public.data["store_address"] == "Saved address"
    assert "document_parties" not in public.data["receipt_snapshot"]
    for private in ("Original buyer", "Original Cashier", "+998991234881", "Changed buyer", "+998991234882"):
        assert private not in str(public.data)


def test_legacy_provenance_is_explicit_and_never_backfilled(owner, tenant, variant):
    cp = CounterpartyFactory(tenant=tenant, name="Current legacy customer")
    sale = Sale.objects.create(
        tenant=tenant, sold_by=owner, counterparty=cp, receipt_number="LEGACY-IDENTITY", total_amount=100
    )
    item = SaleItem.objects.create(tenant=tenant, sale=sale, product_variant=variant, quantity=1, unit_price=100,
                                   cost_price=50, total_price=100)
    data = SaleOutputSerializer(sale).data
    assert data["counterparty_name"] == "Current legacy customer"
    assert data["receipt_snapshot"] == {} and data["items"][0]["receipt_product_snapshot_version"] is None
    sale.refresh_from_db()
    item.refresh_from_db()
    assert sale.receipt_snapshot == {} and item.product_snapshot is None
