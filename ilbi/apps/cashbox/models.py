from decimal import Decimal

from django.core.serializers.json import DjangoJSONEncoder
from django.db import models
from django.utils import timezone

from apps.core.event_clock import EventDateTimeField
from apps.core.models import BaseModel


class CashboxMutationReceipt(BaseModel):
    """A cash operation and its retry acknowledgement commit in one transaction."""
    idempotency_key = models.UUIDField()
    actor = models.ForeignKey('accounts.User', on_delete=models.PROTECT, related_name='cashbox_mutation_receipts')
    kind = models.CharField(max_length=12)
    fingerprint = models.CharField(max_length=64)
    result = models.JSONField(encoder=DjangoJSONEncoder)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['tenant', 'idempotency_key'], name='cashbox_mutation_key_once')]


class CashShift(BaseModel):
    opened_by = models.ForeignKey('accounts.User', on_delete=models.PROTECT, related_name='opened_cash_shifts')
    opened_at = models.DateTimeField(default=timezone.now)
    closed_at = models.DateTimeField(null=True, blank=True)
    opening_cash_uzs = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0'))
    opening_cash_usd = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0'))

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['tenant'], condition=models.Q(closed_at__isnull=True), name='one_open_cash_shift_per_tenant'),
            models.CheckConstraint(condition=models.Q(opening_cash_uzs__gte=0, opening_cash_usd__gte=0), name='cash_shift_opening_nonnegative'),
        ]


class DailyCashReport(BaseModel):
    """
    Kassa Z-Hisoboti (Smena yopilish hisoboti).
    """
    date = models.DateField(default=timezone.now)
    shift = models.OneToOneField(CashShift, null=True, blank=True, on_delete=models.PROTECT, related_name='report')
    opening_cash_uzs = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0'))
    opening_cash_usd = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0'))
    closed_by = models.ForeignKey(
        'accounts.User', on_delete=models.PROTECT, related_name='closed_shifts'
    )
    closed_at = EventDateTimeField(auto_now_add=True)

    # Savdo tushumlari
    total_sale_cash_uzs = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    total_sale_cash_usd = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    total_sale_card_uzs = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    total_sale_card_usd = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    total_sale_debt_uzs = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    total_sale_debt_usd = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))

    collected_debt_cash_uzs = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    collected_debt_cash_usd = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    refund_cash_uzs = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    refund_cash_usd = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))

    # Kassa qo'shimcha kirim va chiqimlari
    total_extra_income_uzs = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    total_extra_income_usd = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    total_expenses_uzs = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    total_expenses_usd = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))

    # Kutilgan naqd pul (kassa qoldig'i: naqd savdo + qo'shimcha kirim - xarajatlar)
    expected_cash_uzs = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    expected_cash_usd = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))

    # Xodim kiritgan amaldagi naqd pul
    actual_cash_uzs = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    actual_cash_usd = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))

    # Tafovut: actual - expected (musbat bo'lsa ortiqcha, manfiy bo'lsa kamomat)
    discrepancy_uzs = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    discrepancy_usd = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))

    # Tafovut sababi
    discrepancy_reason = models.TextField(blank=True, default='')

    # Xodim kiritgan qo'shimcha eslatmalar
    staff_notes = models.TextField(blank=True, default='')
    is_closed = models.BooleanField(default=True)

    class Meta:
        ordering = ['-closed_at']

    def __str__(self):
        return f"Z-Hisobot #{self.id} ({self.tenant.name} - {self.date})"


class CashExpense(BaseModel):
    """
    Kassadan chiqim (xarajat).
    """
    CURRENCY_UZS = 'UZS'
    CURRENCY_USD = 'USD'
    CURRENCY_CHOICES = [
        (CURRENCY_UZS, 'UZS'),
        (CURRENCY_USD, 'USD'),
    ]

    amount = models.DecimalField(max_digits=14, decimal_places=2)
    shift = models.ForeignKey(CashShift, null=True, blank=True, on_delete=models.PROTECT, related_name='expenses')
    currency = models.CharField(max_length=3, choices=CURRENCY_CHOICES, default=CURRENCY_UZS)
    category = models.CharField(max_length=100)
    recorded_by = models.ForeignKey(
        'accounts.User', on_delete=models.PROTECT, related_name='cash_expenses'
    )
    shift_report = models.ForeignKey(
        DailyCashReport, null=True, blank=True, on_delete=models.SET_NULL, related_name='expenses'
    )
    date = models.DateField(default=timezone.now)
    note = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"-{self.amount} {self.currency} ({self.category})"


class CashIncome(BaseModel):
    """
    Kassaga qo'shimcha kirim.
    """
    CURRENCY_UZS = 'UZS'
    CURRENCY_USD = 'USD'
    CURRENCY_CHOICES = [
        (CURRENCY_UZS, 'UZS'),
        (CURRENCY_USD, 'USD'),
    ]

    amount = models.DecimalField(max_digits=14, decimal_places=2)
    shift = models.ForeignKey(CashShift, null=True, blank=True, on_delete=models.PROTECT, related_name='incomes')
    currency = models.CharField(max_length=3, choices=CURRENCY_CHOICES, default=CURRENCY_UZS)
    source = models.CharField(max_length=100)
    recorded_by = models.ForeignKey(
        'accounts.User', on_delete=models.PROTECT, related_name='cash_incomes'
    )
    shift_report = models.ForeignKey(
        DailyCashReport, null=True, blank=True, on_delete=models.SET_NULL, related_name='incomes'
    )
    date = models.DateField(default=timezone.now)
    note = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"+{self.amount} {self.currency} ({self.source})"
