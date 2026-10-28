import uuid

from django.conf import settings
from django.db import models


class SupportTelegramSettings(models.Model):
    admin = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    enabled = models.BooleanField(default=False)
    target = models.CharField(
        max_length=10, choices=[("personal", "Personal"), ("group", "Group"), ("both", "Both")], default="personal"
    )
    group_chat_id = models.CharField(max_length=100, blank=True)
    updated_at = models.DateTimeField(auto_now=True)


class Conversation(models.Model):
    class Status(models.TextChoices):
        WAITING = "waiting", "Waiting"
        ACTIVE = "active", "Active"
        CLOSED = "closed", "Closed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT)
    guest_hash = models.CharField(max_length=64, blank=True, db_index=True)
    tenant = models.ForeignKey("tenants.Tenant", null=True, blank=True, on_delete=models.SET_NULL)
    name = models.CharField(max_length=100)
    language = models.CharField(max_length=2, choices=[("uz", "Uzbek"), ("ru", "Russian"), ("en", "English")])
    subject = models.CharField(max_length=160)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.WAITING, db_index=True)
    operator = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="support_assignments"
    )
    visitor_read_id = models.PositiveBigIntegerField(default=0)
    operator_read_id = models.PositiveBigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)

    class Meta:
        ordering = ["-updated_at", "id"]
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(user__isnull=False, guest_hash="")
                    | (models.Q(user__isnull=True) & ~models.Q(guest_hash=""))
                ),
                name="support_conversation_identity",
            )
        ]


class Message(models.Model):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="messages")
    sender = models.CharField(
        max_length=8, choices=[("visitor", "Visitor"), ("operator", "Operator"), ("system", "System")]
    )
    author = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    client_id = models.UUIDField(default=uuid.uuid4)
    text = models.TextField(blank=True)
    event = models.CharField(max_length=20, blank=True)
    # Small, private images never pass through the public /media/ route.
    image_data = models.BinaryField(null=True, editable=False)
    has_image = models.BooleanField(default=False)
    # Telegram-like features: Voice, Reply, and Stickers
    voice_data = models.BinaryField(null=True, editable=False)
    has_voice = models.BooleanField(default=False)
    voice_duration = models.PositiveIntegerField(default=0)
    sticker = models.CharField(max_length=100, blank=True)
    reply_to = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="replies")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["conversation", "client_id"], name="support_message_idempotency")
        ]
        indexes = [models.Index(fields=["conversation", "id"])]
