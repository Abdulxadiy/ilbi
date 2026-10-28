from decimal import Decimal

from django.db import models

from apps.core.models import BaseModel


class B2BReturnReceipt(BaseModel):
    sale = models.ForeignKey("sales.Sale", on_delete=models.PROTECT, related_name="b2b_return_receipts")
    received_by = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="received_b2b_returns")
    idempotency_key = models.CharField(max_length=64)
    payload_hash = models.CharField(max_length=64)
    reason = models.TextField()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "idempotency_key"],
                name="unique_b2b_return_idempotency_per_tenant",
            )
        ]


class B2BReturnReceiptItem(BaseModel):
    receipt = models.ForeignKey(B2BReturnReceipt, on_delete=models.PROTECT, related_name="items")
    sale_item = models.ForeignKey("sales.SaleItem", on_delete=models.PROTECT, related_name="b2b_return_receipt_items")
    quantity = models.DecimalField(max_digits=14, decimal_places=3)
    amount = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["receipt", "sale_item"],
                name="unique_sale_item_per_b2b_return_receipt",
            ),
            models.CheckConstraint(condition=models.Q(quantity__gt=0), name="b2b_return_quantity_positive"),
        ]


class B2BReturnDiscrepancyClosure(BaseModel):
    sale = models.ForeignKey("sales.Sale", on_delete=models.PROTECT, related_name="b2b_discrepancy_closures")
    closed_by = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="closed_b2b_discrepancies")
    idempotency_key = models.CharField(max_length=64)
    payload_hash = models.CharField(max_length=64)
    reason = models.TextField()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "idempotency_key"],
                name="unique_b2b_discrepancy_idempotency_per_tenant",
            )
        ]


class B2BReturnDiscrepancyClosureItem(BaseModel):
    closure = models.ForeignKey(B2BReturnDiscrepancyClosure, on_delete=models.PROTECT, related_name="items")
    sale_item = models.ForeignKey(
        "sales.SaleItem", on_delete=models.PROTECT, related_name="b2b_discrepancy_closure_items"
    )
    quantity = models.DecimalField(max_digits=14, decimal_places=3)
    amount = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["closure", "sale_item"],
                name="unique_sale_item_per_b2b_discrepancy_closure",
            ),
            models.CheckConstraint(condition=models.Q(quantity__gt=0), name="b2b_discrepancy_quantity_positive"),
        ]
