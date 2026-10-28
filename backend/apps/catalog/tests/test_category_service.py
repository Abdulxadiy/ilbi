import pytest

from apps.catalog.services import CategoryService, CategoryServiceError
from tests.factories import CategoryFactory, TenantFactory

pytestmark = pytest.mark.django_db


class TestCategoryCreate:
    def test_kod_is_auto_assigned_sequentially(self, tenant):
        first = CategoryService.create(tenant=tenant, name="Ichimliklar")
        second = CategoryService.create(tenant=tenant, name="Oziq-ovqat")
        assert first.kod == "01"
        assert second.kod == "02"

    def test_kod_generation_skips_a_manually_taken_number(self, tenant):
        # Owner already hand-picked "02" via update() on some earlier
        # category -- the next auto-assignment must not collide with it.
        CategoryFactory(tenant=tenant, kod="01")
        CategoryFactory(tenant=tenant, kod="02")
        third = CategoryService.create(tenant=tenant, name="Kiyim")
        assert third.kod == "03"

    def test_kod_is_scoped_per_tenant(self):
        # Two different tenants may both have kod "01" -- the unique
        # constraint is (tenant, kod), not kod alone.
        tenant_a = TenantFactory()
        tenant_b = TenantFactory()
        a = CategoryService.create(tenant=tenant_a, name="Ichimliklar")
        b = CategoryService.create(tenant=tenant_b, name="Boshqa")
        assert a.kod == b.kod == "01"

    def test_subcategory_creation_succeeds(self, tenant):
        top = CategoryService.create(tenant=tenant, name="Ichimliklar")
        sub = CategoryService.create(tenant=tenant, name="Gazli", parent=top)
        assert sub.parent_id == top.id

    def test_third_level_is_rejected(self, tenant):
        top = CategoryService.create(tenant=tenant, name="Ichimliklar")
        sub = CategoryService.create(tenant=tenant, name="Gazli", parent=top)
        with pytest.raises(CategoryServiceError):
            CategoryService.create(tenant=tenant, name="Kola", parent=sub)

    def test_parent_from_a_different_tenant_is_rejected(self, tenant):
        other_tenants_category = CategoryFactory()
        with pytest.raises(CategoryServiceError):
            CategoryService.create(tenant=tenant, name="X", parent=other_tenants_category)

    def test_category_currency_defaults_to_uzs(self, tenant):
        cat = CategoryService.create(tenant=tenant, name="Oziq-ovqat")
        assert cat.currency == "UZS"

    def test_category_currency_usd_creation(self, tenant):
        cat = CategoryService.create(tenant=tenant, name="Elektronika", currency="USD")
        assert cat.currency == "USD"

    def test_subcategory_inherits_parent_currency(self, tenant):
        parent_usd = CategoryService.create(tenant=tenant, name="Texnika", currency="USD")
        sub = CategoryService.create(tenant=tenant, name="Telefonlar", parent=parent_usd)
        assert sub.currency == "USD"

    def test_invalid_currency_is_rejected(self, tenant):
        with pytest.raises(CategoryServiceError, match="currency must be 'UZS' or 'USD'"):
            CategoryService.create(tenant=tenant, name="X", currency="EUR")


class TestCategoryUpdate:
    def test_owner_can_change_kod(self, tenant):
        category = CategoryFactory(tenant=tenant, kod="01")
        updated = CategoryService.update(category, kod="99")
        assert updated.kod == "99"

    def test_changing_kod_to_an_already_used_one_is_rejected(self, tenant):
        CategoryFactory(tenant=tenant, kod="01")
        second = CategoryFactory(tenant=tenant, kod="02")
        with pytest.raises(CategoryServiceError):
            CategoryService.update(second, kod="01")

    def test_a_category_may_keep_its_own_kod_unchanged(self, tenant):
        # Passing the SAME kod back must not trip the "already used by
        # ANOTHER category" check against itself.
        category = CategoryFactory(tenant=tenant, kod="01")
        updated = CategoryService.update(category, kod="01", name="Yangi nom")
        assert updated.kod == "01"
        assert updated.name == "Yangi nom"


class TestCategoryArchive:
    def test_archive_sets_is_active_false(self, tenant):
        category = CategoryFactory(tenant=tenant, is_active=True)
        archived = CategoryService.archive(category)
        assert archived.is_active is False
