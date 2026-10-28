from decimal import Decimal
from datetime import datetime, date, timedelta
import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework import status

from apps.analytics.services.analytics_service import AnalyticsService, AnalyticsServiceError
from apps.permissions.models import Permission
from apps.sales.models import Sale, SaleItem, Counterparty
from tests.factories import (
    TenantFactory,
    OwnerFactory,
    StaffFactory,
    EmployeeFactory,
    CategoryFactory,
    ProductFactory,
    ProductVariantFactory,
    CounterpartyFactory,
)

pytestmark = pytest.mark.django_db

DASHBOARD_URL = "/api/v1/analytics/dashboard/"


@pytest.fixture
def api_client():
    return APIClient()


def create_tenant_with_owner(platform_admin):
    owner_user = OwnerFactory()
    t = TenantFactory(owner=owner_user)
    EmployeeFactory(
        user=owner_user,
        tenant=t,
        is_owner=True,
        is_active=True,
        position="Owner",
        hired_by=platform_admin,
    )
    return t, owner_user


def test_resolve_date_range():
    # Valid periods
    s_dt, e_dt = AnalyticsService.resolve_date_range("today")
    assert s_dt.date() == timezone.localdate()
    assert e_dt.date() == timezone.localdate()

    s_dt, e_dt = AnalyticsService.resolve_date_range("this_week")
    assert s_dt.date() <= timezone.now().date()

    s_dt, e_dt = AnalyticsService.resolve_date_range("this_month")
    assert s_dt.date().day == 1

    s_dt, e_dt = AnalyticsService.resolve_date_range("this_year")
    assert s_dt.date().month == 1 and s_dt.date().day == 1

    s_dt, e_dt = AnalyticsService.resolve_date_range("custom", "2026-01-01", "2026-01-15")
    assert s_dt.date() == date(2026, 1, 1)
    assert e_dt.date() == date(2026, 1, 15)

    # Invalid cases
    with pytest.raises(AnalyticsServiceError, match="custom davr uchun"):
        AnalyticsService.resolve_date_range("custom")

    with pytest.raises(AnalyticsServiceError, match="Sana formati"):
        AnalyticsService.resolve_date_range("custom", "invalid", "2026-01-15")

    with pytest.raises(AnalyticsServiceError, match="katta bo'lishi mumkin emas"):
        AnalyticsService.resolve_date_range("custom", "2026-01-20", "2026-01-15")

    with pytest.raises(AnalyticsServiceError, match="Noto'g'ri period"):
        AnalyticsService.resolve_date_range("invalid_period")


def test_dashboard_summary_calculations(tenant, owner, platform_admin):
    # Setup Category, Product & Variant
    cat = CategoryFactory(tenant=tenant)
    prod = ProductFactory(tenant=tenant, category=cat, name="Coca Cola")
    variant1 = ProductVariantFactory(product=prod, name="1.5L", sku="COCA-15L")
    prod2 = ProductFactory(tenant=tenant, category=cat, name="Snickers")
    variant2 = ProductVariantFactory(product=prod2, name="Standard", sku="SNICK-STD")

    # Counterparty with debt
    cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs=Decimal("50000.00"), debt_balance_usd=Decimal("20.00"))

    # Sale 1: UZS Cash
    sale1 = Sale.objects.create(
        tenant=tenant,
        sold_by=owner,
        receipt_number="REC-001",
        payment_type=Sale.PAYMENT_CASH,
        currency=Sale.CURRENCY_UZS,
        total_amount=Decimal("100000.00"),
        status=Sale.STATUS_COMPLETED,
    )
    SaleItem.objects.create(
        tenant=tenant,
        sale=sale1,
        product_variant=variant1,
        quantity=Decimal("10.000"),
        cost_price=Decimal("6000.00"),
        unit_price=Decimal("10000.00"),
        total_price=Decimal("100000.00"),
    )

    # Sale 2: USD Debt
    sale2 = Sale.objects.create(
        tenant=tenant,
        sold_by=owner,
        receipt_number="REC-002",
        payment_type=Sale.PAYMENT_DEBT,
        currency=Sale.CURRENCY_USD,
        counterparty=cp,
        total_amount=Decimal("50.00"),
        status=Sale.STATUS_COMPLETED,
    )
    SaleItem.objects.create(
        tenant=tenant,
        sale=sale2,
        product_variant=variant2,
        quantity=Decimal("5.000"),
        cost_price=Decimal("6.00"),
        unit_price=Decimal("10.00"),
        total_price=Decimal("50.00"),
    )

    # Tenant B: should not bleed into tenant summary
    tenant_b, owner_b = create_tenant_with_owner(platform_admin)
    cat_b = CategoryFactory(tenant=tenant_b)
    prod_b = ProductFactory(tenant=tenant_b, category=cat_b)
    var_b = ProductVariantFactory(product=prod_b)
    sale_b = Sale.objects.create(
        tenant=tenant_b,
        sold_by=owner_b,
        receipt_number="REC-B01",
        payment_type=Sale.PAYMENT_CASH,
        currency=Sale.CURRENCY_UZS,
        total_amount=Decimal("999999.00"),
        status=Sale.STATUS_COMPLETED,
    )
    SaleItem.objects.create(
        tenant=tenant_b,
        sale=sale_b,
        product_variant=var_b,
        quantity=Decimal("1.000"),
        cost_price=Decimal("100.00"),
        unit_price=Decimal("999999.00"),
        total_price=Decimal("999999.00"),
    )

    summary = AnalyticsService.get_dashboard_summary(tenant=tenant, period="today")

    kpi = summary["kpi"]
    assert kpi["total_revenue_uzs"] == "100000.00"
    assert kpi["net_profit_uzs"] == "40000.00"
    # Sale 2 was DEBT: total_revenue_usd must NOT count unpaid debt!
    assert kpi["total_revenue_usd"] == "0.00"
    assert kpi["total_sales_usd"] == "50.00"
    assert kpi["debt_sales_usd"] == "50.00"
    assert kpi["debt_sales_uzs"] == "0.00"
    assert kpi["debt_sales_count"] == 1
    assert kpi["net_profit_usd"] == "20.00"
    assert kpi["total_debt_uzs"] == "50000.00"
    assert kpi["total_debt_usd"] == "20.00"
    assert kpi["sales_count"] == 2
    assert kpi["average_check_uzs"] == "100000.00"
    assert kpi["average_check_usd"] == "50.00"

    # Payment methods check
    pm = summary["payment_methods"]
    assert pm["cash"]["count"] == 1
    assert pm["cash"]["amount_uzs"] == "100000.00"
    assert pm["debt"]["count"] == 1
    assert pm["debt"]["amount_usd"] == "50.00"

    # Top products check with cash vs debt breakdown
    top = summary["top_products"]
    assert len(top) == 2
    assert top[0]["sku"] == "COCA-15L"
    assert top[0]["revenue"] == "100000.00"
    assert top[0]["cash_quantity"] == "10.000"
    assert top[0]["debt_quantity"] == "0.000"
    assert top[1]["sku"] == "SNICK-STD"
    assert top[1]["revenue"] == "50.00"
    assert top[1]["cash_quantity"] == "0.000"
    assert top[1]["debt_quantity"] == "5.000"
    assert top[1]["debt_revenue"] == "50.00"

    # Cashiers check
    assert len(summary["cashiers_leaderboard"]) == 1
    cashier = summary["cashiers_leaderboard"][0]
    assert cashier["sales_count"] == 2
    assert cashier["debt_count"] == 1
    assert cashier["revenue_uzs"] == "100000.00"
    assert cashier["revenue_usd"] == "0.00"
    assert cashier["debt_amount_usd"] == "50.00"
    assert cashier["total_amount_usd"] == "50.00"


def test_dashboard_debt_collections_and_separation(tenant, owner):
    from apps.sales.models import DebtPayment
    cat = CategoryFactory(tenant=tenant)
    prod = ProductFactory(tenant=tenant, category=cat, name="Samsung A17")
    var = ProductVariantFactory(product=prod, name="Standart", sku="SAM-A17")
    cp = CounterpartyFactory(tenant=tenant, debt_balance_usd=Decimal("2800.00"))

    # 10 Samsung A17 sold on debt for $2800
    sale = Sale.objects.create(
        tenant=tenant,
        sold_by=owner,
        receipt_number="REC-SAM-01",
        payment_type=Sale.PAYMENT_DEBT,
        currency=Sale.CURRENCY_USD,
        counterparty=cp,
        total_amount=Decimal("2800.00"),
        status=Sale.STATUS_COMPLETED,
    )
    SaleItem.objects.create(
        tenant=tenant,
        sale=sale,
        product_variant=var,
        quantity=Decimal("10.000"),
        cost_price=Decimal("180.00"),
        unit_price=Decimal("280.00"),
        total_price=Decimal("2800.00"),
    )

    # Debt payment collected today: $500.00
    DebtPayment.objects.create(
        tenant=tenant,
        counterparty=cp,
        amount=Decimal("500.00"),
        currency="USD",
        recorded_by=owner,
    )

    summary = AnalyticsService.get_dashboard_summary(tenant=tenant, period="today")
    kpi = summary["kpi"]

    # Real revenue in USD should be ONLY the collected debt $500.00, NOT the $2800 credit sale!
    assert kpi["total_revenue_usd"] == "500.00"
    assert kpi["real_revenue_usd"] == "500.00"
    assert kpi["collected_debt_usd"] == "500.00"
    assert kpi["collected_debt_count"] == 1

    # Debt sales is $2800.00
    assert kpi["debt_sales_usd"] == "2800.00"
    assert kpi["debt_sales_count"] == 1

    # Total sales volume is $2800.00
    assert kpi["total_sales_usd"] == "2800.00"

    # Top product breakdown shows 10 units debt
    top = summary["top_products"]
    assert len(top) == 1
    assert top[0]["debt_quantity"] == "10.000"
    assert top[0]["debt_revenue"] == "2800.00"
    assert top[0]["cash_quantity"] == "0.000"
    assert top[0]["cash_revenue"] == "0.00"


def test_dashboard_api_permissions_and_access(api_client, tenant, owner, platform_admin):
    # Unauthenticated -> 401
    resp = api_client.get(DASHBOARD_URL)
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED

    # Staff without permission -> 403
    staff = StaffFactory()
    emp = EmployeeFactory(user=staff, tenant=tenant, is_active=True)
    api_client.force_authenticate(user=staff)
    resp = api_client.get(DASHBOARD_URL)
    assert resp.status_code == status.HTTP_403_FORBIDDEN

    # Staff with analytics.view_dashboard -> 200
    perm = Permission.objects.get(category="analytics", codename="view_dashboard")
    emp.permissions.add(perm)
    resp = api_client.get(DASHBOARD_URL)
    assert resp.status_code == status.HTTP_200_OK
    assert "kpi" in resp.data

    # Owner -> 200
    api_client.force_authenticate(user=owner)
    resp = api_client.get(DASHBOARD_URL)
    assert resp.status_code == status.HTTP_200_OK
    assert "kpi" in resp.data
    assert "sales_chart" in resp.data

    # Owner trying to access another tenant -> 403
    tenant_b, _ = create_tenant_with_owner(platform_admin)
    resp = api_client.get(f"{DASHBOARD_URL}?tenant_id={tenant_b.id}")
    assert resp.status_code == status.HTTP_403_FORBIDDEN

    # Platform Admin -> 403 Forbidden (Privacy & Commercial Secrets Protection)
    api_client.force_authenticate(user=platform_admin)
    resp = api_client.get(DASHBOARD_URL)
    assert resp.status_code == status.HTTP_403_FORBIDDEN

    resp = api_client.get(f"{DASHBOARD_URL}?tenant_id={tenant.id}")
    assert resp.status_code == status.HTTP_403_FORBIDDEN

def test_dashboard_with_voided_items_and_custom_period(tenant, owner):
    cat = CategoryFactory(tenant=tenant)
    prod = ProductFactory(tenant=tenant, category=cat, name="Juice")
    variant = ProductVariantFactory(product=prod, name="1L", sku="JUICE-1L")

    sale = Sale.objects.create(
        tenant=tenant,
        sold_by=owner,
        receipt_number="REC-VOID",
        payment_type=Sale.PAYMENT_CASH,
        currency=Sale.CURRENCY_UZS,
        total_amount=Decimal("100000.00"),
        status=Sale.STATUS_PARTIALLY_VOIDED,
    )
    SaleItem.objects.create(
        tenant=tenant,
        sale=sale,
        product_variant=variant,
        quantity=Decimal("10.000"),
        voided_quantity=Decimal("4.000"),  # 4 voided, 6 active
        cost_price=Decimal("5000.00"),
        unit_price=Decimal("10000.00"),
        total_price=Decimal("100000.00"),
    )

    today_str = timezone.localdate().strftime("%Y-%m-%d")
    summary = AnalyticsService.get_dashboard_summary(
        tenant=tenant,
        period="custom",
        start_date_str=today_str,
        end_date_str=today_str,
    )

    kpi = summary["kpi"]
    # active qty = 6, rev = 60,000, cost = 30,000, profit = 30,000
    assert kpi["total_revenue_uzs"] == "60000.00"
    assert kpi["net_profit_uzs"] == "30000.00"
