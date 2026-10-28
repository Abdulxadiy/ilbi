from decimal import Decimal
import datetime
import pytest
from rest_framework.test import APIClient

from apps.catalog.models import Product, ProductVariant
from apps.catalog.services import ProductService
from apps.inventory.models import StockBatch
from apps.permissions.models import Permission
from tests.factories import CategoryFactory, EmployeeFactory, StaffFactory, TenantFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def catalog_staff(tenant):
    user = StaffFactory()
    employee = EmployeeFactory(user=user, tenant=tenant, is_active=True)
    employee.permissions.set(Permission.objects.filter(category__in=["catalog", "inventory"]))
    return user


class TestCatalogUnarchiveAndBatches:
    def test_unarchive_product_service(self, tenant):
        category = CategoryFactory(tenant=tenant)
        product = ProductService.create(
            tenant=tenant,
            name="Test Cola",
            category=category,
            price_partner=Decimal("5000"),
            price_min=Decimal("6000"),
            price_recommended=Decimal("7000"),
        )
        assert product.is_active is True
        assert product.variants.first().is_active is True

        # Archive
        ProductService.archive(product)
        product.refresh_from_db()
        assert product.is_active is False
        assert product.variants.first().is_active is False

        # Unarchive
        ProductService.unarchive(product)
        product.refresh_from_db()
        assert product.is_active is True
        assert product.variants.first().is_active is True

    def test_unarchive_variant_service(self, tenant):
        category = CategoryFactory(tenant=tenant)
        product = ProductService.create(
            tenant=tenant,
            name="Test Fanta",
            category=category,
            price_partner=Decimal("5000"),
            price_min=Decimal("6000"),
            price_recommended=Decimal("7000"),
        )
        variant = product.variants.first()

        # Archive variant directly
        variant.is_active = False
        variant.save()

        ProductService.unarchive_variant(variant)
        variant.refresh_from_db()
        assert variant.is_active is True
        assert variant.product.is_active is True

    def test_unarchive_endpoints_and_archived_filter(self, api_client, tenant, catalog_staff):
        api_client.force_authenticate(user=catalog_staff)
        category = CategoryFactory(tenant=tenant)

        product = ProductService.create(
            tenant=tenant,
            name="Sprite 1L",
            category=category,
            price_partner=Decimal("8000"),
            price_min=Decimal("9000"),
            price_recommended=Decimal("10000"),
        )
        variant = product.variants.first()

        # Archive variant via API
        resp = api_client.post(f"/api/v1/catalog/variants/{variant.id}/archive/")
        assert resp.status_code == 200

        # Normal list should NOT contain archived variant
        resp_active = api_client.get("/api/v1/catalog/variants/")
        assert resp_active.status_code == 200
        variant_ids = [v["id"] for v in resp_active.data]
        assert variant.id not in variant_ids

        # Archived list should contain it
        resp_archived = api_client.get("/api/v1/catalog/variants/?archived=true")
        assert resp_archived.status_code == 200
        archived_ids = [v["id"] for v in resp_archived.data]
        assert variant.id in archived_ids

        # Unarchive variant via API
        resp_unarchive = api_client.post(f"/api/v1/catalog/variants/{variant.id}/unarchive/")
        assert resp_unarchive.status_code == 200

        # Now normal list should have it again
        resp_active_again = api_client.get("/api/v1/catalog/variants/")
        variant_ids_again = [v["id"] for v in resp_active_again.data]
        assert variant.id in variant_ids_again

    def test_create_product_with_expiration_and_batch_code(self, api_client, tenant, catalog_staff):
        api_client.force_authenticate(user=catalog_staff)
        category = CategoryFactory(tenant=tenant)

        payload = {
            "name": "Yogurt 500g",
            "category_id": category.id,
            "unit": "dona",
            "price_partner": "8000.00",
            "price_min": "9000.00",
            "price_recommended": "10000.00",
            "initial_quantity": "25.000",
            "initial_cost_price": "7500.00",
            "supplier": "Milk Agro",
            "intake_note": "Faktura #991",
            "expires_on": "2027-06-30",
            "batch_code": "BATCH-2027-06",
        }

        resp = api_client.post("/api/v1/catalog/products/", payload, format="json")
        assert resp.status_code == 201

        created_prod = Product.objects.get(tenant=tenant, name="Yogurt 500g")
        variant = created_prod.variants.first()

        batch = StockBatch.objects.filter(product_variant=variant).first()
        assert batch is not None
        assert batch.batch_code == "BATCH-2027-06"
        assert batch.expires_on == datetime.date(2027, 6, 30)
        assert batch.quantity == Decimal("25.000")
