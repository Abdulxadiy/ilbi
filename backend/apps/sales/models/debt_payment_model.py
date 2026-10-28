from apps.core.event_clock import EventDateTimeField
from decimal import Decimal
from django.db import models
from apps.core.models import BaseModel


class DebtPayment(BaseModel):
    CURRENCY_UZS = 'UZS'
    CURRENCY_USD = 'USD'
    CURRENCY_CHOICES = [
        (CURRENCY_UZS, 'UZS'),
        (CURRENCY_USD, 'USD'),
    ]

    counterparty = models.ForeignKey(
        'sales.Counterparty',
        on_delete=models.PROTECT,
        related_name='payments',
    )
    branch = models.ForeignKey(
        'tenants.Tenant',
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name='received_debt_payments',
        help_text="Qarz to'lovi qabul qilingan filial/do'kon",
    )
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    payment_type = models.CharField(max_length=10, choices=[('cash', 'Naqd'), ('card', 'Karta'), ('none', 'Hisob tuzatish')], default='none')
    shift = models.ForeignKey('cashbox.CashShift', null=True, blank=True, on_delete=models.PROTECT, related_name='debt_payments')
    idempotency_key = models.CharField(max_length=64, null=True, blank=True)
    request_fingerprint = models.CharField(max_length=64, blank=True, default='')
    currency = models.CharField(max_length=3, choices=CURRENCY_CHOICES, default=CURRENCY_UZS)
    exchange_rate = models.DecimalField(max_digits=18, decimal_places=6, null=True, blank=True)
    exchange_rate_source = models.CharField(max_length=6, blank=True, choices=[("manual", "Manual"), ("cbu", "CBU")])
    exchange_rate_date = models.DateField(null=True, blank=True)
    converted_amount_uzs = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    paid_at = EventDateTimeField(auto_now_add=True)
    recorded_by = models.ForeignKey(
        'accounts.User',
        on_delete=models.PROTECT,
        related_name='recorded_debt_payments',
    )
    is_correction = models.BooleanField(default=False)
    note = models.TextField(blank=True)

    class Meta:
        ordering = ['-paid_at']
        constraints = [models.UniqueConstraint(fields=['counterparty', 'idempotency_key'], condition=models.Q(idempotency_key__isnull=False) & ~models.Q(idempotency_key=''), name='unique_debt_payment_idempotency')]

    def save(self, *args, **kwargs):
        if not self.branch_id and self.tenant_id:
            self.branch_id = self.tenant_id
        super().save(*args, **kwargs)

    def __str__(self):
        corr = ' [Korrektirovka]' if self.is_correction else ''
        return f"{self.counterparty.name} | {self.amount} {self.currency}{corr}"
