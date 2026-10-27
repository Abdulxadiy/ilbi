from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from uuid import uuid4

import pytest
from django.db import close_old_connections
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Employee
from apps.core.models import WorkspaceReminder
from apps.core.services.workspace_notifications import notify_due_workspace_reminders
from apps.notifications.models import PushEvent
from apps.notifications.delivery import process_push_events
from apps.notifications.registration import register_installation
from apps.notifications.fcm import PushTransportError
from apps.sales.models import Notification
from apps.support.models import Conversation, Message
from tests.factories import EmployeeFactory, PlatformAdminFactory, StaffFactory, TenantFactory

pytestmark = pytest.mark.django_db
SUPPORT = '/api/v1/support/'
WORKSPACE = '/api/v1/workspace/reminders/'


def accepted(user):
    user.terms_accepted = True
    user.save(update_fields=['terms_accepted'])
    return user


def client(user, tenant=None):
    api = APIClient(); api.force_authenticate(user)
    if tenant:
        api.credentials(HTTP_X_TENANT_ID=str(tenant.pk))
    return api


def start(api, **changes):
    body = {'client_id': str(uuid4()), 'name': 'Private visitor name', 'subject': 'Private subject 654321', 'language': 'uz', 'text': 'Private chat secret 123456', 'consent': True, **changes}
    return api.post(SUPPORT + 'conversations/', body, format='json'), body


def claim(api, conversation):
    response = api.post(SUPPORT + f'inbox/{conversation}/', {'action': 'claim'}, format='json')
    assert response.status_code == 200, response.data


def reply(api, conversation, *, operator=True, identity=None):
    path = 'inbox' if operator else 'conversations'
    return api.post(SUPPORT + f'{path}/{conversation}/messages/', {'client_id': identity or str(uuid4()), 'text': 'Private reply secret 987654'}, format='json')


def test_support_duplex_recipient_privacy_replay_and_read_markers(owner, tenant, platform_admin):
    accepted(owner); accepted(platform_admin)
    other_admin = PlatformAdminFactory(terms_accepted=True)
    inactive_admin = PlatformAdminFactory(terms_accepted=True, is_active=False)
    visitor = client(owner, tenant)
    first, payload = start(visitor); assert first.status_code == 201, first.data
    pk = first.data['id']
    assert set(Notification.objects.values_list('recipient_id', flat=True)) == {platform_admin.pk, other_admin.pk}
    assert not Notification.objects.filter(recipient=inactive_admin).exists()
    assert PushEvent.objects.count() == 2
    for row in Notification.objects.all():
        assert all(private not in row.title + row.message for private in ['123456', '654321', 'Private visitor'])
        assert row.link == '/support?conversation=' + str(pk)
    assert visitor.post(SUPPORT + 'conversations/', payload, format='json').status_code == 200
    assert Notification.objects.count() == 2
    operator = client(platform_admin); claim(operator, pk)
    assert not Notification.objects.filter(is_read=False).exists()
    identity = str(uuid4()); sent = reply(operator, pk, identity=identity); assert sent.status_code == 201, sent.data
    assert reply(operator, pk, identity=identity).status_code == 200
    recipient = Notification.objects.get(recipient=owner)
    assert Notification.objects.count() == 3 and PushEvent.objects.count() == 3
    assert '987654' not in recipient.message
    root = SUPPORT + f'conversations/{pk}/'
    assert visitor.post(root, {'action': 'read', 'through_id': sent.data['id'] - 1}, format='json').status_code == 200
    recipient.refresh_from_db(); assert not recipient.is_read
    assert visitor.post(root, {'action': 'read', 'through_id': sent.data['id']}, format='json').status_code == 200
    recipient.refresh_from_db(); assert recipient.is_read
    again = reply(visitor, pk, operator=False); assert again.status_code == 201
    assert list(Notification.objects.filter(is_read=False).values_list('recipient_id', flat=True)) == [platform_admin.pk]
    assert client(StaffFactory()).get(root).status_code == 404


def test_unscoped_guest_and_personal_threads_never_guess_a_push_tenant(owner, tenant, platform_admin):
    accepted(owner); accepted(platform_admin)
    response, _ = start(client(owner)); assert response.status_code == 201
    assert Conversation.objects.get(pk=response.data['id']).tenant_id is None
    assert not Notification.objects.exists()
    guest = APIClient(); guest.credentials(HTTP_X_SUPPORT_TOKEN='a' * 64)
    body = {'client_id': str(uuid4()), 'name': 'Private guest', 'subject': 'Guest secret', 'language': 'uz', 'text': 'Private guest body', 'consent': True}
    assert guest.post(SUPPORT + 'guest/', body, format='json').status_code == 201
    assert not Notification.objects.exists()


def test_legacy_thread_binds_only_explicit_valid_visitor_store_without_rebroadcast(owner, tenant, platform_admin):
    accepted(owner); accepted(platform_admin)
    response, _ = start(client(owner)); pk = response.data['id']
    foreign = TenantFactory(); visitor = client(owner, foreign)
    assert reply(visitor, pk, operator=False).status_code == 403
    conversation = Conversation.objects.get(pk=pk); assert conversation.tenant_id is None
    assert conversation.messages.count() == 1
    visitor = client(owner, tenant)
    assert reply(visitor, pk, operator=False).status_code == 201
    conversation.refresh_from_db(); assert conversation.tenant_id == tenant.pk
    assert Notification.objects.count() == 1
    second = TenantFactory(owner=owner); EmployeeFactory(user=owner, tenant=second, is_owner=True)
    assert reply(client(owner, second), pk, operator=False).status_code == 201
    conversation.refresh_from_db(); assert conversation.tenant_id == tenant.pk
    assert set(Notification.objects.values_list('tenant_id', flat=True)) == {tenant.pk}


def test_support_source_and_outbox_roll_back_together(owner, tenant, platform_admin, monkeypatch):
    accepted(owner); accepted(platform_admin)
    def fail(*args, **kwargs):
        raise RuntimeError('Isolated outbox failure')
    monkeypatch.setattr(PushEvent.objects, 'get_or_create', fail)
    with pytest.raises(RuntimeError, match='outbox failure'):
        start(client(owner, tenant))
    assert not Conversation.objects.exists() and not Message.objects.exists()
    assert not Notification.objects.exists() and not PushEvent.objects.exists()


def test_operator_reply_does_not_notify_revoked_visitor_membership(owner, tenant, platform_admin):
    accepted(owner); accepted(platform_admin)
    first, _ = start(client(owner, tenant)); pk = first.data['id']
    operator = client(platform_admin); claim(operator, pk)
    Employee.objects.filter(user=owner, tenant=tenant).update(is_active=False)
    assert reply(operator, pk).status_code == 201
    assert not Notification.objects.filter(recipient=owner).exists()


def reminder(owner, tenant, assignee=None, **changes):
    return WorkspaceReminder.objects.create(tenant=tenant, created_by=owner, assigned_to=assignee or owner, title='Private task secret 456789', due_at=timezone.now() - timedelta(minutes=5), **changes)


def test_workspace_assigns_only_actual_other_assignee_and_replayed_patch_is_silent(owner, tenant):
    accepted(owner); staff = StaffFactory(terms_accepted=True); EmployeeFactory(user=staff, tenant=tenant)
    api = client(owner, tenant)
    payload = {'title': 'Private task secret 456789', 'due_at': (timezone.now() + timedelta(hours=1)).isoformat(), 'assigned_to_id': staff.pk}
    created = api.post(WORKSPACE, payload, format='json'); assert created.status_code == 201, created.data
    row = Notification.objects.get(); assert row.recipient == staff and row.type == Notification.TYPE_WORKSPACE_ASSIGNED
    assert '456789' not in row.title + row.message and PushEvent.objects.count() == 1
    endpoint = WORKSPACE + str(created.data['id']) + '/'
    assert api.patch(endpoint, {'assigned_to_id': staff.pk}, format='json').status_code == 200
    assert Notification.objects.count() == 1
    assert api.post(WORKSPACE, {**payload, 'assigned_to_id': owner.pk}, format='json').status_code == 201
    assert Notification.objects.count() == 1


def test_workspace_due_once_survives_inbox_deletion_and_skips_completed_or_revoked(owner, tenant):
    accepted(owner)
    due = reminder(owner, tenant)
    reminder(owner, tenant, completed_at=timezone.now())
    revoked = StaffFactory(terms_accepted=True); EmployeeFactory(user=revoked, tenant=tenant, is_active=False)
    reminder(owner, tenant, revoked)
    assert notify_due_workspace_reminders() == 1
    due.refresh_from_db(); assert due.due_notified_at is not None
    row = Notification.objects.get(); assert row.recipient == owner and row.type == Notification.TYPE_WORKSPACE_DUE
    assert '456789' not in row.message
    row.delete()
    assert notify_due_workspace_reminders() == 0 and not Notification.objects.exists()


def test_workspace_completion_reschedule_reassignment_and_delete_suppress_obsolete_push(owner, tenant):
    accepted(owner); task = reminder(owner, tenant); assert notify_due_workspace_reminders() == 1
    api = client(owner, tenant); endpoint = WORKSPACE + str(task.pk) + '/'
    assert api.patch(endpoint, {'completed': True}, format='json').status_code == 200
    assert not Notification.objects.filter(is_read=False).exists()
    assert notify_due_workspace_reminders() == 0
    assert api.patch(endpoint, {'completed': False}, format='json').status_code == 200
    assert notify_due_workspace_reminders() == 1
    future = (timezone.now() + timedelta(days=1)).isoformat()
    assert api.patch(endpoint, {'due_at': future}, format='json').status_code == 200
    assert not Notification.objects.filter(is_read=False).exists() and notify_due_workspace_reminders() == 0
    staff = StaffFactory(terms_accepted=True); EmployeeFactory(user=staff, tenant=tenant)
    assert api.patch(endpoint, {'assigned_to_id': staff.pk}, format='json').status_code == 200
    assert list(Notification.objects.filter(is_read=False).values_list('recipient_id', flat=True)) == [staff.pk]
    assert api.delete(endpoint).status_code == 204
    assert not Notification.objects.filter(is_read=False).exists()


def test_workspace_due_marker_failure_rolls_back_inbox_and_outbox(owner, tenant, monkeypatch):
    accepted(owner); due = reminder(owner, tenant)
    original = WorkspaceReminder.save
    def fail_marker(value, *args, **kwargs):
        if kwargs.get('update_fields') == ['due_notified_at']:
            raise RuntimeError('Isolated due marker failure')
        return original(value, *args, **kwargs)
    monkeypatch.setattr(WorkspaceReminder, 'save', fail_marker)
    with pytest.raises(RuntimeError, match='due marker failure'):
        notify_due_workspace_reminders()
    due.refresh_from_db(); assert due.due_notified_at is None
    assert not Notification.objects.exists() and not PushEvent.objects.exists()


def install(user):
    return register_installation(user, {'installation_id': uuid4(), 'revoke_secret': 'a' * 64,
        'token': 'synthetic-activity-' + uuid4().hex, 'platform': 'android', 'application_id': 'uz.ilbi.mobile'})


def test_completed_workspace_and_read_support_suppress_pending_push_without_live_send(owner, tenant, platform_admin, settings):
    accepted(owner); install(owner)
    task = reminder(owner, tenant); assert notify_due_workspace_reminders() == 1
    api = client(owner, tenant)
    # An operator without an opted-in device may still reply through the protected API;
    # no operator installation or external provider is involved in this check.
    first, _ = start(api); pk = first.data['id']; operator = client(platform_admin); claim(operator, pk)
    sent = reply(operator, pk); assert sent.status_code == 201
    settings.MOBILE_PUSH_ENABLED = True
    def unavailable(token, row):
        raise PushTransportError('provider_network')
    assert process_push_events(sender=unavailable)['accepted'] == 0
    assert api.patch(WORKSPACE + str(task.pk) + '/', {'completed': True}, format='json').status_code == 200
    assert api.post(SUPPORT + f'conversations/{pk}/', {'action': 'read', 'through_id': sent.data['id']}, format='json').status_code == 200
    sent_ids = []
    result = process_push_events(sender=lambda token, row: sent_ids.append(row.pk) or 'synthetic-only', now=timezone.now() + timedelta(minutes=3))
    assert sent_ids == [] and result['accepted'] == 0 and result['skipped'] == 2


@pytest.mark.django_db(transaction=True)
def test_concurrent_due_workers_create_one_notification_and_outbox(owner, tenant):
    accepted(owner); due = reminder(owner, tenant); barrier = Barrier(2)
    def run():
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            return notify_due_workspace_reminders()
        finally:
            close_old_connections()
    with ThreadPoolExecutor(max_workers=2) as pool:
        result = list(pool.map(lambda _: run(), range(2)))
    assert sum(result) == 1
    assert Notification.objects.count() == 1 and PushEvent.objects.count() == 1
    due.refresh_from_db(); assert due.due_notified_at


@pytest.mark.django_db(transaction=True)
def test_concurrent_authenticated_support_start_reuses_one_source_and_notification(owner, tenant, platform_admin):
    accepted(owner); accepted(platform_admin); barrier = Barrier(2); identity = str(uuid4())
    def run():
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            response, _ = start(client(owner, tenant), client_id=identity)
            return response.status_code, response.data['id']
        finally:
            close_old_connections()
    with ThreadPoolExecutor(max_workers=2) as pool:
        result = list(pool.map(lambda _: run(), range(2)))
    assert sorted(status for status, _ in result) == [200, 201]
    assert result[0][1] == result[1][1]
    assert Conversation.objects.count() == 1 and Message.objects.count() == 1
    assert Notification.objects.count() == 1 and PushEvent.objects.count() == 1
