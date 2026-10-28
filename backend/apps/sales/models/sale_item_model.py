from decimal import Decimal

from django.db import models

from apps.core.models import BaseModel
from apps.sales.receipt_items import product_snapshot


class SaleItem(BaseModel):
    STATUS_ACTIVE = 'active'
    STATUS_PARTIALLY_VOIDED = 'partially_voided'
    STATUS_VOIDED = 'voided'
    STATUS_B2B_ACCEPTED = 'b2b_accepted'
    STATUS_B2B_REJECTED = 'b2b_rejected'
    STATUS_B2B_PARTIALLY_ACCEPTED = 'b2b_partially_accepted'
    STATUS_B2B_RETURN_PENDING = 'b2b_return_pending'
    STATUS_CHOICES = [
        (STATUS_ACTIVE, 'Faol'),
        (STATUS_PARTIALLY_VOIDED, 'Qisman bekor qilingan'),
        (STATUS_VOIDED, 'Bekor qilingan'),
        (STATUS_B2B_ACCEPTED, 'B2B Qabul qilingan'),
        (STATUS_B2B_REJECTED, 'B2B Rad etilgan'),
        (STATUS_B2B_PARTIALLY_ACCEPTED, 'B2B Qisman qabul qilingan'),
        (STATUS_B2B_RETURN_PENDING, 'B2B qaytishi kutilmoqda'),
    ]

    sale = models.ForeignKey(
        'sales.Sale', on_delete=models.CASCADE, related_name='items'
    )
    product_variant = models.ForeignKey(
        'catalog.ProductVariant', on_delete=models.PROTECT, related_name='sale_items'
    )
    # NULL means legacy/unknown. Never backfill historical descriptions from today's catalog.
    product_snapshot = models.JSONField(null=True, blank=True, editable=False)
    quantity = models.DecimalField(max_digits=14, decimal_places=3)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)
    cost_price = models.DecimalField(max_digits=12, decimal_places=2)
    original_partner_price = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True
    )
    total_price = models.DecimalField(max_digits=14, decimal_places=2)
    net_amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    tax_amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)

    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    voided_quantity = models.DecimalField(
        max_digits=14, decimal_places=3, default=Decimal('0.000')
    )
    b2b_accepted_quantity = models.DecimalField(
        max_digits=14, decimal_places=3, default=Decimal('0.000')
    )
    b2b_rejected_quantity = models.DecimalField(
        max_digits=14, decimal_places=3, default=Decimal('0.000')
    )
    b2b_return_pending_quantity = models.DecimalField(
        max_digits=14, decimal_places=3, default=Decimal('0.000')
    )
    b2b_discrepancy_closed_quantity = models.DecimalField(
        max_digits=14, decimal_places=3, default=Decimal('0.000')
    )
    b2b_target_variant = models.ForeignKey(
        'catalog.ProductVariant',
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name='received_b2b_sale_items',
    )

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(quantity__gt=0),
                name='sale_item_quantity_positive',
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(voided_quantity__gte=0)
                    & models.Q(b2b_accepted_quantity__gte=0)
                    & models.Q(b2b_rejected_quantity__gte=0)
                    & models.Q(b2b_return_pending_quantity__gte=0)
                    & models.Q(b2b_discrepancy_closed_quantity__gte=0)
                ),
                name='sale_item_buckets_non_negative',
            ),
            models.CheckConstraint(
                condition=models.Q(
                    quantity__gte=(
                        models.F('voided_quantity')
                        + models.F('b2b_accepted_quantity')
                        + models.F('b2b_rejected_quantity')
                        + models.F('b2b_return_pending_quantity')
                        + models.F('b2b_discrepancy_closed_quantity')
                    )
                ),
                name='sale_item_buckets_within_quantity',
            ),
        ]

    def __str__(self):
        return f"{self.product_variant} x {self.quantity} @ {self.unit_price}"

    @property
    def receipt_product(self):
        if self.product_snapshot is not None:
            return self.product_snapshot
        # Preserve the old display for legacy rows without inventing fiscal history.
        return {**product_snapshot(self.product_variant), "mxik": None, "package_code": None}
