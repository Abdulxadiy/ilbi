from apps.accounts.models import Employee
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.permissions.models import Permission
from tests.factories import CategoryFactory, EmployeeFactory, StaffFactory, TenantFactory

pytestmark = pytest.mark.django_db

CATEGORIES_URL = "/api/v1/catalog/categories/"
PRODUCTS_URL = "/api/v1/catalog/products/"


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def staff_with_permission(tenant):
    """A staff member with an active Employee record in `tenant`, granted
    every catalog permission -- the common case most tests want."""
    user = StaffFactory()
    employee = EmployeeFactory(user=user, tenant=tenant, is_active=True)
    employee.permissions.set(Permission.objects.filter(category="catalog"))
    return user


class TestPlatformAdminIsBlocked:
    def test_platform_admin_cannot_list_categories(self, api_client, platform_admin):
        api_client.force_authenticate(user=platform_admin)
        response = api_client.get(CATEGORIES_URL)
        assert response.status_code == 403

    def test_platform_admin_cannot_create_a_product(self, api_client, platform_admin):
        api_client.force_authenticate(user=platform_admin)
        response = api_client.post(PRODUCTS_URL, {"name": "X"})
        assert response.status_code == 403


class TestPermissionEnforcement:
    def test_staff_with_no_permission_at_all_is_denied(self, api_client, tenant):
        user = StaffFactory()
        EmployeeFactory(user=user, tenant=tenant, is_active=True)  # no permissions granted
        api_client.force_authenticate(user=user)

        response = api_client.get(CATEGORIES_URL)
        assert response.status_code == 403

    def test_view_permission_does_not_grant_add(self, api_client, tenant):
        user = StaffFactory()
        employee = EmployeeFactory(user=user, tenant=tenant, is_active=True)
        employee.permissions.add(
            Permission.objects.get(category="catalog", codename="view_category")
        )
        api_client.force_authenticate(user=user)

        get_response = api_client.get(CATEGORIES_URL)
        post_response = api_client.post(CATEGORIES_URL, {"name": "Ichimliklar"})

        assert get_response.status_code == 200
        assert post_response.status_code == 403

    def test_owner_bypasses_permission_grants_entirely(self, api_client, owner, tenant):
        # Owner never needs an explicit Permission row -- PermissionService
        # grants them everything within their own tenant automatically.
        api_client.force_authenticate(user=owner)
        response = api_client.post(CATEGORIES_URL, {"name": "Ichimliklar"})
        assert response.status_code == 201


class TestTenantIsolation:
    def test_owner_cannot_see_another_tenants_categories(self, api_client, owner, tenant):
        other_tenant = TenantFactory()
        CategoryFactory(tenant=other_tenant, name="Boshqa do'kon kategoriyasi")
        CategoryFactory(tenant=tenant, name="Mening kategoriyam")

        api_client.force_authenticate(user=owner)
        response = api_client.get(CATEGORIES_URL)

        names = [c["name"] for c in response.data]
        assert "Mening kategoriyam" in names
        assert "Boshqa do'kon kategoriyasi" not in names

    def test_fetching_another_tenants_category_by_id_is_404_not_403(self, api_client, owner, tenant):
        # Must not leak existence -- see CategoryDetailView docstring.
        other_tenant = TenantFactory()
        foreign_category = CategoryFactory(tenant=other_tenant)

        api_client.force_authenticate(user=owner)
        response = api_client.get(f"{CATEGORIES_URL}{foreign_category.id}/")
        assert response.status_code == 404


class TestCategoryCreateFlow:
    def test_kod_can_be_provided_or_auto_assigned(self, api_client, staff_with_permission):
        api_client.force_authenticate(user=staff_with_permission)
        # 1. Custom kod provided
        response = api_client.post(CATEGORIES_URL, {"name": "Ichimliklar", "kod": "99"})
        assert response.status_code == 201
        assert response.data["kod"] == "99"

        # 2. Kod omitted -> auto-assigned next sequential (len=1 -> 02)
        response2 = api_client.post(CATEGORIES_URL, {"name": "Shirinliklar"})
        assert response2.status_code == 201
        assert response2.data["kod"] == "02"


class TestProductCreateFlow:
    def test_creating_a_product_returns_its_mandatory_first_variant(self, api_client, staff_with_permission, tenant):
        category = CategoryFactory(tenant=tenant, kod="32")
        api_client.force_authenticate(user=staff_with_permission)

        response = api_client.post(PRODUCTS_URL, {
            "name": "Non",
            "category_id": category.id,
            "price_partner": "2000",
            "price_min": "2500",
            "price_recommended": "3000",
        })

        assert response.status_code == 201
        assert len(response.data["variants"]) == 1
        assert response.data["variants"][0]["name"] == "Standart"
        assert response.data["variants"][0]["code"] == "32/2"
        assert response.data["variants"][0]["stock_quantity"] == "0.000"

    def test_creating_a_product_with_initial_stock_intake(self, api_client, staff_with_permission, tenant):
        from decimal import Decimal
        from apps.inventory.models import StockMovement

        Employee.objects.get(user=staff_with_permission, tenant=tenant, is_active=True).permissions.add(
            Permission.objects.get(category="inventory", codename="add_stock_intake")
        )
        category = CategoryFactory(tenant=tenant, kod="32")
        api_client.force_authenticate(user=staff_with_permission)

        response = api_client.post(PRODUCTS_URL, {
            "name": "Coca Cola 1.5L",
            "category_id": category.id,
            "price_partner": "10000",
            "price_min": "11000",
            "price_recommended": "13000",
            "initial_quantity": "25.000",
            "initial_cost_price": "9000.00",
            "supplier": "Coca-Cola Bottlers",
            "intake_note": "Faktura #12345",
        })

        assert response.status_code == 201
        variant_data = response.data["variants"][0]
        assert variant_data["stock_quantity"] == "25.000"

        movement = StockMovement.objects.filter(product_variant_id=variant_data["id"]).first()
        assert movement is not None
        assert movement.quantity == Decimal("25.000")
        assert movement.cost_price == Decimal("9000.00")
        assert "Ta’minotchi: Coca-Cola Bottlers" in movement.note
        assert "Faktura #12345" in movement.note

    def test_archive_cascades_through_the_api(self, api_client, staff_with_permission, tenant):
        category = CategoryFactory(tenant=tenant, kod="32")
        api_client.force_authenticate(user=staff_with_permission)
        create_response = api_client.post(PRODUCTS_URL, {
            "name": "Non", "category_id": category.id,
            "price_partner": "2000", "price_min": "2500", "price_recommended": "3000",
        })
        product_id = create_response.data["id"]

        archive_response = api_client.post(f"{PRODUCTS_URL}{product_id}/archive/")

        assert archive_response.status_code == 200
        assert archive_response.data["is_active"] is False
        assert archive_response.data["variants"][0]["is_active"] is False

    def test_creating_a_product_with_custom_code(self, api_client, staff_with_permission, tenant):
        category = CategoryFactory(tenant=tenant, kod="01")
        api_client.force_authenticate(user=staff_with_permission)

        response = api_client.post(PRODUCTS_URL, {
            "name": "Pepsi 1.5L",
            "category_id": category.id,
            "code": "01/02/15",
            "price_partner": "10000",
            "price_min": "12000",
            "price_recommended": "14000",
        })

        assert response.status_code == 201
        assert response.data["variants"][0]["code"] == "01/02/15"

    def test_search_product_by_code(self, api_client, staff_with_permission, tenant):
        category = CategoryFactory(tenant=tenant, kod="01")
        api_client.force_authenticate(user=staff_with_permission)

        api_client.post(PRODUCTS_URL, {
            "name": "Fanta",
            "category_id": category.id,
            "code": "01/03/18",
            "price_partner": "10000",
            "price_min": "12000",
            "price_recommended": "14000",
        })

        res = api_client.get(f"{PRODUCTS_URL}?search=01/03/18")
        assert res.status_code == 200
        assert len(res.data) == 1
        assert res.data[0]["name"] == "Fanta"

    def test_search_category_by_kod(self, api_client, staff_with_permission, tenant):
        CategoryFactory(tenant=tenant, name="Meva", kod="77")
        api_client.force_authenticate(user=staff_with_permission)

        res = api_client.get(f"{CATEGORIES_URL}?search=77")
        assert res.status_code == 200
        assert any(c["kod"] == "77" for c in res.data)

    def test_create_product_with_image_multipart(self, api_client, staff_with_permission, tenant):
        from django.core.files.uploadedfile import SimpleUploadedFile
        category = CategoryFactory(tenant=tenant, kod="01")
        api_client.force_authenticate(user=staff_with_permission)

        small_gif = (
            b'\x47\x49\x46\x38\x39\x61\x01\x00\x01\x00\x80\x00\x00\x05\x04\x04'
            b'\x00\x00\x00\x2c\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02\x44'
            b'\x01\x00\x3b'
        )
        image = SimpleUploadedFile("item.gif", small_gif, content_type="image/gif")

        data = {
            "name": "Coca-Cola 1.5L",
            "category_id": category.id,
            "unit": "dona",
            "variant_name": "Standart",
            "code": "01/01/12",
            "price_partner": "9000",
            "price_min": "12000",
            "price_recommended": "15000",
            "image": image,
        }
        res = api_client.post(PRODUCTS_URL, data, format="multipart")
        assert res.status_code == 201
        assert res.data["name"] == "Coca-Cola 1.5L"
        assert res.data["image"] is not None


class TestEditAndDeleteCategoryAndProduct:
    def test_delete_category_success_when_empty(self, api_client, staff_with_permission, tenant):
        cat = CategoryFactory(tenant=tenant, name="Bo'sh Kategoriya")
        api_client.force_authenticate(user=staff_with_permission)

        res = api_client.delete(f"{CATEGORIES_URL}{cat.id}/")
        assert res.status_code == 204
        from apps.catalog.models import Category
        assert not Category.objects.filter(id=cat.id).exists()

    def test_delete_category_blocked_when_has_products(self, api_client, staff_with_permission, tenant):
        cat = CategoryFactory(tenant=tenant, name="Oziq-ovqat")
        from apps.catalog.models import Category
        from tests.factories import ProductFactory
        ProductFactory(tenant=tenant, category=cat, name="Non")
        api_client.force_authenticate(user=staff_with_permission)

        res = api_client.delete(f"{CATEGORIES_URL}{cat.id}/")
        assert res.status_code == 400
        assert "mahsulotlar mavjud" in res.data["detail"]
        assert Category.objects.filter(id=cat.id).exists()

    def test_delete_category_blocked_when_has_subcategories(self, api_client, staff_with_permission, tenant):
        parent_cat = CategoryFactory(tenant=tenant, name="Elektronika")
        CategoryFactory(tenant=tenant, name="Telefonlar", parent=parent_cat)
        from apps.catalog.models import Category
        api_client.force_authenticate(user=staff_with_permission)

        res = api_client.delete(f"{CATEGORIES_URL}{parent_cat.id}/")
        assert res.status_code == 400
        assert "subkategoriyalar mavjud" in res.data["detail"]
        assert Category.objects.filter(id=parent_cat.id).exists()

    def test_patch_category_update_name_and_kod(self, api_client, staff_with_permission, tenant):
        cat = CategoryFactory(tenant=tenant, name="Eski Nom", kod="05")
        api_client.force_authenticate(user=staff_with_permission)

        res = api_client.patch(f"{CATEGORIES_URL}{cat.id}/", {"name": "Yangi Nom", "kod": "95"})
        assert res.status_code == 200
        assert res.data["name"] == "Yangi Nom"
        assert res.data["kod"] == "95"

    def test_delete_product_hard_deletes_when_no_sales(self, api_client, staff_with_permission, tenant):
        from tests.factories import ProductFactory, ProductVariantFactory
        from apps.catalog.models import Product, ProductVariant
        prod = ProductFactory(tenant=tenant, name="O'chadigan Tovar")
        ProductVariantFactory(tenant=tenant, product=prod)
        api_client.force_authenticate(user=staff_with_permission)

        res = api_client.delete(f"{PRODUCTS_URL}{prod.id}/")
        assert res.status_code == 204
        assert not Product.objects.filter(id=prod.id).exists()

    def test_delete_product_archives_when_has_sales(self, api_client, staff_with_permission, tenant):
        from tests.factories import ProductFactory, ProductVariantFactory, SaleFactory, SaleItemFactory
        from apps.catalog.models import Product
        prod = ProductFactory(tenant=tenant, name="Sotilgan Tovar")
        var = ProductVariantFactory(tenant=tenant, product=prod)
        sale = SaleFactory(tenant=tenant)
        SaleItemFactory(sale=sale, product_variant=var)
        api_client.force_authenticate(user=staff_with_permission)

        res = api_client.delete(f"{PRODUCTS_URL}{prod.id}/")
        assert res.status_code == 204
        # Since it has a sale item, it is archived (soft-deleted)
        prod.refresh_from_db()
        assert prod.is_active is False
        var.refresh_from_db()
        assert var.is_active is False

    def test_patch_product_with_variant_fields(self, api_client, staff_with_permission, tenant):
        from tests.factories import ProductFactory, ProductVariantFactory
        prod = ProductFactory(tenant=tenant, name="Eski Mahsulot")
        var = ProductVariantFactory(tenant=tenant, product=prod, price_recommended=Decimal("20000"))
        api_client.force_authenticate(user=staff_with_permission)

        payload = {
            "name": "Yangilangan Mahsulot",
            "price_recommended": "35000",
            "unit": "kg",
        }
        res = api_client.patch(f"{PRODUCTS_URL}{prod.id}/", payload)
        assert res.status_code == 200
        assert res.data["name"] == "Yangilangan Mahsulot"
        var.refresh_from_db()
        assert var.price_recommended == Decimal("35000.00")
        assert var.unit == "kg"


