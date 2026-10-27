import json
import uuid
from datetime import timedelta
from unittest.mock import Mock, patch

import pytest
from django.db import transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Employee
from apps.notifications.delivery import process_push_events
from apps.notifications.fcm import PushTransportError, send_fcm
from apps.notifications.models import PushDelivery, PushEvent, PushInstallation
from apps.notifications.registration import cipher, register_installation
from apps.sales.models import Notification
from tests.factories import OwnerFactory

pytestmark = pytest.mark.django_db
REGISTER = "/api/v1/auth/push/installations/"
REVOKE = "/api/v1/auth/push/revoke/"


def values(**changes):
    return {
        "installation_id": uuid.uuid4(),
        "revoke_secret": "a" * 64,
        "token": "synthetic-fcm-" + uuid.uuid4().hex,
        "platform": "android",
        "application_id": "uz.ilbi.mobile",
        **changes,
    }


def installation(owner, **changes):
    owner.terms_accepted = True
    owner.save(update_fields=["terms_accepted"])
    return register_installation(owner, values(**changes))


def notification(owner, tenant, **changes):
    return Notification.objects.create(
        recipient=owner,
        tenant=tenant,
        type="debt_due_reminder",
        title="Private title",
        message="Private financial detail 123456",
        **changes,
    )


def test_registration_requires_authentication_and_never_echoes_secrets(owner):
    client = APIClient()
    payload = values()
    assert client.post(REGISTER, payload, format="json").status_code == 401
    owner.terms_accepted = True
    owner.save()
    client.force_authenticate(owner)
    response = client.post(REGISTER, payload, format="json")
    assert response.status_code == 200
    saved = PushInstallation.objects.get(pk=payload["installation_id"])
    assert saved.user == owner
    assert saved.token_ciphertext != payload["token"]
    assert cipher().decrypt(saved.token_ciphertext.encode()).decode() == payload["token"]
    assert payload["token"] not in json.dumps(response.data)
    assert payload["revoke_secret"] not in json.dumps(response.data)


def test_foreign_installation_cannot_be_rebound_without_its_private_secret(owner):
    saved = installation(owner)
    other = OwnerFactory(terms_accepted=True)
    client = APIClient()
    client.force_authenticate(other)
    response = client.post(REGISTER, values(installation_id=saved.pk, revoke_secret="b" * 64), format="json")
    assert response.status_code == 400
    saved.refresh_from_db()
    assert saved.user == owner


def test_revocation_can_finish_after_local_logout_but_wrong_secret_cannot_disable(owner):
    saved = installation(owner)
    client = APIClient()
    assert (
        client.post(REVOKE, {"installation_id": saved.pk, "revoke_secret": "b" * 64}, format="json").status_code == 204
    )
    saved.refresh_from_db()
    assert saved.is_active
    assert (
        client.post(REVOKE, {"installation_id": saved.pk, "revoke_secret": "a" * 64}, format="json").status_code == 204
    )
    saved.refresh_from_db()
    assert not saved.is_active


def test_invalid_platform_application_and_category_are_rejected(owner):
    client = APIClient()
    client.force_authenticate(owner)
    owner.terms_accepted = True
    owner.save()
    for change in [{"platform": "ios"}, {"application_id": "other.app"}, {"categories": {"unknown": True}}]:
        assert client.post(REGISTER, values(**change), format="json").status_code == 400
    assert PushInstallation.objects.count() == 0


def test_notification_and_durable_event_roll_back_together(owner, tenant):
    with pytest.raises(RuntimeError), transaction.atomic():
        notification(owner, tenant)
        assert PushEvent.objects.count() == 1
        raise RuntimeError("Synthetic rollback")
    assert Notification.objects.count() == PushEvent.objects.count() == 0


@pytest.mark.django_db(transaction=True)
def test_autocommit_producer_cannot_leave_an_inbox_without_its_outbox(owner, tenant):
    with patch(
        "apps.notifications.signals.PushEvent.objects.get_or_create",
        side_effect=RuntimeError("Synthetic outbox failure"),
    ):
        with pytest.raises(RuntimeError):
            notification(owner, tenant)
    assert not Notification.objects.exists()
    assert not PushEvent.objects.exists()


def test_expired_event_backlog_cannot_delay_a_current_event(owner, tenant, settings):
    installation(owner)
    old = notification(owner, tenant)
    PushEvent.objects.filter(notification=old).update(created_at=timezone.now() - timedelta(days=2))
    fresh = notification(owner, tenant)
    settings.MOBILE_PUSH_ENABLED = True
    sender = Mock(return_value="projects/test/messages/1")
    assert process_push_events(sender=sender, limit=1)["accepted"] == 1
    assert sender.call_args.args[1] == fresh


def test_fresh_server_arrival_of_backdated_business_event_still_notifies(owner, tenant, settings):
    installation(owner)
    row = notification(owner, tenant)
    # Offline sync can preserve the original business timestamp. Push freshness
    # and device eligibility use the new durable server-arrival event instead.
    Notification.objects.filter(pk=row.pk).update(created_at=timezone.now() - timedelta(days=3))
    settings.MOBILE_PUSH_ENABLED = True
    sender = Mock(return_value="projects/test/messages/offline-arrival")
    assert process_push_events(sender=sender)["accepted"] == 1
    assert sender.call_args.args[1].pk == row.pk


def test_push_is_disabled_by_default_and_does_not_contact_provider(owner, tenant, settings):
    installation(owner)
    notification(owner, tenant)
    settings.MOBILE_PUSH_ENABLED = False
    sender = Mock()
    assert process_push_events(sender=sender)["enabled"] is False
    sender.assert_not_called()


def test_committed_event_reuses_original_inbox_without_duplicate_financial_work(owner, tenant, settings):
    installation(owner)
    row = notification(owner, tenant)
    settings.MOBILE_PUSH_ENABLED = True
    sender = Mock(return_value="projects/test/messages/1")
    assert process_push_events(sender=sender)["accepted"] == 1
    assert process_push_events(sender=sender)["accepted"] == 0
    sender.assert_called_once()
    assert sender.call_args.args[1] == row
    assert Notification.objects.count() == PushEvent.objects.count() == PushDelivery.objects.count() == 1
    assert PushDelivery.objects.get().status == "accepted"


@pytest.mark.parametrize("changed", ["membership", "token_version", "read", "muted", "account_rebound"])
def test_delivery_rechecks_live_account_membership_read_state_and_preferences(owner, tenant, settings, changed):
    saved = installation(owner)
    row = notification(owner, tenant)
    if changed == "membership":
        Employee.objects.filter(user=owner, tenant=tenant).update(is_active=False)
    elif changed == "token_version":
        owner.token_version += 1
        owner.save()
    elif changed == "read":
        row.is_read = True
        row.save()
    elif changed == "muted":
        saved.categories = {"debts": False}
        saved.save()
    else:
        saved.user = OwnerFactory(terms_accepted=True)
        saved.save()
    settings.MOBILE_PUSH_ENABLED = True
    sender = Mock()
    assert process_push_events(sender=sender)["accepted"] == 0
    sender.assert_not_called()


def test_provider_transient_failure_persists_backoff_and_retry_without_recreating_event(owner, tenant, settings):
    installation(owner)
    notification(owner, tenant)
    settings.MOBILE_PUSH_ENABLED = True
    now = timezone.now()
    sender = Mock(side_effect=PushTransportError("provider_network", retry_after=300))
    process_push_events(sender=sender, now=now)
    delivery = PushDelivery.objects.get()
    assert delivery.status == "pending" and delivery.attempts == 1
    assert delivery.next_attempt_at >= now + timedelta(seconds=300)
    process_push_events(sender=sender, now=now + timedelta(seconds=60))
    assert sender.call_count == 1
    sender.side_effect = None
    sender.return_value = "projects/test/messages/retry"
    assert process_push_events(sender=sender, now=now + timedelta(seconds=301))["accepted"] == 1
    assert PushEvent.objects.count() == 1


def test_unregistered_token_is_disabled(owner, tenant, settings):
    saved = installation(owner)
    notification(owner, tenant)
    settings.MOBILE_PUSH_ENABLED = True
    sender = Mock(side_effect=PushTransportError("token_unregistered", invalid_token=True))
    assert process_push_events(sender=sender)["failed"] == 1
    saved.refresh_from_db()
    assert not saved.is_active


def test_provider_payload_has_no_private_text_and_fixed_internal_target(owner, tenant, settings):
    row = notification(owner, tenant)
    settings.FCM_PROJECT_ID = "ilbi-test-project"
    response = Mock(status_code=200)
    response.json.return_value = {"name": "projects/test/messages/1"}
    with (
        patch("apps.notifications.fcm.access_token", return_value="synthetic-access"),
        patch("apps.notifications.fcm.requests.post", return_value=response) as post,
    ):
        assert send_fcm("synthetic-device-token", row) == "projects/test/messages/1"
    payload = post.call_args.kwargs["json"]
    assert "Private" not in json.dumps(payload) and "123456" not in json.dumps(payload)
    assert payload["message"]["data"] == {
        "kind": "ilbi_inbox",
        "notification_id": str(row.pk),
        "recipient_id": str(owner.pk),
        "tenant_id": str(tenant.pk),
    }
    assert post.call_args.args[0] == "https://fcm.googleapis.com/v1/projects/ilbi-test-project/messages:send"
    assert post.call_args.kwargs["allow_redirects"] is False


def test_notification_detail_cannot_be_read_by_another_account(owner, tenant):
    row = notification(owner, tenant)
    client = APIClient()
    client.force_authenticate(owner)
    assert client.get(f"/api/v1/sales/notifications/{row.pk}/").status_code == 200
    other = OwnerFactory(terms_accepted=True)
    client.force_authenticate(other)
    assert client.get(f"/api/v1/sales/notifications/{row.pk}/", HTTP_X_TENANT_ID=str(tenant.pk)).status_code in (
        403,
        404,
    )
