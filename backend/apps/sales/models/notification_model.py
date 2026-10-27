from django.db import models, transaction

from apps.core.models import BaseModel


class Notification(BaseModel):
    TYPE_B2B_REQUEST = 'b2b_transfer_request'
    TYPE_B2B_ACCEPTED = 'b2b_transfer_accepted'
    TYPE_B2B_PARTIALLY_ACCEPTED = 'b2b_transfer_partially_accepted'
    TYPE_B2B_REJECTED = 'b2b_transfer_rejected'
    TYPE_B2B_CANCELLED = 'b2b_transfer_cancelled'
    TYPE_DEBT_WARNING = 'debt_threshold_warning'
    TYPE_DEBT_DUE = 'debt_due_reminder'
    TYPE_DAILY_Z_REPORT = 'daily_z_report'
    TYPE_LOW_STOCK_ALERT = 'low_stock_alert'

    TYPE_CHOICES = [
        (TYPE_B2B_REQUEST, 'B2B O\'tkazma so\'rovi'),
        (TYPE_B2B_ACCEPTED, 'B2B Qabul qilindi'),
        (TYPE_B2B_PARTIALLY_ACCEPTED, 'B2B Qisman qabul qilindi'),
        (TYPE_B2B_REJECTED, 'B2B Rad etildi'),
        (TYPE_B2B_CANCELLED, 'B2B Bekor qilindi'),
        (TYPE_DEBT_WARNING, 'Qarz chegarasi ogohlantirishi'),
        (TYPE_DEBT_DUE, 'Qarzni qaytarish sanasi'),
        (TYPE_DAILY_Z_REPORT, 'Kunlik Z-Hisobot'),
        (TYPE_LOW_STOCK_ALERT, 'Kamayib qolgan tovarlar ogohlantirishi'),
    ]

    recipient = models.ForeignKey(
        'accounts.User', on_delete=models.CASCADE, related_name='notifications'
    )
    type = models.CharField(max_length=32, choices=TYPE_CHOICES)
    title = models.CharField(max_length=200)
    message = models.TextField()
    link = models.CharField(max_length=255, blank=True)
    is_read = models.BooleanField(default=False)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.recipient} | {self.title}"

    @transaction.atomic
    def save(self, *args, **kwargs):
        # Scheduled producers may run outside a domain transaction. Keep their
        # inbox row and the push outbox receiver in the same database commit.
        return super().save(*args, **kwargs)
