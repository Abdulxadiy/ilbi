"""Generate mobile examples from actual serializers and isolated DB writes."""
import json
import os
from decimal import Decimal
from pathlib import Path
import pytest
from rest_framework.test import APIClient
from apps.inventory.services import StockService
from tests.factories import CategoryFactory, CounterpartyFactory, ProductFactory, ProductVariantFactory
pytestmark = pytest.mark.django_db


def test_mobile_wire_contracts(owner, tenant):
    category = CategoryFactory(tenant=tenant, currency="UZS")
    product = ProductFactory(tenant=tenant, category=category, name="Mobile contract rice")
    variant = ProductVariantFactory(tenant=tenant, product=product, price_partner=Decimal("10.00"), price_min=Decimal("10.00"), price_recommended=Decimal("11.50"))
    StockService.intake(tenant=tenant, product_variant=variant, quantity=Decimal("50.125"), cost_price=Decimal("5.00"), created_by=owner)
    customer = CounterpartyFactory(tenant=tenant, name="Contract customer")
    client = APIClient()
    client.force_authenticate(user=owner)
    client.credentials(HTTP_X_TENANT_ID=str(tenant.id))
    variants = client.get("/api/v1/catalog/variants/", {"ids": variant.id, "page": 1})
    assert variants.status_code == 200, variants.data
    current = client.get("/api/v1/tenants/current/")
    assert current.status_code == 200, current.data
    profile = client.get("/api/v1/auth/me/")
    assert profile.status_code == 200, profile.data
    customers = client.get("/api/v1/sales/counterparties/", {"page": 1})
    assert customers.status_code == 200, customers.data
    payload = {"items": [{"product_variant_id": variant.id, "quantity": "0.125", "unit_price": "11.50"}], "payment_type": "cash", "idempotency_key": "mobile-contract-sale"}
    created = client.post("/api/v1/sales/", payload, format="json")
    assert created.status_code == 201, created.data
    assert isinstance(created.data, list) and len(created.data) == 1
    assert str(created.data[0]["total_amount"]) == "1.44"
    retry = client.post("/api/v1/sales/", payload, format="json")
    assert retry.status_code == 201 and retry.data[0]["id"] == created.data[0]["id"]
    detail = client.get(f'/api/v1/sales/{created.data[0]["id"]}/')
    assert detail.status_code == 200, detail.data
    contract = {"source": "Actual Django APIClient responses; isolated PostgreSQL; local nonfiscal sales sandbox; synthetic identities only", "variants": variants.json(), "tenant": current.json(), "profile": profile.json(), "customers": customers.json(), "created_sales": created.json(), "sale_detail": detail.json()}
    assert contract["variants"]["results"][0]["product"] == product.id
    assert contract["customers"]["results"][0]["id"] == customer.id
    target = Path(__file__).resolve().parents[4] / "mobile-app/tests/contracts/backend.json"
    if os.environ.get("ILBI_WRITE_MOBILE_CONTRACTS") == "1":
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(contract, ensure_ascii=False, indent=2) + "\n")
    else:
        saved = json.loads(target.read_text())
        def shape(value):
            if isinstance(value, dict):
                return {key: shape(item) for key, item in value.items()}
            if isinstance(value, list):
                return [shape(value[0])] if value else []
            return type(value).__name__
        for key in ("variants", "tenant", "profile", "customers", "created_sales", "sale_detail"):
            assert shape(contract[key]) == shape(saved[key]), f"Mobile contract changed: {key}; regenerate and verify mobile adapters."
