from apps.core.media_urls import public_media_url
from rest_framework import serializers

from apps.catalog.models import ProductVariant


class ShopProductVariantSerializer(serializers.ModelSerializer):
    product_id = serializers.IntegerField(source="product.id", read_only=True)
    product_name = serializers.CharField(source="product.name", read_only=True)
    category_id = serializers.IntegerField(source="product.category_id", read_only=True)
    category_name = serializers.CharField(source="product.category.name", read_only=True)
    price = serializers.DecimalField(source="price_recommended", max_digits=12, decimal_places=2, read_only=True)
    stock_quantity = serializers.SerializerMethodField()
    image_url = serializers.SerializerMethodField()
    gallery_images = serializers.SerializerMethodField()

    class Meta:
        model = ProductVariant
        fields = [
            "id",
            "product_id",
            "product_name",
            "category_id",
            "category_name",
            "name",
            "sku",
            "barcode",
            "price",
            "currency",
            "stock_quantity",
            "image_url",
            "gallery_images",
            "is_active",
        ]
        read_only_fields = fields

    def get_stock_quantity(self, obj) -> str:
        stock = getattr(obj, "stock", None)
        return str(stock.quantity) if stock else "0.000"

    def _clean_url(self, url):
        if not url:
            return None
        request = self.context.get("request")
        res = request.build_absolute_uri(url) if request else url
        return public_media_url(res)

    def get_image_url(self, obj) -> str | None:
        image = obj.image or obj.product.image
        if not image:
            return None
        return self._clean_url(image.url)

    def get_gallery_images(self, obj) -> list[dict]:
        urls = []
        for g in obj.product.gallery_images.all():
            if g.image:
                urls.append(self._clean_url(g.image.url))
        return urls
