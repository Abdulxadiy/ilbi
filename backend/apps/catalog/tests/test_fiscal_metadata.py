from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.catalog.models import Product, ProductVariant
from apps.catalog.services import ProductService, ProductServiceError
from tests.factories import CategoryFactory, EmployeeFactory, ProductFactory, ProductVariantFactory, StaffFactory

pytestmark = pytest.mark.django_db
PRODUCTS = "/api/v1/catalog/products/"
MXIK = "03816001001000000"
PACKAGE = "0001234"


@pytest.fixture
def client(owner, tenant):
    client = APIClient()
    client.force_authenticate(owner)
    client.credentials(HTTP_X_TENANT_ID=str(tenant.pk))
    return client


@pytest.mark.parametrize("format", ["json", "multipart"])
def test_create_and_clear_codes_without_losing_zeroes(client, tenant, format):
    category = CategoryFactory(tenant=tenant)
    response = client.post(
        PRODUCTS,
        {
            "name": "Sement",
            "category_id": category.pk,
            "price_partner": "1000",
            "price_min": "1200",
            "price_recommended": "1500",
            "mxik": " " + MXIK + " ",
            "package_code": PACKAGE,
        },
        format=format,
    )
    assert response.status_code == 201, response.data
    product_id = response.data["id"]
    variant = ProductVariant.objects.get(pk=response.data["variants"][0]["id"])
    assert (variant.mxik, variant.package_code) == (MXIK, PACKAGE)
    assert response.data["variants"][0]["mxik"] == MXIK
    assert response.data["variants"][0]["package_code"] == PACKAGE

    response = client.patch(f"{PRODUCTS}{product_id}/", {"name": "Yangi nom"}, format=format)
    assert response.status_code == 200
    variant.refresh_from_db()
    assert (variant.mxik, variant.package_code) == (MXIK, PACKAGE)

    response = client.patch(f"{PRODUCTS}{product_id}/", {"mxik": "", "package_code": "  "}, format=format)
    assert response.status_code == 200, response.data
    variant.refresh_from_db()
    assert variant.mxik is variant.package_code is None


def test_variant_create_and_patch_support_independent_codes(client, tenant):
    product = ProductFactory(tenant=tenant)
    response = client.post(
        f"{PRODUCTS}{product.pk}/variants/",
        {
            "name": "Qop",
            "price_partner": "1",
            "price_min": "2",
            "price_recommended": "3",
            "mxik": MXIK,
            "package_code": PACKAGE,
        },
        format="json",
    )
    assert response.status_code == 201, response.data
    variant_id = response.data["id"]
    response = client.patch(f"/api/v1/catalog/variants/{variant_id}/", {"package_code": "0009"}, format="json")
    assert response.status_code == 200
    assert response.data["mxik"] == MXIK
    assert response.data["package_code"] == "0009"
    response = client.patch(f"/api/v1/catalog/variants/{variant_id}/", {"mxik": None}, format="json")
    assert response.status_code == 200
    assert response.data["mxik"] is None
    assert response.data["package_code"] == "0009"


@pytest.mark.parametrize(
    "field,value",
    [
        ("mxik", "123"),
        ("mxik", "A" * 17),
        ("mxik", "١" * 17),
        ("mxik", "1" * 18),
        ("mxik", 3816001001000000),
        ("package_code", 1234),
        ("package_code", "1" * 21),
        ("package_code", "12 34"),
        ("package_code", "12\n34"),
    ],
)
def test_invalid_code_rejects_entire_product_edit(client, tenant, field, value):
    product = ProductFactory(tenant=tenant, name="Asl nom")
    variant = ProductVariantFactory(product=product, tenant=tenant, mxik=MXIK, package_code=PACKAGE)
    response = client.patch(f"{PRODUCTS}{product.pk}/", {"name": "O‘zgarmasin", field: value}, format="json")
    assert response.status_code == 400, response.data
    assert field in str(response.data)
    product.refresh_from_db()
    variant.refresh_from_db()
    assert product.name == "Asl nom"
    assert (variant.mxik, variant.package_code) == (MXIK, PACKAGE)


def test_codes_respect_tenant_and_edit_permission(client, tenant):
    foreign = ProductVariantFactory()
    response = client.patch(f"/api/v1/catalog/variants/{foreign.pk}/", {"mxik": MXIK}, format="json")
    assert response.status_code == 404
    foreign.refresh_from_db()
    assert foreign.mxik is None
    own = ProductVariantFactory(tenant=tenant)
    staff = StaffFactory()
    EmployeeFactory(user=staff, tenant=tenant)
    client.force_authenticate(staff)
    response = client.patch(f"/api/v1/catalog/variants/{own.pk}/", {"mxik": MXIK}, format="json")
    assert response.status_code == 403
    own.refresh_from_db()
    assert own.mxik is None


def test_product_service_validates_and_preserves_optional_codes(tenant):
    category = CategoryFactory(tenant=tenant)
    values = dict(
        tenant=tenant,
        name="Sement",
        category=category,
        price_partner=Decimal("1"),
        price_min=Decimal("2"),
        price_recommended=Decimal("3"),
    )
    with pytest.raises(ProductServiceError, match="17"):
        ProductService.create(**values, mxik="bad")
    assert not Product.objects.filter(tenant=tenant).exists()
    product = ProductService.create(**values)
    assert product.variants.get().mxik is None
    variant = ProductService.add_variant(
        product=product,
        name="Qop",
        price_partner=Decimal("1"),
        price_min=Decimal("2"),
        price_recommended=Decimal("3"),
        mxik=MXIK,
        package_code=PACKAGE,
    )
    assert (variant.mxik, variant.package_code) == (MXIK, PACKAGE)
