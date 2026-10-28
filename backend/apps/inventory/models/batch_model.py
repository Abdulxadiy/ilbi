from decimal import Decimal

from django.db import models
from django.utils import timezone

from apps.core.models import BaseModel


class StockBatch(BaseModel):
    product_variant = models.ForeignKey(
        "catalog.ProductVariant", on_delete=models.PROTECT, related_name="stock_batches"
    )
    batch_code = models.CharField(max_length=80, blank=True)
    expires_on = models.DateField(null=True, blank=True)
    received_on = models.DateField(default=timezone.localdate)
    quantity = models.DecimalField(max_digits=14, decimal_places=3, default=Decimal("0"))
    cost_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    supplier = models.CharField(max_length=255, blank=True, db_index=True)

    class Meta:
        ordering = ["expires_on", "received_on", "pk"]
        constraints = [models.CheckConstraint(condition=models.Q(quantity__gte=0), name="batch_quantity_nonnegative")]


class BatchAllocation(models.Model):
    movement = models.ForeignKey("inventory.StockMovement", on_delete=models.PROTECT, related_name="batch_allocations")
    batch = models.ForeignKey(StockBatch, on_delete=models.PROTECT, related_name="allocations")
    quantity = models.DecimalField(max_digits=14, decimal_places=3)
    restored_quantity = models.DecimalField(max_digits=14, decimal_places=3, default=Decimal("0"))

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(quantity__gt=0), name="batch_allocation_positive"),
            models.CheckConstraint(
                condition=models.Q(restored_quantity__gte=0, restored_quantity__lte=models.F("quantity")),
                name="batch_restored_valid",
            ),
        ]
