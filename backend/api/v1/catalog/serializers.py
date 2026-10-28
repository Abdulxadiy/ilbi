from apps.core.media_urls import public_media_url
from decimal import Decimal

from rest_framework import serializers

from apps.catalog.models import Category, Product, ProductImage, ProductVariant
from apps.catalog.fiscal_metadata import validate_mxik, validate_package_code


class FiscalCodeField(serializers.CharField):
    """Keep leading zeroes and reject numeric JSON before it can lose precision."""

    def to_internal_value(self, data):
        if not isinstance(data, str):
            self.fail("invalid")
        return super().to_internal_value(data)

    def run_validation(self, data=serializers.empty):
        value = super().run_validation(data)
        return value or None


class FiscalMetadataInputSerializer(serializers.Serializer):
    mxik = FiscalCodeField(
        max_length=17, required=False, allow_null=True, allow_blank=True, validators=[validate_mxik]
    )
    package_code = FiscalCodeField(
        max_length=20, required=False, allow_null=True, allow_blank=True, validators=[validate_package_code]
    )


class CategoryOutputSerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "name", "kod", "parent", "currency", "is_active"]
        read_only_fields = fields


class CategoryCreateSerializer(serializers.Serializer):
    """Validates input for creating a Category. `kod` can be optionally
    provided by caller or system-assigned (see CategoryService.create())."""

    name = serializers.CharField(max_length=150)
    kod = serializers.CharField(max_length=20, required=False, allow_blank=True)
    parent_id = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.all(), source="parent", required=False, allow_null=True
    )
    currency = serializers.ChoiceField(
        choices=Category.CURRENCY_CHOICES, default=Category.CURRENCY_UZS, required=False
    )


class CategoryUpdateSerializer(serializers.Serializer):
    """Validates input for editing a Category. All fields optional."""

    name = serializers.CharField(max_length=150, required=False)
    kod = serializers.CharField(max_length=20, required=False)
    parent_id = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.all(), source="parent", required=False, allow_null=True
    )
    clear_parent = serializers.BooleanField(required=False, default=False)
    currency = serializers.ChoiceField(
        choices=Category.CURRENCY_CHOICES, required=False
    )


def _clean_media_url(url: str, request=None) -> str:
    if not url:
        return None
    res = request.build_absolute_uri(url) if request else url
    return public_media_url(res)


class ProductImageSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = ProductImage
        fields = ["id", "image", "image_url", "order", "created_at"]
        read_only_fields = ["id", "image_url", "created_at"]

    def get_image_url(self, obj) -> str | None:
        if not obj.image:
            return None
        return _clean_media_url(obj.image.url, self.context.get("request"))


class ProductVariantOutputSerializer(serializers.ModelSerializer):
    image = serializers.SerializerMethodField()
    images = serializers.SerializerMethodField()
    gallery_images = serializers.SerializerMethodField()
    currency = serializers.CharField(read_only=True)
    product_name = serializers.CharField(source="product.name", read_only=True)
    category_id = serializers.IntegerField(source="product.category_id", read_only=True)
    category_name = serializers.CharField(source="product.category.name", read_only=True)
    stock_quantity = serializers.SerializerMethodField()
    expired_batches = serializers.SerializerMethodField()

    class Meta:
        model = ProductVariant
        fields = [
            "id", "product", "product_name", "category_id", "category_name",
            "name", "sku", "code", "barcode", "image", "images", "gallery_images", "unit",
            "mxik", "package_code",
            "currency", "price_partner", "price_min", "price_recommended",
            "stock_quantity", "expired_batches", "is_active",
        ]
        read_only_fields = ["id", "product", "sku", "is_active", "currency", "stock_quantity", "images", "gallery_images"]

    def get_expired_batches(self, obj) -> list[dict]:
        from apps.inventory.services.batch_service import BatchService
        return BatchService.warnings(obj)

    def _get_stock(self, obj):
        return getattr(obj, "stock", None)

    def get_stock_quantity(self, obj) -> str:
        st = self._get_stock(obj)
        return str(st.quantity) if st else "0.000"

    def get_image(self, obj) -> str | None:
        image = obj.image or (obj.product.image if hasattr(obj, "product") and obj.product else None)
        if not image:
            return None
        return _clean_media_url(image.url, self.context.get("request"))

    def get_images(self, obj) -> list[str]:
        request = self.context.get("request")
        urls = []
        main_img = obj.image or (obj.product.image if hasattr(obj, "product") and obj.product else None)
        if main_img:
            cleaned = _clean_media_url(main_img.url, request)
            if cleaned and cleaned not in urls:
                urls.append(cleaned)

        if hasattr(obj, "product") and obj.product:
            for gi in obj.product.gallery_images.all():
                if gi.image:
                    cleaned = _clean_media_url(gi.image.url, request)
                    if cleaned and cleaned not in urls:
                        urls.append(cleaned)
        return urls

    def get_gallery_images(self, obj) -> list[dict]:
        request = self.context.get("request")
        res = []
        if hasattr(obj, "product") and obj.product:
            for gi in obj.product.gallery_images.all():
                if gi.image:
                    res.append({
                        "id": gi.id,
                        "image": _clean_media_url(gi.image.url, request),
                        "order": gi.order,
                    })
        return res



class ProductVariantCreateSerializer(FiscalMetadataInputSerializer):
    """Validates input for adding a variant to an existing Product."""

    name = serializers.CharField(max_length=150)
    code = serializers.CharField(max_length=64, required=False, allow_blank=True)
    unit = serializers.ChoiceField(choices=ProductVariant.UNIT_CHOICES, default="dona")
    barcode = serializers.CharField(max_length=64, required=False, allow_null=True, allow_blank=True)
    image = serializers.ImageField(required=False, allow_null=True)
    price_partner = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))
    price_min = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))
    price_recommended = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))


class ProductVariantUpdateSerializer(FiscalMetadataInputSerializer):
    """Validates input for editing an existing variant -- everything
    optional, a PATCH may touch any subset. `code` is included here on
    purpose: it's freely editable, including its price segment (see
    ProductVariant.code docstring -- it never auto-resyncs)."""

    name = serializers.CharField(max_length=150, required=False)
    code = serializers.CharField(max_length=64, required=False, allow_blank=True)
    unit = serializers.ChoiceField(choices=ProductVariant.UNIT_CHOICES, required=False)
    barcode = serializers.CharField(max_length=64, required=False, allow_null=True, allow_blank=True)
    image = serializers.ImageField(required=False, allow_null=True)
    price_partner = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, min_value=Decimal("0"))
    price_min = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, min_value=Decimal("0"))
    price_recommended = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, min_value=Decimal("0"))


class ProductOutputSerializer(serializers.ModelSerializer):
    variants = ProductVariantOutputSerializer(many=True, read_only=True)
    gallery_images = ProductImageSerializer(many=True, read_only=True)
    image = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = ["id", "name", "category", "image", "gallery_images", "is_active", "variants"]
        read_only_fields = ["id", "is_active", "variants", "gallery_images"]

    def get_image(self, obj) -> str | None:
        if not obj.image:
            return None
        return _clean_media_url(obj.image.url, self.context.get("request"))


class ProductCreateSerializer(FiscalMetadataInputSerializer):
    """Validates input for creating a Product together with its
    mandatory first ProductVariant (see ProductService.create())."""

    name = serializers.CharField(max_length=200)
    category_id = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.all(), source="category"
    )
    image = serializers.ImageField(required=False, allow_null=True)
    unit = serializers.ChoiceField(choices=ProductVariant.UNIT_CHOICES, default="dona")
    variant_name = serializers.CharField(max_length=150, required=False, default="Standart")
    code = serializers.CharField(max_length=64, required=False, allow_blank=True)
    barcode = serializers.CharField(max_length=64, required=False, allow_blank=True, allow_null=True)
    price_partner = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))
    price_min = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))
    price_recommended = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))

    # Optional immediate stock intake fields
    initial_quantity = serializers.DecimalField(
        max_digits=14, decimal_places=3, required=False, allow_null=True, min_value=Decimal("0.001")
    )
    initial_cost_price = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, allow_null=True, min_value=Decimal("0")
    )
    supplier = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    intake_note = serializers.CharField(required=False, allow_blank=True, default="")
    expires_on = serializers.DateField(required=False, allow_null=True)
    batch_code = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")


class ProductUpdateSerializer(FiscalMetadataInputSerializer):
    """Validates input for editing a Product and optionally its variant fields."""

    name = serializers.CharField(max_length=200, required=False)
    category_id = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.all(), source="category", required=False
    )
    image = serializers.ImageField(required=False, allow_null=True)

    # Optional variant convenience fields
    variant_id = serializers.IntegerField(required=False)
    unit = serializers.ChoiceField(choices=ProductVariant.UNIT_CHOICES, required=False)
    code = serializers.CharField(max_length=64, required=False, allow_blank=True)
    barcode = serializers.CharField(max_length=64, required=False, allow_null=True, allow_blank=True)
    price_partner = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, min_value=Decimal("0"))
    price_min = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, min_value=Decimal("0"))
    price_recommended = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, min_value=Decimal("0"))
