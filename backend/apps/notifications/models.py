import uuid

from django.conf import settings
from django.db import models


class PushInstallation(models.Model):
    """One private installation identity; never expose provider tokens in API output."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    token_ciphertext = models.TextField()
    token_digest = models.CharField(max_length=64, unique=True)
    revoke_secret_digest = models.CharField(max_length=64)
    token_version = models.PositiveIntegerField()
    is_active = models.BooleanField(default=True)
    categories = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(auto_now=True)


class PushEvent(models.Model):
    """Durable side effect of the same transaction that writes the inbox record."""

    notification = models.OneToOneField("sales.Notification", on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)
    expanded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["expanded_at", "id"], name="push_event_expand_idx")]


class PushDelivery(models.Model):
    event = models.ForeignKey(PushEvent, on_delete=models.CASCADE)
    installation = models.ForeignKey(PushInstallation, on_delete=models.CASCADE)
    status = models.CharField(max_length=16, default="pending")
    attempts = models.PositiveSmallIntegerField(default=0)
    next_attempt_at = models.DateTimeField()
    provider_id = models.CharField(max_length=255, blank=True)
    last_error = models.CharField(max_length=40, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["event", "installation"], name="unique_push_event_installation")]
        indexes = [models.Index(fields=["status", "next_attempt_at"], name="push_pending_attempt_idx")]
