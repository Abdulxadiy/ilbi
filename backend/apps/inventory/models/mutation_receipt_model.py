from django.db import models

from apps.core.models import BaseModel


class InventoryMutationReceipt(BaseModel):
    """Commit a stock mutation and its replay identity in the same transaction.

    Keep resource IDs, never a permission-dependent serialized response: a
    replay must use the caller's current cost/supplier visibility.
    """

    actor = models.ForeignKey('accounts.User', on_delete=models.PROTECT, related_name='inventory_mutation_receipts')
    idempotency_key = models.UUIDField()
    operation = models.CharField(max_length=80)
    fingerprint = models.CharField(max_length=64)
    resource_kind = models.CharField(max_length=20)
    resource_ids = models.JSONField(default=list)
    response_status = models.PositiveSmallIntegerField(default=201)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['tenant', 'idempotency_key'], name='inventory_mutation_key_per_tenant')]
