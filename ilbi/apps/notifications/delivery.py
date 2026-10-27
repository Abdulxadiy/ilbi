from datetime import timedelta

from cryptography.fernet import InvalidToken
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Employee
from apps.accounts.services.demo_access_service import DemoAccessService

from .fcm import PushTransportError, send_fcm
from .models import PushDelivery, PushEvent, PushInstallation
from .registration import cipher


def category(kind):
    if kind.startswith("b2b_transfer_"):
        return "b2b"
    if kind.startswith("debt_"):
        return "debts"
    return {"daily_z_report": "reports", "low_stock_alert": "stock"}.get(kind, "system")


def permitted(installation, notification, now, available_at):
    user = installation.user
    if (
        not installation.is_active
        or not user.is_active
        or not user.terms_accepted
        or DemoAccessService.is_blocked(user)
        or installation.token_version != user.token_version
    ):
        return False
    if user.pk != notification.recipient_id or not notification.tenant.is_active or notification.is_read:
        return False
    if installation.last_seen_at < now - timedelta(days=30) or available_at < now - timedelta(hours=24):
        return False
    if installation.categories.get(category(notification.type), True) is not True:
        return False
    if user.role == "platform_admin":
        return True
    return Employee.objects.filter(
        user_id=user.pk, tenant_id=notification.tenant_id, is_active=True, archived_at__isnull=True
    ).exists()


def process_push_events(*, sender=None, now=None, limit=100):
    """At-least-once dispatch with durable retry; never reruns a financial producer."""
    if not settings.MOBILE_PUSH_ENABLED:
        return {"enabled": False, "accepted": 0, "skipped": 0, "failed": 0}
    sender, now = sender or send_fcm, now or timezone.now()
    expired = list(
        PushEvent.objects.filter(expanded_at__isnull=True, created_at__lt=now - timedelta(hours=24)).values_list(
            "pk", flat=True
        )[:1000]
    )
    if expired:
        PushEvent.objects.filter(pk__in=expired, expanded_at__isnull=True).update(expanded_at=now)
    for event_id in (
        PushEvent.objects.filter(expanded_at__isnull=True, created_at__gte=now - timedelta(hours=24))
        .order_by("pk")
        .values_list("pk", flat=True)[:limit]
    ):
        with transaction.atomic():
            event = (
                PushEvent.objects.select_for_update(skip_locked=True)
                .filter(pk=event_id, expanded_at__isnull=True)
                .select_related("notification")
                .first()
            )
            if event is None:
                continue
            notification = event.notification
            if not notification.is_read and event.created_at >= now - timedelta(hours=24):
                devices = PushInstallation.objects.filter(
                    user_id=notification.recipient_id,
                    is_active=True,
                    created_at__lte=event.created_at,
                    last_seen_at__gte=now - timedelta(days=30),
                )
                PushDelivery.objects.bulk_create(
                    [PushDelivery(event=event, installation=device, next_attempt_at=now) for device in devices],
                    ignore_conflicts=True,
                )
            event.expanded_at = now
            event.save(update_fields=["expanded_at"])
    counts = {"enabled": True, "accepted": 0, "skipped": 0, "failed": 0}
    ids = list(
        PushDelivery.objects.filter(status="pending", next_attempt_at__lte=now)
        .order_by("pk")
        .values_list("pk", flat=True)[:limit]
    )
    for delivery_id in ids:
        with transaction.atomic():
            delivery = (
                PushDelivery.objects.select_for_update(skip_locked=True)
                .filter(pk=delivery_id, status="pending")
                .select_related("event__notification__tenant", "installation__user")
                .first()
            )
            if delivery is None:
                continue
            notification, installation = delivery.event.notification, delivery.installation
            if not permitted(installation, notification, now, delivery.event.created_at):
                delivery.status, delivery.finished_at = "skipped", now
                counts["skipped"] += 1
            else:
                delivery.attempts += 1
                try:
                    token = cipher().decrypt(installation.token_ciphertext.encode()).decode()
                    delivery.provider_id = sender(token, notification)
                    delivery.status, delivery.finished_at, delivery.last_error = "accepted", now, ""
                    counts["accepted"] += 1
                except PushTransportError as error:
                    delivery.last_error = error.code[:40]
                    if error.invalid_token:
                        PushInstallation.objects.filter(
                            pk=installation.pk, token_digest=installation.token_digest
                        ).update(is_active=False)
                    if error.invalid_token or delivery.attempts >= 5:
                        delivery.status, delivery.finished_at = "failed", now
                        counts["failed"] += 1
                    else:
                        delivery.next_attempt_at = now + timedelta(
                            seconds=max(error.retry_after, min(3600, 60 * 2**delivery.attempts))
                        )
                except (InvalidToken, UnicodeError):
                    delivery.status, delivery.finished_at, delivery.last_error = "failed", now, "token_storage_invalid"
                    counts["failed"] += 1
            delivery.save()
    return counts
