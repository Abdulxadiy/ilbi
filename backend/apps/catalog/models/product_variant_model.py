"""ProductVariant -- the actual sellable unit. Price, sku, and stock
identity all live here, never on Product. See
Architectures/ilbi-yol-xaritasi.md, 9-bosqich, for the full
field-by-field design rationale (sku vs. code vs. barcode in
particular -- three fields that sound similar but serve unrelated
purposes)."""

from django.db import models

from apps.catalog.fiscal_metadata import validate_mxik, validate_package_code
from apps.core.models import BaseModel


class ProductVariant(BaseModel):
    UNIT_CHOICES = [
        ("dona", "Dona"),
        ("kg", "Kilogramm"),
        ("litr", "Litr"),
        ("metr", "Metr"),
    ]

    product = models.ForeignKey(
        "catalog.Product", on_delete=models.CASCADE, related_name="variants"
    )

    # Free-text differentiator, e.g. "M / Ko'k". Unique within its
    # Product, but may repeat freely across different Products.
    name = models.CharField(max_length=150)

    # Internal, machine-only identifier. Auto-incrementing per tenant
    # (ProductService._next_sku), never shown to or edited by the
    # owner. inventory/sales MUST reference variants via `sku` (or the
    # row's own pk) -- never via `code`, which is not unique.
    sku = models.CharField(max_length=32, editable=False)

    # Owner-facing display label, e.g. "32/45/12" -- assembled from
    # Category.kod (+ subcategory.kod when applicable) and
    # (price_min // 1000) at creation time (ProductService._build_code).
    # Freely editable afterwards, INCLUDING the price segment -- it
    # does NOT re-sync when price_min changes later (frozen by design,
    # confirmed 2026-09). Deliberately NOT unique: a pure
    # human-recognition label, nothing else may ever reference a
    # variant by `code`.
    code = models.CharField(max_length=64, blank=True)

    # Real physical barcode, optional -- many small shops don't have
    # one. Stored as NULL (never empty string) when absent, so the
    # partial unique constraint below only ever compares real values.
    barcode = models.CharField(max_length=64, null=True, blank=True)

    # Fiscal catalog identifiers are independent of our SKU/code and physical barcode.
    mxik = models.CharField(max_length=17, null=True, blank=True, validators=[validate_mxik])
    package_code = models.CharField(max_length=20, null=True, blank=True, validators=[validate_package_code])

    # Override for Product.image -- falls back to the parent Product's
    # image when unset (see api/v1/catalog serializers).
    image = models.ImageField(upload_to="catalog/variants/", null=True, blank=True)

    unit = models.CharField(max_length=10, choices=UNIT_CHOICES, default="dona")

    # Three sale-facing prices -- see roadmap 9-bosqich for the exact
    # semantics of each. None of these three is "the" price; which one
    # applies to a given sale is a sales-app decision, not catalog's.
    price_partner = models.DecimalField(max_digits=12, decimal_places=2)
    price_min = models.DecimalField(max_digits=12, decimal_places=2)
    price_recommended = models.DecimalField(max_digits=12, decimal_places=2)

    # Advisory only -- NOT enforced anywhere in the service layer.
    # Selling below price_min is always allowed; the UI/serializer may
    # warn about it, but this app never blocks it.

    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "sku"], name="unique_variant_sku_per_tenant"
            ),
            models.UniqueConstraint(
                fields=["product", "name"],
                name="unique_variant_name_per_product",
            ),
            models.UniqueConstraint(
                fields=["tenant", "barcode"],
                name="unique_variant_barcode_per_tenant",
                condition=models.Q(barcode__isnull=False),
            ),
        ]

    def __str__(self):
        return f"{self.product.name} ({self.name})"

    @property
    def currency(self) -> str:
        return self.product.category.currency
