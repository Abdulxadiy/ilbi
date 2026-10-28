from decimal import Decimal

import pytest

from apps.catalog.services import ProductService, ProductServiceError
from tests.factories import CategoryFactory, ProductFactory, ProductVariantFactory, TenantFactory

pytestmark = pytest.mark.django_db


class TestProductCreate:
    def test_creating_a_product_always_creates_its_first_variant(self, tenant):
        category = CategoryFactory(tenant=tenant, kod="10")
        product = ProductService.create(
            tenant=tenant,
            name="Non",
            category=category,
            price_partner=Decimal("2000"),
            price_min=Decimal("2500"),
            price_recommended=Decimal("3000"),
        )
        assert product.variants.count() == 1
        variant = product.variants.first()
        assert variant.name == "Standart"
        assert variant.price_min == Decimal("2500")

    def test_variant_sku_is_auto_assigned_and_unique_per_tenant(self, tenant):
        category = CategoryFactory(tenant=tenant, kod="10")
        p1 = ProductService.create(
            tenant=tenant, name="A", category=category,
            price_partner=Decimal("1000"), price_min=Decimal("1000"), price_recommended=Decimal("1000"),
        )
        p2 = ProductService.create(
            tenant=tenant, name="B", category=category,
            price_partner=Decimal("1000"), price_min=Decimal("1000"), price_recommended=Decimal("1000"),
        )
        assert p1.variants.first().sku != p2.variants.first().sku

    def test_code_is_assembled_from_top_level_category(self, tenant):
        category = CategoryFactory(tenant=tenant, kod="32", parent=None)
        product = ProductService.create(
            tenant=tenant, name="Kola", category=category,
            price_partner=Decimal("8000"), price_min=Decimal("12000"), price_recommended=Decimal("15000"),
        )
        assert product.variants.first().code == "32/12"

    def test_code_is_assembled_from_subcategory(self, tenant):
        top = CategoryFactory(tenant=tenant, kod="32", parent=None)
        sub = CategoryFactory(tenant=tenant, kod="45", parent=top)
        product = ProductService.create(
            tenant=tenant, name="Kola", category=sub,
            price_partner=Decimal("8000"), price_min=Decimal("12000"), price_recommended=Decimal("15000"),
        )
        assert product.variants.first().code == "32/45/12"

    def test_code_price_segment_truncates_below_1000_to_zero(self, tenant):
        category = CategoryFactory(tenant=tenant, kod="32")
        product = ProductService.create(
            tenant=tenant, name="Sirg'a", category=category,
            price_partner=Decimal("400"), price_min=Decimal("500"), price_recommended=Decimal("600"),
        )
        assert product.variants.first().code == "32/0"

    def test_category_from_a_different_tenant_is_rejected(self, tenant):
        other_tenants_category = CategoryFactory()
        with pytest.raises(ProductServiceError):
            ProductService.create(
                tenant=tenant, name="X", category=other_tenants_category,
                price_partner=Decimal("1"), price_min=Decimal("1"), price_recommended=Decimal("1"),
            )


class TestAddVariant:
    def test_add_variant_reuses_products_category_for_code(self, tenant):
        category = CategoryFactory(tenant=tenant, kod="32")
        product = ProductFactory(tenant=tenant, category=category)
        variant = ProductService.add_variant(
            product=product, name="L / Qizil",
            price_partner=Decimal("8000"), price_min=Decimal("9000"), price_recommended=Decimal("11000"),
        )
        assert variant.code == "32/9"
        assert variant.sku  # auto-assigned, non-empty

    def test_duplicate_variant_name_within_same_product_is_rejected(self, tenant):
        product = ProductFactory(tenant=tenant)
        ProductVariantFactory(product=product, tenant=tenant, name="M / Ko'k")
        with pytest.raises(ProductServiceError):
            ProductService.add_variant(
                product=product, name="M / Ko'k",
                price_partner=Decimal("1"), price_min=Decimal("1"), price_recommended=Decimal("1"),
            )

    def test_same_variant_name_is_fine_on_a_different_product(self, tenant):
        p1 = ProductFactory(tenant=tenant)
        p2 = ProductFactory(tenant=tenant)
        ProductVariantFactory(product=p1, tenant=tenant, name="M / Ko'k")
        # Must not raise.
        variant = ProductService.add_variant(
            product=p2, name="M / Ko'k",
            price_partner=Decimal("1"), price_min=Decimal("1"), price_recommended=Decimal("1"),
        )
        assert variant.name == "M / Ko'k"

    def test_blank_barcode_is_stored_as_none_not_empty_string(self, tenant):
        product = ProductFactory(tenant=tenant)
        variant = ProductService.add_variant(
            product=product, name="X", barcode="",
            price_partner=Decimal("1"), price_min=Decimal("1"), price_recommended=Decimal("1"),
        )
        assert variant.barcode is None


class TestProductArchive:
    def test_archiving_a_product_cascades_to_all_its_variants(self, tenant):
        product = ProductFactory(tenant=tenant, is_active=True)
        v1 = ProductVariantFactory(product=product, tenant=tenant, name="A", is_active=True)
        v2 = ProductVariantFactory(product=product, tenant=tenant, name="B", is_active=True)

        ProductService.archive(product)

        product.refresh_from_db()
        v1.refresh_from_db()
        v2.refresh_from_db()
        assert product.is_active is False
        assert v1.is_active is False
        assert v2.is_active is False

import io
from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from apps.catalog.models import ProductImage
from apps.core.utils.image_optimizer import optimize_image


class TestProductGalleryImages:
    def _create_sample_image(self, width=2000, height=2000):
        buffer = io.BytesIO()
        img = Image.new("RGB", (width, height), color="red")
        img.save(buffer, format="JPEG")
        buffer.seek(0)
        return SimpleUploadedFile("test.jpg", buffer.getvalue(), content_type="image/jpeg")

    def test_image_optimizer_resizes_down_to_max_1600(self):
        sample = self._create_sample_image(2400, 1800)
        optimized = optimize_image(sample)
        img = Image.open(optimized)
        assert img.width <= 1600 and img.height <= 1600
        assert img.format == "WEBP"

    def test_product_allows_up_to_3_images(self, tenant):
        category = CategoryFactory(tenant=tenant)
        product = ProductService.create(
            tenant=tenant,
            name="Telefon",
            category=category,
            price_partner=Decimal("100"),
            price_min=Decimal("120"),
            price_recommended=Decimal("150"),
        )

        img1 = ProductService.add_image(product=product, image_file=self._create_sample_image())
        img2 = ProductService.add_image(product=product, image_file=self._create_sample_image())
        img3 = ProductService.add_image(product=product, image_file=self._create_sample_image())
        assert product.gallery_images.count() == 3

        # 4th image must be rejected
        with pytest.raises(ProductServiceError, match="maksimal 3 tagacha"):
            ProductService.add_image(product=product, image_file=self._create_sample_image())

        # Remove image and add again
        ProductService.remove_image(product=product, image_id=img1.id)
        assert product.gallery_images.count() == 2
        ProductService.add_image(product=product, image_file=self._create_sample_image())
        assert product.gallery_images.count() == 3
