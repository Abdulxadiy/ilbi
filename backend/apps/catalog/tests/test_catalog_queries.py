from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.catalog.models import ProductVariant
from tests.factories import CategoryFactory, ProductFactory

pytestmark = pytest.mark.django_db


def test_product_list_uses_bounded_queries_for_many_variants(tenant, owner):
    category = CategoryFactory(tenant=tenant)
    product = ProductFactory(tenant=tenant, category=category)
    ProductVariant.objects.bulk_create(
        [
            ProductVariant(
                tenant=tenant,
                product=product,
                name=f"Variant {index}",
                sku=f"query-{index:04d}",
                code="",
                unit="dona",
                price_partner=Decimal("1.00"),
                price_min=Decimal("2.00"),
                price_recommended=Decimal("3.00"),
            )
            for index in range(1000)
        ]
    )

    client = APIClient()
    client.force_authenticate(user=owner)
    with CaptureQueriesContext(connection) as queries:
        response = client.get("/api/v1/catalog/products/")

    assert response.status_code == 200
    assert len(response.data[0]["variants"]) == 1000
    assert len(queries) <= 10
