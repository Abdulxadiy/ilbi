from decimal import Decimal
from django.db import models
from apps.core.models import BaseModel


class Counterparty(BaseModel):
    name = models.CharField(max_length=150)
    phone_number = models.CharField(max_length=20, db_index=True)
    target_tenant = models.ForeignKey(
        'tenants.Tenant',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='as_counterparty_in_shops',
    )
    debt_balance_uzs = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal('0.00')
    )
    debt_balance_usd = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal('0.00')
    )
    last_notified_debt_step_uzs = models.IntegerField(default=0)
    last_notified_debt_step_usd = models.IntegerField(default=0)
    debt_due_date = models.DateField(null=True, blank=True, db_index=True)
    last_notified_debt_due_date = models.DateField(null=True, blank=True)
    note = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['tenant', 'phone_number'],
                name='unique_counterparty_phone_per_tenant',
            )
        ]
        verbose_name_plural = 'counterparties'

    def __str__(self):
        return f"{self.name} ({self.phone_number})"
