from django.conf import settings
from django.db import models

from apps.core.models import BaseModel


class SaleVoidRequest(BaseModel):
    """Committed cancellation receipt; replay never repeats stock/debt/cash effects."""

    idempotency_key = models.CharField(max_length=64)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="sale_void_requests")
    sale = models.ForeignKey("sales.Sale", on_delete=models.PROTECT, related_name="void_requests")
    sale_item = models.ForeignKey("sales.SaleItem", on_delete=models.PROTECT, null=True, blank=True, related_name="void_requests")
    kind = models.CharField(max_length=8, choices=[("sale", "Full sale"), ("item", "Sale item")])
    payload = models.JSONField()
    result = models.JSONField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["tenant", "idempotency_key"], name="unique_sale_void_request_key")]
