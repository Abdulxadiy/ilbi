"""Actual ORM/handler contracts consumed by formerly preview-only mobile screens.

Runs exclusively through pytest's isolated test settings/database. No live account,
HTTP provider, email transport, Telegram delivery or phone installation is used.
"""
from decimal import Decimal

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.cashbox.models import DailyCashReport
from apps.inventory.models import Stock
from apps.inventory.services import StockService
from apps.permissions.models import Permission
from apps.sales.models import DebtPayment
from tests.factories import (
    CounterpartyFactory,
    EmployeeFactory,
    ProductVariantFactory,
    SaleFactory,
    SaleItemFactory,
    StaffFactory,
    TenantFactory,
)

pytestmark = pytest.mark.django_db


def client_for(user, tenant=None):
    client = APIClient()
    client.force_authenticate(user)
    if tenant is not None:
        client.credentials(HTTP_X_TENANT_ID=str(tenant.pk))
    return client


def variant_for(tenant):
    return ProductVariantFactory(tenant=tenant, product__tenant=tenant, product__category__tenant=tenant)


def sale_for(tenant, owner, *, currency="UZS", amount="12.50"):
    variant = variant_for(tenant)
    sale = SaleFactory(tenant=tenant, sold_by=owner, currency=currency, total_amount=amount)
    SaleItemFactory(
        sale=sale,
        product_variant=variant,
        unit_price=amount,
        total_price=amount,
        quantity="1.000",
        cost_price="1.00",
        product_snapshot={"version": 1, "product_name": "Saved item", "product_variant_name": "Original", "unit": "dona"},
    )
    return sale


@pytest.mark.parametrize("period", ["today", "this_week", "this_month", "this_year"])
def test_mobile_dashboard_actual_kpi_chart_period_and_tenant_contract(tenant, owner, period):
    sale_for(tenant, owner)
    foreign = TenantFactory()
    sale_for(foreign, foreign.owner, amount="9999.00")
    response = client_for(owner, tenant).get("/api/v1/analytics/dashboard/", {"period": period})
    assert response.status_code == 200
    payload = response.data
    assert payload["period"] == period
    assert Decimal(payload["kpi"]["total_sales_uzs"]) == Decimal("12.50")
    assert payload["kpi"]["sales_count"] == 1
    for key in ("total_sales_usd", "cash_revenue_uzs", "card_revenue_uzs", "debt_sales_uzs", "average_check_uzs", "total_debt_uzs"):
        assert Decimal(payload["kpi"][key]).is_finite()
    assert isinstance(payload["sales_chart"], list)
    assert any(Decimal(row["total_sales_uzs"]) == Decimal("12.50") for row in payload["sales_chart"])


def test_mobile_profile_updates_only_personal_fields_and_rejects_invalid_email(tenant, owner):
    client = client_for(owner, tenant)
    profile = client.get("/api/v1/auth/profile/")
    assert profile.status_code == 200
    assert profile.data["id"] == owner.pk
    assert any(row["id"] == tenant.pk and row["is_owner"] for row in profile.data["tenants"])
    original_phone = owner.phone_number
    saved = client.patch("/api/v1/auth/profile/", {"first_name": "Mobile", "last_name": "Owner", "email": "mobile@example.com", "date_of_birth": "1990-02-14", "contact_phone": "+998 90 123-45-67", "phone_number": "+998999999999", "role": "platform_admin"}, format="json")
    assert saved.status_code == 200
    owner.refresh_from_db()
    assert owner.first_name == "Mobile"
    assert owner.contact_phone == "+998901234567"
    assert owner.phone_number == original_phone and owner.role == "owner"
    rejected = client.patch("/api/v1/auth/profile/", {"email": "invalid"}, format="json")
    assert rejected.status_code == 400
    assert "email" in str(rejected.data)
    owner.refresh_from_db()
    assert owner.email == "mobile@example.com"


def test_mobile_password_change_revokes_old_native_token(tenant, owner):
    owner.set_password("Old-Strong-Pass-2026")
    owner.save(update_fields=["password"])
    refresh = RefreshToken.for_user(owner)
    refresh["token_version"] = owner.token_version
    old_access = str(refresh.access_token)
    previous_version = owner.token_version
    response = client_for(owner, tenant).post("/api/v1/auth/change-password/", {"old_password": "Old-Strong-Pass-2026", "new_password": "New-Strong-Pass-8392"}, format="json")
    assert response.status_code == 200
    owner.refresh_from_db()
    assert owner.check_password("New-Strong-Pass-8392")
    assert owner.token_version == previous_version + 1
    stale_client = APIClient()
    stale_client.credentials(HTTP_AUTHORIZATION="Bearer " + old_access)
    assert stale_client.get("/api/v1/auth/profile/").status_code == 401


def test_mobile_customer_pages_summary_and_edit_are_authoritative(tenant, owner):
    first = CounterpartyFactory(tenant=tenant, debt_balance_uzs="12.25", debt_balance_usd="2.00")
    second = CounterpartyFactory(tenant=tenant, debt_balance_uzs="7.00")
    CounterpartyFactory(debt_balance_uzs="99999.00")
    client = client_for(owner, tenant)
    page1 = client.get("/api/v1/sales/counterparties/", {"page": 1, "page_size": 1})
    page2 = client.get("/api/v1/sales/counterparties/", {"page": 2, "page_size": 1})
    assert page1.status_code == page2.status_code == 200
    assert page1.data["count"] == 2 and page1.data["next"]
    assert {page1.data["results"][0]["id"], page2.data["results"][0]["id"]} == {first.pk, second.pk}
    assert Decimal(page1.data["summary"]["total_debt_uzs"]) == Decimal("19.25")
    assert Decimal(page1.data["summary"]["total_debt_usd"]) == Decimal("2.00")
    created = client.post("/api/v1/sales/counterparties/", {"name": "Mobile customer", "phone_number": "+998901112233", "note": "Synthetic contract"}, format="json")
    assert created.status_code == 201
    assert Decimal(created.data["debt_balance_uzs"]) == 0 and Decimal(created.data["debt_balance_usd"]) == 0
    edited = client.patch(f"/api/v1/sales/counterparties/{created.data['id']}/", {"name": "Edited customer", "note": "Saved note"}, format="json")
    assert edited.status_code == 200 and edited.data["name"] == "Edited customer" and edited.data["note"] == "Saved note"


def test_mobile_debt_card_payment_currency_and_original_key_replay(tenant, owner):
    customer = CounterpartyFactory(tenant=tenant, debt_balance_usd="4.25", debt_balance_uzs="0.00")
    client = client_for(owner, tenant)
    path = f"/api/v1/sales/counterparties/{customer.pk}/payments/"
    payload = {"amount": "2.50", "currency": "USD", "payment_type": "card", "idempotency_key": "mobile-core-contract-original-key"}
    first = client.post(path, payload, format="json")
    replay = client.post(path, payload, format="json")
    assert first.status_code == replay.status_code == 201
    assert first.data["id"] == replay.data["id"]
    assert first.data["counterparty"] == customer.pk
    assert first.data["currency"] == "USD" and first.data["payment_type"] == "card"
    assert Decimal(first.data["amount"]) == Decimal("2.50")
    customer.refresh_from_db()
    assert customer.debt_balance_usd == Decimal("1.75")
    assert DebtPayment.objects.filter(counterparty=customer).count() == 1


def test_mobile_stock_batches_movement_and_sensitive_cost_contract(tenant, owner):
    variant = variant_for(tenant)
    StockService.intake(tenant=tenant, product_variant=variant, quantity=Decimal("2.750"), cost_price=Decimal("11.25"), created_by=owner, batch_code="MOBILE-CORE")
    owner_client = client_for(owner, tenant)
    stock = owner_client.get("/api/v1/inventory/stock/", {"page": 1, "page_size": 50})
    assert stock.status_code == 200
    row = stock.data["results"][0]
    assert row["product_variant"] == variant.pk and Decimal(row["quantity"]) == Decimal("2.750")
    assert Decimal(row["last_cost_price"]) == Decimal("11.25")
    movements = owner_client.get("/api/v1/inventory/movements/", {"product_variant_id": variant.pk, "page": 1})
    batches = owner_client.get("/api/v1/inventory/batches/", {"product_variant_id": variant.pk})
    assert movements.status_code == batches.status_code == 200
    assert Decimal(movements.data["results"][0]["quantity"]) == Decimal("2.750")
    assert batches.data[0]["batch_code"] == "MOBILE-CORE"
    staff = StaffFactory()
    employee = EmployeeFactory(tenant=tenant, user=staff, is_owner=False)
    employee.permissions.add(Permission.objects.get(category="inventory", codename="view_stock"))
    limited = client_for(staff, tenant).get("/api/v1/inventory/stock/", {"page": 1})
    assert limited.status_code == 200
    assert "last_cost_price" not in limited.data["results"][0]
    assert "supplier" not in limited.data["results"][0]


def test_mobile_history_detail_and_saved_receipt_do_not_cross_tenants(tenant, owner):
    sale = sale_for(tenant, owner, currency="USD", amount="99.25")
    foreign = TenantFactory()
    foreign_sale = sale_for(foreign, foreign.owner)
    client = client_for(owner, tenant)
    history = client.get("/api/v1/audit/history/", {"category": "sales", "page": 1})
    assert history.status_code == 200
    assert [row["id"] for row in history.data["results"]] == [f"sale:{sale.pk}"]
    detail = client.get(f"/api/v1/audit/history/sale/{sale.pk}/")
    assert detail.status_code == 200 and isinstance(detail.data["details"]["fields"], list)
    assert detail.data["sale"]["id"] == sale.pk
    documents = client.get("/api/v1/sales/", {"page": 1, "payment_type": "cash"})
    assert documents.status_code == 200
    assert documents.data["results"][0]["currency"] == "USD"
    receipt = client.get(f"/api/v1/sales/{sale.pk}/")
    assert receipt.status_code == 200 and Decimal(receipt.data["total_amount"]) == Decimal("99.25")
    assert receipt.data["items"][0]["product_name"] == "Saved item"
    assert client.get(f"/api/v1/sales/{foreign_sale.pk}/").status_code == 404
    assert client.get(f"/api/v1/audit/history/sale/{foreign_sale.pk}/").status_code == 404


def test_mobile_saved_z_report_is_real_closed_record_not_analytics(tenant, owner):
    report = DailyCashReport.objects.create(tenant=tenant, closed_by=owner, is_closed=True, actual_cash_uzs="100.25", expected_cash_uzs="99.25", discrepancy_uzs="1.00")
    foreign = TenantFactory()
    foreign_report = DailyCashReport.objects.create(tenant=foreign, closed_by=foreign.owner, is_closed=True)
    client = client_for(owner, tenant)
    response = client.get("/api/v1/cashbox/reports/", {"page": 1})
    detail = client.get(f"/api/v1/cashbox/reports/{report.pk}/")
    assert response.status_code == detail.status_code == 200
    assert response.data["count"] == 1 and response.data["results"][0]["id"] == report.pk
    assert detail.data["is_closed"] is True
    assert Decimal(detail.data["actual_cash_uzs"]) == Decimal("100.25")
    assert Decimal(detail.data["discrepancy_uzs"]) == Decimal("1.00")
    assert client.get(f"/api/v1/cashbox/reports/{foreign_report.pk}/").status_code == 404


def test_mobile_unauthorized_roles_do_not_gain_commercial_modules(tenant, platform_admin):
    staff = StaffFactory()
    EmployeeFactory(user=staff, tenant=tenant, is_owner=False)
    client = client_for(staff, tenant)
    for path in ("/api/v1/analytics/dashboard/", "/api/v1/audit/history/", "/api/v1/inventory/stock/", "/api/v1/cashbox/reports/", "/api/v1/sales/"):
        assert client.get(path).status_code == 403
    assert client_for(platform_admin).get("/api/v1/analytics/dashboard/").status_code == 403
    assert APIClient().get("/api/v1/auth/profile/").status_code == 401
