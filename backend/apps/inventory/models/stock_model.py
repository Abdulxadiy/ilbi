from decimal import Decimal

from django.db import models

from apps.core.models import BaseModel


class Stock(BaseModel):
    product_variant = models.OneToOneField(
        "catalog.ProductVariant", on_delete=models.CASCADE, related_name="stock"
    )
    quantity = models.DecimalField(max_digits=14, decimal_places=3, default=Decimal("0"))
    last_cost_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(quantity__gte=0), name="stock_quantity_never_negative"
            ),
        ]

    def __str__(self):
        return f"{self.product_variant} -- {self.quantity}"