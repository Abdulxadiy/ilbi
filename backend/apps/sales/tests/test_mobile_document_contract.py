"""Real saved-sale examples for native documents; never call a fiscal/provider service."""
import json
import os
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from apps.inventory.services import StockService
from tests.factories import CategoryFactory, CounterpartyFactory, ProductVariantFactory, TenantFactory

pytestmark = pytest.mark.django_db


def test_native_saved_document_contract(owner, tenant):
    tenant.name, tenant.address = "Saved <store>", "Original <address>"
    tenant.is_vat_payer, tenant.vat_rate, tenant.price_includes_vat = True, Decimal("12"), False
    tenant.receipt_show_item_tax, tenant.receipt_paper_width = True, "80mm"
    tenant.receipt_footer = "Keep <script>saved text</script>"
    tenant.save()
    client = APIClient()
    client.force_authenticate(owner)
    client.credentials(HTTP_X_TENANT_ID=str(tenant.pk))
    variants = {}
    for currency in ("UZS",):
        category = CategoryFactory(tenant=tenant, currency=currency)
        variants[currency] = [
            ProductVariantFactory(
                tenant=tenant, product__tenant=tenant, product__category=category,
                product__name=f"Saved <product {index}>", name=f"Size {index}", unit="kg",
                code=f"DOC/{currency}/{index}", barcode=f"00123456789{index}{0 if currency == 'UZS' else 1}",
                mxik="03816001001000000", package_code="0001234", price_recommended="100.00",
            )
            for index in (1, 2)
        ]
        for variant in variants[currency]:
            StockService.intake(tenant=tenant, product_variant=variant, quantity=20, cost_price=50, created_by=owner)
    customer = CounterpartyFactory(tenant=tenant, name="Document customer")
    partner = CounterpartyFactory(tenant=tenant, name="Document B2B", target_tenant=TenantFactory())
    cases = {}
    for name, method, currency, wholesale, cp in (
        ("cash", "cash", "UZS", False, customer),
        ("card", "card", "UZS", False, customer),
        ("debt_returned", "debt", "UZS", False, customer),
        ("partner", "card", "UZS", True, customer),
        ("b2b", "debt", "UZS", True, partner),
    ):
        with patch("apps.sales.services.debt_service.DebtService._notify_owner_telegram"):
            result = client.post("/api/v1/sales/", {
                "items": [{"product_variant_id": variant.pk, "quantity": quantity, "unit_price": price}
                          for variant, quantity, price in zip(
                              variants[currency], ("1.250", "2.000"), ("100.00", "60.00"), strict=True
                          )],
                "payment_type": method, "counterparty_id": cp.pk, "is_partner_sale": wholesale,
                "idempotency_key": "native-document-" + name,
            }, format="json")
        assert result.status_code == 201, result.data
        saved = result.json()[0]
        assert saved["total_amount"] == "274.40" and saved["tax_amount"] == "29.40"
        if name == "debt_returned":
            returned = client.post(f"/api/v1/sales/items/{saved['items'][0]['id']}/void/", {
                "quantity": "0.250", "reason": "Document return", "idempotency_key": "document-return",
            }, format="json")
            assert returned.status_code == 200, returned.data
        cases[name] = saved["id"]

    tenant.name, tenant.address, tenant.vat_rate = "Changed current store", "New address", Decimal("6")
    tenant.receipt_paper_width, tenant.receipt_footer = "58mm", "Changed footer"
    tenant.save()
    for group in variants.values():
        for variant in group:
            variant.product.name = "Changed catalog product"
            variant.product.save(update_fields=["name"])
            variant.code, variant.barcode, variant.mxik = "Changed", f"99999{variant.pk}", "12345678901234567"
            variant.save()
    for name, sale_id in cases.items():
        detail = client.get(f"/api/v1/sales/{sale_id}/")
        assert detail.status_code == 200, detail.data
        row = detail.json()
        assert row["receipt_snapshot"]["store_name"] == "Saved <store>"
        assert row["receipt_snapshot"]["receipt_paper_width"] == "80mm"
        assert row["items"][0]["product_name"] == "Saved <product 1>"
        assert row["items"][0]["mxik"] == "03816001001000000"
        assert row["items"][0]["product_code"].startswith("DOC/")
        assert row["items"][0]["tax_rate"] == "12.00"
        purchases = client.get(
            f"/api/v1/sales/counterparties/{row['counterparty']}/sales/", {"search": "Saved <product 1>", "page": 1}
        )
        assert purchases.status_code == 200 and row["id"] in [item["id"] for item in purchases.data["results"]]
        assert Decimal(str(row["net_amount"])) == Decimal(row["total_amount"]) - Decimal(row["refunded_amount"])
        if name == "debt_returned":
            assert row["status"] == "partially_voided" and row["refunded_amount"] == "28.00"
            assert row["items"][0]["voided_quantity"] == "0.250"
        if name == "b2b":
            assert row["status"] == "b2b_pending" and row["b2b_target_tenant"] == partner.target_tenant_id
        cases[name] = row
    target = Path(__file__).resolve().parents[4] / "mobile-app/tests/contracts/documents.json"
    contract = {
        "source": ("Actual scoped Django APIClient responses; isolated PostgreSQL, "
                   "nonfiscal test sandbox; synthetic identities only"),
        "sales": cases,
    }
    if os.environ.get("ILBI_WRITE_DOCUMENT_CONTRACT") == "1":
        target.write_text(json.dumps(contract, ensure_ascii=False, indent=2) + "\n")
    else:
        saved_contract = json.loads(target.read_text())
        def shape(value):
            if isinstance(value, dict):
                return {key: shape(item) for key, item in value.items()}
            if isinstance(value, list):
                return [shape(value[0])] if value else []
            return type(value).__name__
        assert shape(contract) == shape(saved_contract)
