"""Native customer metadata and statement contracts against actual local APIs."""

import json
import os
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from apps.inventory.services import StockService
from apps.sales.models import Counterparty, DebtPayment, Sale
from tests.factories import EmployeeFactory, ProductVariantFactory, StaffFactory, TenantFactory

pytestmark = pytest.mark.django_db


def client_for(user, tenant):
    client = APIClient()
    client.force_authenticate(user=user)
    client.credentials(HTTP_X_TENANT_ID=str(tenant.pk))
    return client


def test_native_customer_metadata_statements_and_archive_contract(owner, tenant):
    # The sales test directory explicitly enables a local nonfiscal sandbox.
    # The production DEBUG=false fiscal gate is not modified.
    client = client_for(owner, tenant)
    base = "/api/v1/sales/counterparties/"
    partner = TenantFactory()
    linked = client.post(
        base,
        {
            "name": "Native B2B",
            "phone_number": "+998991234001",
            "target_tenant_code": partner.public_code,
            "note": "Linked partner",
            "debt_due_date": "2026-12-31",
        },
        format="json",
    )
    assert linked.status_code == 201 and linked.data["target_tenant"] == partner.pk
    assert linked.data["target_tenant_name"] == partner.name
    detail = base + f"{linked.data['id']}/"
    edited = client.patch(detail, {"name": "Updated partner", "note": "Updated", "debt_due_date": None}, format="json")
    assert edited.status_code == 200 and edited.data["debt_due_date"] is None
    assert edited.data["target_tenant"] == partner.pk and edited.data["phone_number"] == "+998991234001"
    assert (
        client.post(
            base, {"name": "Bad date", "phone_number": "+998991234002", "debt_due_date": "2026-02-30"}
        ).status_code
        == 400
    )
    assert (
        client.post(
            base, {"name": "Own code", "phone_number": "+998991234002", "target_tenant_code": tenant.public_code}
        ).status_code
        == 400
    )

    created = client.post(
        base, {"name": "Statement customer", "phone_number": "+998991234003", "debt_due_date": "2026-12-31"}
    )
    assert created.status_code == 201
    cp_id = created.data["id"]
    cp_path = base + f"{cp_id}/"
    variant = ProductVariantFactory(
        tenant=tenant, product__tenant=tenant, product__category__tenant=tenant, price_recommended="20.00"
    )
    StockService.intake(
        tenant=tenant, product_variant=variant, quantity=Decimal("10.000"), cost_price=Decimal("5.00"), created_by=owner
    )
    with patch("apps.sales.services.debt_service.DebtService._notify_owner_telegram"):
        sold = client.post(
            "/api/v1/sales/",
            {
                "items": [{"product_variant_id": variant.pk, "quantity": "5", "unit_price": "20.00"}],
                "counterparty_id": cp_id,
                "payment_type": "debt",
                "idempotency_key": "customer-contract-sale",
            },
            format="json",
        )
        assert sold.status_code == 201, sold.data
        item_id = sold.data[0]["items"][0]["id"]
        returned = client.post(
            f"/api/v1/sales/items/{item_id}/void/",
            {"quantity": "1", "reason": "Contract return", "idempotency_key": "customer-contract-return"},
            format="json",
        )
        assert returned.status_code == 200
        quote = client.get(cp_path + "payments/quote/", {"amount": "10.00", "currency": "UZS", "payment_type": "cash"})
        assert quote.status_code == 200
        paid = client.post(
            cp_path + "payments/",
            {
                "amount": "10.00",
                "currency": "UZS",
                "payment_type": "cash",
                "idempotency_key": "customer-contract-payment",
                "expected_quote": quote.data["expected_quote"],
                "note": "Partial collection",
            },
            format="json",
        )
        assert paid.status_code == 201
    current = client.get(cp_path)
    assert current.status_code == 200 and current.data["debt_balance_uzs"] == "70.00"
    sales = client.get(cp_path + "sales/", {"page": 1, "page_size": 1})
    payments = client.get(cp_path + "payments/", {"page": 1, "page_size": 1})
    assert sales.status_code == payments.status_code == 200
    assert Decimal(str(sales.data["summary"]["total_spent_uzs"])) - Decimal(
        payments.data["results"][0]["amount"]
    ) == Decimal(current.data["debt_balance_uzs"])
    assert sales.data["results"][0]["refunded_amount"] == "20.00"
    assert client.delete(cp_path).status_code == 400
    assert client.get(cp_path + "sales/", {"page": 1, "payment_type": "debt"}).data["count"] == 1
    recorder = StaffFactory()
    member = EmployeeFactory(user=recorder, tenant=tenant)
    from apps.permissions.models import Permission

    member.permissions.add(Permission.objects.get(category="sales", codename="record_debt_payment"))
    restricted = client_for(recorder, tenant)
    assert restricted.get(cp_path).status_code == 200
    assert restricted.get(cp_path + "payments/", {"page": 1}).status_code == 200
    assert restricted.patch(cp_path, {"name": "Unauthorized"}).status_code == 403
    foreign = client_for(owner, TenantFactory())
    assert foreign.get(cp_path).status_code in (403, 404)
    contract = {
        "source": (
            "Actual isolated PostgreSQL/Django APIs; local nonfiscal sandbox; "
            "debt sale100-return20-payment10=balance70; no native/live acceptance"
        ),
        "linked": linked.json(),
        "edited": edited.json(),
        "customer": current.json(),
        "sales": sales.json(),
        "payments": payments.json(),
    }
    target = os.environ.get("ILBI_MOBILE_CUSTOMER_CONTRACT")
    if target:
        Path(target).write_text(json.dumps(contract, ensure_ascii=False, indent=2) + "\n")
    # Zero-balance archive preserves all purchase and payment records.
    with patch("apps.sales.services.debt_service.DebtService._notify_owner_telegram"):
        quote = client.get(cp_path + "payments/quote/", {"amount": "70.00", "currency": "UZS", "payment_type": "cash"})
        assert (
            client.post(
                cp_path + "payments/",
                {
                    "amount": "70.00",
                    "currency": "UZS",
                    "payment_type": "cash",
                    "idempotency_key": "customer-contract-settle",
                    "expected_quote": quote.data["expected_quote"],
                },
                format="json",
            ).status_code
            == 201
        )
    assert client.delete(cp_path).status_code == 200
    assert not Counterparty.objects.get(pk=cp_id).is_active
    assert Sale.objects.filter(counterparty_id=cp_id).count() == 1
    assert DebtPayment.objects.filter(counterparty_id=cp_id).count() == 2
