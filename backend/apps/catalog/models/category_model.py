"""Category model -- a 2-level (parent/child) product taxonomy per tenant."""

from django.db import models
from apps.core.models import BaseModel


class Category(BaseModel):
    """
    A product category, scoped to a tenant.

    Deliberately limited to 2 levels (a category may have a parent, but
    a category that already has a parent may not itself become a
    parent -- enforced in CategoryService, not here) instead of an
    unbounded tree. See Architectures/ilbi-yol-xaritasi.md,
    9-bosqich, for the rationale: real shops rarely need more than 2
    levels, and this avoids pulling in a tree library
    (django-mptt/treebeard) for a constraint that's easy to lift later
    if ever needed.
    """

    name = models.CharField(max_length=150)
    kod = models.CharField(max_length=20)

    parent = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="subcategories",
    )

    CURRENCY_UZS = "UZS"
    CURRENCY_USD = "USD"
    CURRENCY_CHOICES = [
        (CURRENCY_UZS, "UZS"),
        (CURRENCY_USD, "USD"),
    ]

    currency = models.CharField(
        max_length=3,
        choices=CURRENCY_CHOICES,
        default=CURRENCY_UZS,
        help_text="Kategoriya valyutasi (UZS yoki USD)",
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "kod"], name="unique_category_kod_per_tenant"
            ),
        ]
        verbose_name_plural = "categories"

    def __str__(self):
        return self.name
