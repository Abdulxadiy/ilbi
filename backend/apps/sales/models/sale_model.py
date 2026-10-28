from decimal import Decimal
import secrets

from django.db import models

from apps.core.models import BaseModel


class Sale(BaseModel):
    CURRENCY_UZS = 'UZS'
    CURRENCY_USD = 'USD'
    CURRENCY_CHOICES = [
        (CURRENCY_UZS, 'UZS'),
        (CURRENCY_USD, 'USD'),
    ]

    PAYMENT_CASH = 'cash'
    PAYMENT_CARD = 'card'
    PAYMENT_DEBT = 'debt'
    PAYMENT_CHOICES = [
        (PAYMENT_CASH, 'Naqd'),
        (PAYMENT_CARD, 'Karta'),
        (PAYMENT_DEBT, 'Nasiya'),
    ]

    STATUS_COMPLETED = 'completed'
    STATUS_PARTIALLY_VOIDED = 'partially_voided'
    STATUS_VOIDED = 'voided'
    STATUS_B2B_PENDING = 'b2b_pending'
    STATUS_B2B_PARTIALLY_ACCEPTED = 'b2b_partially_accepted'
    STATUS_B2B_ACCEPTED = 'b2b_accepted'
    STATUS_B2B_REJECTED = 'b2b_rejected'
    STATUS_B2B_RETURN_PENDING = 'b2b_return_pending'
    STATUS_CHOICES = [
        (STATUS_COMPLETED, 'Tugallangan'),
        (STATUS_PARTIALLY_VOIDED, 'Qisman bekor qilingan'),
        (STATUS_VOIDED, 'Bekor qilingan'),
        (STATUS_B2B_PENDING, 'B2B Kutilmoqda'),
        (STATUS_B2B_PARTIALLY_ACCEPTED, 'B2B Qisman qabul qilingan'),
        (STATUS_B2B_ACCEPTED, 'B2B Qabul qilingan'),
        (STATUS_B2B_REJECTED, 'B2B Rad etilgan'),
        (STATUS_B2B_RETURN_PENDING, 'B2B qaytishi kutilmoqda'),
    ]

    receipt_number = models.CharField(max_length=32)
    shift = models.ForeignKey('cashbox.CashShift', null=True, blank=True, on_delete=models.PROTECT, related_name='sales')
    public_token = models.CharField(max_length=64, unique=True, editable=False)
    sold_by = models.ForeignKey(
        'accounts.User', on_delete=models.PROTECT, related_name='sales'
    )
    counterparty = models.ForeignKey(
        'sales.Counterparty',
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name='sales',
    )
    currency = models.CharField(max_length=3, choices=CURRENCY_CHOICES, default=CURRENCY_UZS)
    is_partner_sale = models.BooleanField(default=False)
    total_amount = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    subtotal_amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    tax_amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    receipt_snapshot = models.JSONField(default=dict, blank=True)
    payment_type = models.CharField(max_length=10, choices=PAYMENT_CHOICES, default=PAYMENT_CASH)
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default=STATUS_COMPLETED)

    b2b_target_tenant = models.ForeignKey(
        'tenants.Tenant',
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name='incoming_b2b_sales',
    )
    b2b_expires_at = models.DateTimeField(null=True, blank=True)
    b2b_reject_reason = models.TextField(blank=True)
    b2b_resolved_at = models.DateTimeField(null=True, blank=True)
    refunded_amount = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))

    voided_at = models.DateTimeField(null=True, blank=True)
    voided_by = models.ForeignKey(
        'accounts.User',
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name='voided_sales',
    )
    void_reason = models.TextField(blank=True)

    idempotency_key = models.CharField(max_length=64, blank=True, null=True, db_index=True)
    request_fingerprint = models.CharField(max_length=64, blank=True, default="")

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['tenant', 'receipt_number'],
                name='unique_sale_receipt_number_per_tenant',
            ),
            models.UniqueConstraint(
                fields=['tenant', 'idempotency_key'],
                condition=models.Q(idempotency_key__isnull=False) & ~models.Q(idempotency_key=''),
                name='unique_sale_idempotency_per_tenant',
            ),
        ]
        ordering = ['-created_at']

    def save(self, *args, **kwargs):
        if not self.public_token:
            self.public_token = secrets.token_urlsafe(32)
        super().save(*args, **kwargs)

    @property
    def net_amount(self) -> Decimal:
        return self.total_amount - self.refunded_amount

    def __str__(self):
        return f"{self.receipt_number} ({self.total_amount} {self.currency})"


class SaleRefund(BaseModel):
    sale = models.ForeignKey(Sale, on_delete=models.PROTECT, related_name='refunds')
    shift = models.ForeignKey('cashbox.CashShift', null=True, blank=True, on_delete=models.PROTECT, related_name='refunds')
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    currency = models.CharField(max_length=3, choices=Sale.CURRENCY_CHOICES)
    payment_type = models.CharField(max_length=10, choices=Sale.PAYMENT_CHOICES)
    recorded_by = models.ForeignKey('accounts.User', on_delete=models.PROTECT)
    reason = models.TextField()
