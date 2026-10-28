from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch
from uuid import uuid4

import pytest
from django.core.cache import cache
from django.db import close_old_connections
from rest_framework.test import APIClient

from api.v1.accounts.views.misc import issue_tokens
from apps.core.models import AuditLog
from apps.support.models import Conversation, Message, SupportTelegramSettings
from apps.support.tasks import notify_operators
from apps.tg_bot.models import TelegramContact
from tests.factories import EmployeeFactory, StaffFactory, TenantFactory

pytestmark = pytest.mark.django_db
PASSWORD = "SyntheticAdminPassword42!"


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture(autouse=True)
def isolated_settings(settings):
    settings.TELEGRAM_BOT_TOKEN = "100001:synthetic-platform-tests"
    settings.SUPPORT_OPERATOR_PHONES = []
    settings.INTERNAL_SERVICE_TOKEN = "synthetic-platform-internal"
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def admin(platform_admin):
    platform_admin.set_password(PASSWORD)
    platform_admin.save(update_fields=["password"])
    return platform_admin


def recovery(user, **overrides):
    return {
        "phone_number": "+998900003333",
        "expected_phone_number": user.phone_number,
        "expected_version": user.token_version,
        "telegram_action": "replace",
        "telegram_chat_id": "777000",
        "admin_password": PASSWORD,
        "ownership_verified": True,
        "reason": "Hisob egasi yordam orqali tekshirildi",
        **overrides,
    }


@pytest.mark.parametrize(
    "path",
    [
        "/platform/overview/",
        "/platform/accounts/",
        "/platform/accounts/1/identity/",
        "/support/settings/telegram/",
        "/support/settings/telegram/test/",
    ],
)
@pytest.mark.parametrize("role", ["owner", "staff"])
def test_non_admin_cannot_access_platform_data(path, role):
    user = StaffFactory(role=role)
    response = client_for(user).get("/api/v1" + path)
    assert response.status_code == 403


def test_recovery_moves_own_chat_revokes_tokens_and_preserves_history(admin):
    from apps.accounts.services.password_reset_service import peek_reset_token, store_reset_token

    user = StaffFactory(password="InitialPassword42!")
    employee = EmployeeFactory(user=user)
    # Even when the administrator has a tenant membership, this audit is platform-private.
    EmployeeFactory(user=admin)
    old_phone = user.phone_number
    TelegramContact.objects.create(phone_number=old_phone, chat_id="777000", bot_id="100001")
    tokens = issue_tokens(user)
    store_reset_token("synthetic-platform-reset", user.pk)
    response = client_for(admin).post(f"/api/v1/platform/accounts/{user.pk}/identity/", recovery(user), format="json")
    assert response.status_code == 200
    user.refresh_from_db()
    employee.refresh_from_db()
    assert user.phone_number == "+998900003333"
    assert not user.is_phone_verified
    assert employee.user_id == user.pk and employee.is_active
    assert not TelegramContact.objects.filter(phone_number=old_phone).exists()
    assert TelegramContact.objects.get(phone_number=user.phone_number).chat_id == "777000"
    assert peek_reset_token("synthetic-platform-reset") is None
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    assert client.get("/api/v1/auth/profile/").status_code == 401
    assert client.post("/api/v1/auth/token/refresh/", {"refresh": tokens["refresh"]}).status_code == 401
    audit = AuditLog.objects.get(target_model="User", target_id=str(user.pk))
    assert audit.tenant_id is None
    assert audit.changes["operation"] == "identity_recovery"
    assert PASSWORD not in str(audit.changes)


@pytest.mark.parametrize(
    "overrides",
    [
        {"admin_password": "wrong"},
        {"ownership_verified": False},
        {"expected_phone_number": "+998900000000"},
        {"expected_version": 999},
        {"telegram_chat_id": "-100123456"},
        {"reason": "x"},
    ],
)
def test_invalid_recovery_changes_nothing(admin, overrides):
    user = StaffFactory()
    old_phone = user.phone_number
    TelegramContact.objects.create(phone_number=old_phone, chat_id="777000", bot_id="100001")
    response = client_for(admin).post(
        f"/api/v1/platform/accounts/{user.pk}/identity/", recovery(user, **overrides), format="json"
    )
    assert response.status_code == 400
    user.refresh_from_db()
    assert user.phone_number == old_phone
    assert TelegramContact.objects.get(phone_number=old_phone).chat_id == "777000"
    assert not AuditLog.objects.filter(target_model="User", target_id=str(user.pk)).exists()


def test_recovery_cannot_take_other_accounts_phone_or_chat(admin):
    user, other = StaffFactory(), StaffFactory()
    TelegramContact.objects.create(phone_number=other.phone_number, chat_id="777000", bot_id="100001")
    client = client_for(admin)
    path = f"/api/v1/platform/accounts/{user.pk}/identity/"
    assert client.post(path, recovery(user, phone_number=other.phone_number), format="json").status_code == 400
    assert client.post(path, recovery(user), format="json").status_code == 400
    assert TelegramContact.objects.get(chat_id="777000").phone_number == other.phone_number


def test_explicit_unlink_preserves_login(admin):
    user = StaffFactory()
    TelegramContact.objects.create(phone_number=user.phone_number, chat_id="777000", bot_id="100001")
    response = client_for(admin).post(
        f"/api/v1/platform/accounts/{user.pk}/identity/",
        recovery(user, phone_number=user.phone_number, telegram_action="unlink"),
        format="json",
    )
    assert response.status_code == 200
    assert not TelegramContact.objects.filter(phone_number=user.phone_number).exists()
    assert response.data["telegram_linked"] is False


def test_account_list_search_filter_and_bounded_queries(admin, django_assert_max_num_queries):
    for _ in range(12):
        EmployeeFactory()
    target = StaffFactory(first_name="PlatformUniqueSearch")
    with django_assert_max_num_queries(7):
        response = client_for(admin).get("/api/v1/platform/accounts/?page_size=20")
    assert response.status_code == 200 and response.data["count"] >= 13
    found = client_for(admin).get("/api/v1/platform/accounts/?search=PlatformUniqueSearch&role=staff&active=true")
    assert [row["id"] for row in found.data["results"]] == [target.pk]
    assert "password" not in str(found.data)
    assert client_for(admin).get("/api/v1/platform/accounts/?role=invalid").status_code == 400


def test_block_unblock_and_admin_protection(admin):
    user = StaffFactory()
    data = {"blocked": True, "admin_password": PASSWORD, "reason": "Admin tekshiruvi"}
    client = client_for(admin)
    assert client.post(f"/api/v1/platform/accounts/{user.pk}/status/", data).status_code == 200
    user.refresh_from_db()
    assert not user.is_active
    data["blocked"] = False
    assert client.post(f"/api/v1/platform/accounts/{user.pk}/status/", data).status_code == 200
    user.refresh_from_db()
    assert user.is_active
    data["blocked"] = True
    assert client.post(f"/api/v1/platform/accounts/{admin.pk}/status/", data).status_code == 400


def test_overview_counts_actual_platform_state(admin):
    TenantFactory()
    Conversation.objects.create(guest_hash="a" * 64, name="Private", subject="Secret", language="uz")
    response = client_for(admin).get("/api/v1/platform/overview/")
    assert response.status_code == 200
    assert response.data["counts"]["support_waiting"] == 1
    assert response.data["counts"]["tenants"] == 1


@pytest.mark.parametrize(
    "target,expected", [("personal", {"777000"}), ("group", {"-100777000"}), ("both", {"777000", "-100777000"})]
)
def test_support_recipients_settings_and_privacy(admin, target, expected):
    TelegramContact.objects.create(phone_number=admin.phone_number, chat_id="777000", bot_id="100001")
    response = client_for(admin).put(
        "/api/v1/support/settings/telegram/",
        {
            "enabled": True,
            "target": target,
            "group_chat_id": "-100777000",
        },
        format="json",
    )
    assert response.status_code == 200
    row = Conversation.objects.create(
        guest_hash="a" * 64, name="Private name", subject="Secret question", language="uz"
    )
    with patch("apps.support.tasks.send_telegram_message", return_value=True) as send:
        assert notify_operators(str(row.pk)) is True
    assert {call.args[0] for call in send.call_args_list} == expected
    assert all(
        "Private name" not in call.args[1] and "Secret question" not in call.args[1] for call in send.call_args_list
    )
    assert all(str(row.pk) in call.args[1] for call in send.call_args_list)


def test_support_disabled_overrides_legacy_and_test_queue(admin, settings):
    settings.SUPPORT_OPERATOR_PHONES = [admin.phone_number]
    TelegramContact.objects.create(phone_number=admin.phone_number, chat_id="777000", bot_id="100001")
    config = SupportTelegramSettings.objects.create(admin=admin, enabled=False)
    row = Conversation.objects.create(guest_hash="b" * 64, name="Test", subject="Test", language="uz")
    with patch("apps.support.tasks.send_telegram_message") as send:
        notify_operators(str(row.pk))
        send.assert_not_called()
    config.enabled = True
    config.save()
    with patch("api.v1.support.settings_views.send_support_test.delay") as enqueue:
        assert client_for(admin).post("/api/v1/support/settings/telegram/test/").status_code == 202
        enqueue.assert_called_once_with(admin.pk)


def test_support_settings_invalid_targets_or_missing_personal_link(admin):
    client = client_for(admin)
    for data in [
        {"enabled": True, "target": "personal", "group_chat_id": ""},
        {"enabled": True, "target": "group", "group_chat_id": "123"},
        {"enabled": True, "target": "group", "group_chat_id": ""},
    ]:
        assert client.put("/api/v1/support/settings/telegram/", data, format="json").status_code == 400
    assert not SupportTelegramSettings.objects.exists()


def test_registration_conflict_explains_admin_recovery_without_moving_contact(settings):
    TelegramContact.objects.create(phone_number="+998900001111", chat_id="777000", bot_id="100001")
    response = APIClient().post(
        "/api/v1/internal/telegram/register/",
        {
            "phone_number": "+998900002222",
            "chat_id": "777000",
        },
        HTTP_AUTHORIZATION=f"Internal {settings.INTERNAL_SERVICE_TOKEN}",
    )
    assert response.status_code == 400
    assert response.data["code"] == "telegram_chat_already_linked"
    assert TelegramContact.objects.get(chat_id="777000").phone_number == "+998900001111"


def test_support_badge_counts_only_unread_visitor_messages(admin, staff):
    row = Conversation.objects.create(guest_hash="b" * 64, name="Test", subject="Test", language="uz")
    Message.objects.create(conversation=row, sender="visitor", text="First")
    last = Message.objects.create(conversation=row, sender="visitor", text="Second")
    Message.objects.create(conversation=row, sender="operator", text="Reply", author=admin)
    client = client_for(admin)
    assert client.get("/api/v1/platform/support-unread/").data["unread"] == 2
    row.operator_read_id = last.pk
    row.save()
    assert client.get("/api/v1/platform/support-unread/").data["unread"] == 0
    assert client_for(staff).get("/api/v1/platform/support-unread/").status_code == 403


def test_configured_preferences_replace_all_legacy_recipients(admin, settings):
    settings.SUPPORT_OPERATOR_PHONES = ["+998900000009"]
    TelegramContact.objects.create(phone_number=settings.SUPPORT_OPERATOR_PHONES[0], chat_id="11111", bot_id="100001")
    SupportTelegramSettings.objects.create(admin=admin, enabled=False)
    row = Conversation.objects.create(guest_hash="c" * 64, name="Test", subject="Test", language="uz")
    with patch("apps.support.tasks.send_telegram_message") as send:
        notify_operators(str(row.pk))
        send.assert_not_called()


def test_guest_message_queues_notification_only_after_commit(admin, django_capture_on_commit_callbacks):
    SupportTelegramSettings.objects.create(admin=admin, enabled=True, target="group", group_chat_id="-100777000")
    client = APIClient()
    client.credentials(HTTP_X_SUPPORT_TOKEN="d" * 64)
    with patch("apps.support.tasks.notify_operators.delay") as enqueue:
        with django_capture_on_commit_callbacks(execute=True):
            response = client.post(
                "/api/v1/support/guest/",
                {
                    "name": "Private",
                    "subject": "Help",
                    "text": "Private question",
                    "language": "uz",
                    "consent": True,
                    "client_id": str(uuid4()),
                },
                format="json",
            )
            assert response.status_code == 201
            enqueue.assert_not_called()
        enqueue.assert_called_once_with(str(response.data["id"]))


@pytest.mark.django_db(transaction=True)
def test_concurrent_registration_conflict_is_controlled(settings):
    barrier = Barrier(2)

    def register(phone):
        close_old_connections()
        try:
            barrier.wait(timeout=5)
            return (
                APIClient(raise_request_exception=False)
                .post(
                    "/api/v1/internal/telegram/register/",
                    {"phone_number": phone, "chat_id": "777000"},
                    HTTP_AUTHORIZATION=f"Internal {settings.INTERNAL_SERVICE_TOKEN}",
                )
                .status_code
            )
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(register, ["+998900001111", "+998900002222"]))
    assert sorted(results) == [200, 400]
    assert TelegramContact.objects.filter(chat_id="777000").count() == 1
