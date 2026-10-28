from decimal import Decimal
import pytest
from rest_framework.test import APIClient
from rest_framework import status

from apps.catalog.services import ProductService
from apps.inventory.services import StockService
from apps.permissions.models import Permission
from apps.sales.models import Counterparty, Sale
from tests.factories import (
    CategoryFactory,
    ProductFactory,
    ProductVariantFactory,
    EmployeeFactory,
    StaffFactory,
    CounterpartyFactory,
)

pytestmark = pytest.mark.django_db

VARIANTS_URL = "/api/v1/catalog/variants/"
PRODUCTS_URL = "/api/v1/catalog/products/"
CATEGORIES_URL = "/api/v1/catalog/categories/"
COUNTERPARTIES_URL = "/api/v1/sales/counterparties/"
SALES_URL = "/api/v1/sales/"


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def staff_with_full_access(tenant):
    user = StaffFactory()
    emp = EmployeeFactory(user=user, tenant=tenant, is_active=True)
    emp.permissions.set(Permission.objects.all())
    return user


def test_pos_variant_search_and_filters(api_client, tenant, staff_with_full_access):
    api_client.force_authenticate(user=staff_with_full_access)

    cat_uzs = CategoryFactory(tenant=tenant, name="Ichimliklar", currency="UZS")
    cat_usd = CategoryFactory(tenant=tenant, name="Electronics", currency="USD")

    p1 = ProductService.create(
        tenant=tenant,
        name="Coca Cola",
        category=cat_uzs,
        price_partner=Decimal("9000"),
        price_min=Decimal("10000"),
        price_recommended=Decimal("12000"),
        variant_name="1.5L",
    )
    v1 = p1.variants.first()
    v1.barcode = "8801234567"
    v1.save(update_fields=["barcode"])

    # Stock intake for v1
    StockService.intake(tenant=tenant, created_by=staff_with_full_access, product_variant=v1, quantity=Decimal("20.000"), cost_price=Decimal("8000"))

    p2 = ProductService.create(
        tenant=tenant,
        name="iPhone 15",
        category=cat_usd,
        price_partner=Decimal("700"),
        price_min=Decimal("800"),
        price_recommended=Decimal("900"),
        variant_name="128GB Black",
    )
    v2 = p2.variants.first()
    v2.barcode = "990990990"
    v2.save(update_fields=["barcode"])
    # v2 has 0 stock!

    # 1. Search by product name
    resp = api_client.get(f"{VARIANTS_URL}?search=Coca")
    assert resp.status_code == status.HTTP_200_OK
    assert len(resp.data) == 1
    assert resp.data[0]["id"] == v1.id
    assert resp.data[0]["product_name"] == "Coca Cola"
    assert resp.data[0]["category_name"] == "Ichimliklar"
    assert resp.data[0]["stock_quantity"] == "20.000"

    # 2. Search by exact barcode (Barcode scanner)
    resp = api_client.get(f"{VARIANTS_URL}?barcode=990990990")
    assert resp.status_code == status.HTTP_200_OK
    assert len(resp.data) == 1
    assert resp.data[0]["id"] == v2.id
    assert resp.data[0]["stock_quantity"] == "0.000"

    # 3. Filter by currency
    resp_usd = api_client.get(f"{VARIANTS_URL}?currency=USD")
    assert len(resp_usd.data) == 1
    assert resp_usd.data[0]["id"] == v2.id

    resp_uzs = api_client.get(f"{VARIANTS_URL}?currency=UZS")
    assert len(resp_uzs.data) == 1
    assert resp_uzs.data[0]["id"] == v1.id

    # 4. Filter by in_stock=true
    resp_stock = api_client.get(f"{VARIANTS_URL}?in_stock=true")
    assert len(resp_stock.data) == 1
    assert resp_stock.data[0]["id"] == v1.id

    # 5. Filter by category
    resp_cat = api_client.get(f"{VARIANTS_URL}?category={cat_uzs.id}")
    assert len(resp_cat.data) == 1
    assert resp_cat.data[0]["id"] == v1.id

    # 6. Pagination on demand with ?page=1
    resp_page = api_client.get(f"{VARIANTS_URL}?page=1")
    assert resp_page.status_code == status.HTTP_200_OK
    assert "results" in resp_page.data
    assert "count" in resp_page.data
    assert resp_page.data["count"] == 2


def test_product_and_category_filters(api_client, tenant, staff_with_full_access):
    api_client.force_authenticate(user=staff_with_full_access)

    cat1 = CategoryFactory(tenant=tenant, name="Oziq-ovqat", currency="UZS")
    cat2 = CategoryFactory(tenant=tenant, name="Kiyim-kechak", currency="UZS")

    ProductService.create(
        tenant=tenant, name="Non Samarqand", category=cat1,
        price_partner=Decimal("2000"), price_min=Decimal("3000"), price_recommended=Decimal("4000")
    )
    ProductService.create(
        tenant=tenant, name="Ko'ylak Classic", category=cat2,
        price_partner=Decimal("50000"), price_min=Decimal("70000"), price_recommended=Decimal("90000")
    )

    # Category search
    resp_cat = api_client.get(f"{CATEGORIES_URL}?search=Oziq")
    assert resp_cat.status_code == status.HTTP_200_OK
    assert len(resp_cat.data) == 1
    assert resp_cat.data[0]["name"] == "Oziq-ovqat"

    # Product search
    resp_prod = api_client.get(f"{PRODUCTS_URL}?search=Samarqand")
    assert resp_prod.status_code == status.HTTP_200_OK
    assert len(resp_prod.data) == 1
    assert resp_prod.data[0]["name"] == "Non Samarqand"


def test_counterparty_and_sales_filters(api_client, tenant, staff_with_full_access):
    api_client.force_authenticate(user=staff_with_full_access)

    cp1 = CounterpartyFactory(tenant=tenant, name="Alisher Navoiy", phone_number="+998901112233", debt_balance_uzs=Decimal("150000"))
    cp2 = CounterpartyFactory(tenant=tenant, name="Bobur Mirzo", phone_number="+998904445566", debt_balance_uzs=Decimal("0"))

    # Counterparty search
    resp = api_client.get(f"{COUNTERPARTIES_URL}?search=Alisher")
    assert resp.status_code == status.HTTP_200_OK
    assert len(resp.data) == 1
    assert resp.data[0]["name"] == "Alisher Navoiy"

    # Counterparty debt filter
    resp_debt = api_client.get(f"{COUNTERPARTIES_URL}?has_debt=true")
    assert len(resp_debt.data) == 1
    assert resp_debt.data[0]["id"] == cp1.id

    # Sale search
    Sale.objects.create(
        tenant=tenant,
        sold_by=staff_with_full_access,
        receipt_number="REC-998877",
        payment_type=Sale.PAYMENT_CASH,
        currency=Sale.CURRENCY_UZS,
        total_amount=Decimal("50000"),
        status=Sale.STATUS_COMPLETED,
    )
    resp_sale = api_client.get(f"{SALES_URL}?search=998877")
    assert resp_sale.status_code == status.HTTP_200_OK
    assert len(resp_sale.data) == 1
    assert resp_sale.data[0]["receipt_number"] == "REC-998877"

    # Sales pagination
    resp_sale_page = api_client.get(f"{SALES_URL}?page=1")
    assert resp_sale_page.status_code == status.HTTP_200_OK
    assert "results" in resp_sale_page.data
    assert "count" in resp_sale_page.data
    assert resp_sale_page.data["count"] == 1
