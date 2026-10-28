from django.conf import settings
from django.db import models

from apps.core.models import BaseModel


class CounterpartyImportJob(BaseModel):
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    rows = models.JSONField(default=list)
    expires_at = models.DateTimeField()
    completed_at = models.DateTimeField(null=True, blank=True)
    result = models.JSONField(default=dict)
