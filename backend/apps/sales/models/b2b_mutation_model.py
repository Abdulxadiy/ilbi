from django.db import models

from apps.core.models import BaseModel


class B2BMutationReceipt(BaseModel):
    """Durable acknowledgement for one actor's exact mobile B2B command."""

    operation_id = models.UUIDField()
    actor = models.ForeignKey('accounts.User', on_delete=models.PROTECT)
    sale = models.ForeignKey('sales.Sale', on_delete=models.PROTECT)
    operation = models.CharField(max_length=24)
    fingerprint = models.CharField(max_length=64)
    resource_id = models.PositiveBigIntegerField(null=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['tenant', 'operation_id'], name='unique_b2b_mobile_operation'),
        ]
