"""Product model -- the general concept of an item a tenant sells.
Actual sellable units (with price/sku/stock) live on ProductVariant,
never here -- see product_variant_model.py."""

from django.db import models

from apps.core.models import BaseModel


class Product(BaseModel):
    """
    The general "idea" of an item (e.g. "Futbolka"). Never sold
    directly -- every Product has at least one ProductVariant (the
    actual sellable unit), even for shops with no real size/color
    variation (see ProductService.create(), which auto-creates a
    "Standart" variant when the caller doesn't name one). Price and
    stock live exclusively on ProductVariant.
    """

    name = models.CharField(max_length=200)
    category = models.ForeignKey(
        "catalog.Category", on_delete=models.PROTECT, related_name="products"
    )

    # Main/default image -- shown for any variant that doesn't set its
    # own override (see ProductVariant.image). MinIO isn't in
    # docker-compose yet (12-bosqich); until then this uses Django's
    # default local FileSystemStorage. Switching the backend later is
    # a settings-only change (STORAGES), no model/migration change
    # needed.
    image = models.ImageField(upload_to="catalog/products/", null=True, blank=True)

    # Archiving, not hard-delete -- old Sale/StockMovement rows (once
    # inventory/sales exist) must keep pointing at a real row.
    # Archiving a Product cascades to all its variants -- see
    # ProductService.archive().
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class ProductImage(BaseModel):
    """
    Mahsulotga biriktirilgan qo'shimcha rasmlar (bitta mahsulotga 3 tagacha rasm).
    """
    product = models.ForeignKey(
        Product, on_delete=models.CASCADE, related_name="gallery_images"
    )
    image = models.ImageField(upload_to="catalog/products/gallery/")
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order", "created_at"]

    def __str__(self):
        return f"{self.product.name} - Rasm #{self.id}"
