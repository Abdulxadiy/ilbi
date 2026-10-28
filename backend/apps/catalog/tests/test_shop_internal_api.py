from decimal import Decimal

import pytest
from django.conf import settings
from rest_framework import status
from rest_framework.test import APIClient

from apps.catalog.services import ProductService
from apps.inventory.services import StockService
from apps.sales.models import Sale
from tests.factories import (
    CategoryFactory,
)

pytestmark = pytest.mark.django_db

INTERNAL_TOKEN = "test-internal-token-12345"


@pytest.fixture(autouse=True)
def set_internal_token(monkeypatch):
    monkeypatch.setattr(settings, "INTERNAL_SERVICE_TOKEN", INTERNAL_TOKEN)


@pytest.fixture
def internal_client():
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Internal {INTERNAL_TOKEN}")
    return client


def test_internal_service_authentication():
    client = APIClient()
    url = "/api/v1/internal/shop/tenants/1/products/"

    # No token -> 403
    resp = client.get(url)
    assert resp.status_code == status.HTTP_403_FORBIDDEN

    # Wrong token -> 403
    client.credentials(HTTP_AUTHORIZATION="Internal wrong-token")
    resp = client.get(url)
    assert resp.status_code == status.HTTP_403_FORBIDDEN


def test_shop_tenant_products_list_and_detail(internal_client, tenant, owner):
    cat = CategoryFactory(tenant=tenant, name="Books")
    p1 = ProductService.create(
        tenant=tenant,
        name="Python Book",
        category=cat,
        price_partner=Decimal("50000"),
        price_min=Decimal("60000"),
        price_recommended=Decimal("80000"),
    )
    v1 = p1.variants.first()
    # Give stock to v1
    StockService.intake(
        tenant=tenant,
        product_variant=v1,
        quantity=Decimal("15.000"),
        cost_price=Decimal("45000"),
        created_by=owner,
    )

    # 1. List products
    resp = internal_client.get(f"/api/v1/internal/shop/tenants/{tenant.id}/products/")
    assert resp.status_code == status.HTTP_200_OK
    assert len(resp.data) == 1
    item = resp.data[0]
    assert item["product_name"] == "Python Book"
    assert item["price"] == "80000.00"
    assert item["stock_quantity"] == "15.000"

    # 2. Detail view
    detail_resp = internal_client.get(f"/api/v1/internal/shop/tenants/{tenant.id}/products/{v1.id}/")
    assert detail_resp.status_code == status.HTTP_200_OK
    assert detail_resp.data["id"] == v1.id
    assert detail_resp.data["price"] == "80000.00"


def test_shop_order_endpoint_cannot_create_sales_or_customer_profiles(
    internal_client, tenant
):
    response = internal_client.post(
        f"/api/v1/internal/shop/tenants/{tenant.id}/order-deduct/",
        {
            "order_id": "SHOP-1001",
            "customer_phone": "+998901112233",
            "items": [],
        },
        format="json",
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert not Sale.objects.filter(tenant=tenant).exists()
