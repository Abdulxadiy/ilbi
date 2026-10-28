from django.db import models
from apps.core.models import BaseModel


class SaleVoidLog(BaseModel):
    sale_item = models.ForeignKey(
        'sales.SaleItem', on_delete=models.CASCADE, related_name='void_logs'
    )
    quantity = models.DecimalField(max_digits=14, decimal_places=3)
    reason = models.TextField()
    voided_by = models.ForeignKey(
        'accounts.User', on_delete=models.PROTECT, related_name='sale_void_logs'
    )
    voided_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-voided_at']

    def __str__(self):
        return f"{self.sale_item} | Qaytarildi: {self.quantity} ({self.reason})"
