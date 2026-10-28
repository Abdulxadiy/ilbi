"""Tagged demo identities must never authenticate outside enabled local demo mode."""

import json
import uuid
from unittest.mock import patch

import pytest
from api.v1.accounts.views.misc import issue_tokens
from apps.accounts.services import login_throttle, login_ticket_service, password_reset_service
from apps.accounts.services.demo_access_service import DemoAccessService
from apps.support.models import Conversation, SupportTelegramSettings
from apps.support.tasks import notify_operators, send_support_test
from apps.tg_bot.models import TelegramContact
from django.contrib.auth.models import Group
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.test import APIClient
from tests.factories import EmployeeFactory, TenantFactory, UserFactory

pytestmark = pytest.mark.django_db
PASSWORD = "SyntheticDemoIsolation2026!"
LOGIN = "/api/v1/auth/admin-login/"
PROFILE = "/api/v1/auth/profile/"
REFRESH = "/api/v1/auth/token/refresh/"
GROUPS = (DemoAccessService.GROUP_NAME, DemoAccessService.LEGACY_GROUP_NAME)


@pytest.fixture(autouse=True)
def local_demo_mode(settings):
    settings.DEBUG = True
    settings.LOCAL_DEMO_LOGIN_ENABLED = True
    with (
        patch.object(login_throttle, "is_locked", return_value=(False, 0)),
        patch.object(login_throttle, "register_success"),
        patch.object(login_throttle, "register_failure"),
    ):
        yield


def make_demo(role="platform_admin", group=DemoAccessService.GROUP_NAME):
    user = UserFactory(
        username=f"demo_isolation_{role}",
        phone_number="+998000009991",
        role=role,
        is_staff=role == "platform_admin",
        is_superuser=role == "platform_admin",
        email="synthetic-demo@example.invalid",
        password=PASSWORD,
    )
    marker, _ = Group.objects.get_or_create(name=group)
    user.groups.add(marker)
    if role != "platform_admin":
        tenant = TenantFactory(owner=user) if role == "owner" else TenantFactory()
        EmployeeFactory(user=user, tenant=tenant, is_owner=role == "owner")
    return user


def login(user):
    return APIClient().post(LOGIN, {"username": user.username, "password": PASSWORD}, format="json")


def access_request(encoded, path=PROFILE):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {encoded}")
    return client.get(path)


@pytest.mark.parametrize("role", ["platform_admin", "owner", "staff"])
@pytest.mark.parametrize("group", GROUPS)
@pytest.mark.parametrize("flags", [(False, False), (True, False), (False, True)])
def test_old_demo_tokens_and_new_login_are_rejected_when_either_switch_is_off(settings, role, group, flags):
    user = make_demo(role, group)
    issued = login(user)
    assert issued.status_code == 200 and issued.data["demo_login"] is True
    assert access_request(issued.data["access"]).status_code == 200
    old_version = user.token_version
    settings.DEBUG, settings.LOCAL_DEMO_LOGIN_ENABLED = flags

    with patch("api.v1.accounts.views.admin_login.login_ticket_service.create_ticket") as ticket:
        response = login(user)
    assert response.status_code == 401
    assert "access" not in response.data and "login_ticket" not in response.data
    ticket.assert_not_called()
    assert access_request(issued.data["access"]).status_code == 401
    # The global admin endpoint was the original exposure; even a demo admin
    # with its correct current security version must now fail authentication.
    assert access_request(issued.data["access"], "/api/v1/platform/accounts/").status_code == 401
    response = APIClient().post(REFRESH, {"refresh": issued.data["refresh"]}, format="json")
    assert response.status_code == 401 and "access" not in response.data
    user.refresh_from_db()
    assert user.is_active and user.token_version == old_version


@pytest.mark.parametrize("group", GROUPS)
def test_demo_marker_still_blocks_an_account_after_its_identity_is_edited(settings, group):
    user = make_demo(group=group)
    issued = login(user).data
    user.username = "renamed_synthetic_account"
    user.phone_number = "+998901234567"
    user.save(update_fields=["username", "phone_number"])
    settings.DEBUG = settings.LOCAL_DEMO_LOGIN_ENABLED = False
    assert login(user).status_code == 401
    assert access_request(issued["access"]).status_code == 401
    assert APIClient().post(REFRESH, {"refresh": issued["refresh"]}).status_code == 401


def test_token_issuance_has_a_final_demo_guard(settings):
    user = make_demo()
    settings.DEBUG = settings.LOCAL_DEMO_LOGIN_ENABLED = False
    with patch("api.v1.accounts.views.misc.RefreshToken.for_user") as issuer:
        with pytest.raises(AuthenticationFailed):
            issue_tokens(user)
    issuer.assert_not_called()


def test_old_login_ticket_cannot_send_or_verify_otp_after_demo_is_disabled(settings):
    user = make_demo()
    ticket = login_ticket_service.create_ticket(user)
    login_ticket_service.mark_otp_sent(ticket)
    settings.DEBUG = settings.LOCAL_DEMO_LOGIN_ENABLED = False
    try:
        with (
            patch("api.v1.accounts.views.admin_login.get_telegram_contact_or_error") as contact,
            patch("api.v1.accounts.views.admin_login.send_otp_or_error") as sender,
            patch("api.v1.accounts.views.admin_login.otp_services.verify_code") as verifier,
        ):
            assert login_ticket_service.resolve_ticket(ticket) is None
            for path, data in (
                ("telegram-status/", {"login_ticket": ticket}),
                ("send-otp/", {"login_ticket": ticket}),
                ("verify-otp/", {"login_ticket": ticket, "verification_code": "123456"}),
            ):
                response = APIClient().post(LOGIN + path, data, format="json")
                assert response.status_code == 401
                assert response.data["error"] == "invalid_or_expired_login_ticket"
                assert "access" not in response.data
            contact.assert_not_called()
            sender.assert_not_called()
            verifier.assert_not_called()
    finally:
        login_ticket_service.redis_client.delete(
            login_ticket_service._ticket_key(ticket),
            login_ticket_service._sent_key(ticket),
        )


@pytest.mark.parametrize("purpose", ["reset_password", "new_employee"])
def test_old_password_links_cannot_mutate_demo_identity_or_resume_login(settings, purpose):
    user = make_demo()
    token = uuid.uuid4().hex
    password_reset_service.store_reset_token(token, user.pk, purpose=purpose)
    old_password, old_version = user.password, user.token_version
    settings.DEBUG = settings.LOCAL_DEMO_LOGIN_ENABLED = False
    client = APIClient()
    try:
        assert password_reset_service.peek_reset_token(token) is None
        verified = client.get("/api/v1/auth/password-reset/verify/", {"token": token})
        assert verified.status_code == 200 and verified.data["valid"] is False
        confirmed = client.post(
            "/api/v1/auth/password-reset/confirm/",
            {
                "token": token,
                "new_password": "AfterDemoIsolation2026!",
                "username": "renamed_demo",
            },
            format="json",
        )
        assert confirmed.status_code == 400 and "login_ticket" not in confirmed.data
        assert client.post("/api/v1/auth/password-reset/resume/", {"token": token}).status_code == 400
        user.refresh_from_db()
        assert user.password == old_password and user.token_version == old_version
        assert user.username == "demo_isolation_platform_admin"
    finally:
        password_reset_service.redis_client.delete(
            password_reset_service._token_key(token),
            password_reset_service._cooldown_key(user.pk),
            password_reset_service._invitation_index_key(user.pk),
        )


def test_disabled_demo_gets_no_reset_email_and_cannot_change_password_with_old_password(settings):
    user = make_demo()
    settings.DEBUG = settings.LOCAL_DEMO_LOGIN_ENABLED = False
    original = (user.password, user.token_version)
    with (
        patch.object(password_reset_service, "generate_reset_token") as token_generator,
        patch.object(password_reset_service, "send_password_reset_email") as email,
    ):
        response = APIClient().post("/api/v1/auth/password-reset/request/", {"login": user.username})
        assert response.status_code == 200 and response.data["email_hint"] is None
        ok, reason = password_reset_service.request_password_reset_for_user(user.pk)
        assert not ok and reason == "inactive_user"
        changed = APIClient().post(
            "/api/v1/auth/password-reset/change-with-old/",
            {
                "login": user.username,
                "old_password": PASSWORD,
                "new_password": "AfterDemoIsolation2026!",
            },
        )
        assert changed.status_code == 400
        token_generator.assert_not_called()
        email.assert_not_called()
    user.refresh_from_db()
    assert (user.password, user.token_version) == original


def test_previously_started_invitation_cannot_resume_telegram_after_demo_is_disabled(settings):
    user = make_demo()
    token = uuid.uuid4().hex
    password_reset_service.store_reset_token(token, user.pk, purpose="new_employee")
    key = password_reset_service._token_key(token)
    payload = json.loads(password_reset_service.redis_client.get(key))
    payload.update(phase="pending_2fa", password_version=user.token_version)
    password_reset_service.redis_client.set(key, json.dumps(payload), ex=300)
    try:
        assert password_reset_service.resume_invitation(token).pk == user.pk
        settings.DEBUG = settings.LOCAL_DEMO_LOGIN_ENABLED = False
        with patch("api.v1.accounts.views.password_reset.login_ticket_service.create_ticket") as ticket:
            response = APIClient().post("/api/v1/auth/password-reset/resume/", {"token": token})
        assert response.status_code == 400 and "login_ticket" not in response.data
        ticket.assert_not_called()
    finally:
        password_reset_service.redis_client.delete(
            key,
            password_reset_service._cooldown_key(user.pk),
            password_reset_service._invitation_index_key(user.pk),
        )


@pytest.mark.parametrize("group", GROUPS)
@pytest.mark.parametrize("preferences", [False, True])
def test_production_support_tasks_do_not_notify_a_demo_admin_via_personal_or_group_chat(settings, group, preferences):
    user = make_demo(group=group)
    settings.TELEGRAM_BOT_TOKEN = "100001:synthetic-test-bot"
    settings.SUPPORT_OPERATOR_PHONES = [user.phone_number]
    TelegramContact.objects.create(phone_number=user.phone_number, chat_id="777001", bot_id="100001")
    if preferences:
        SupportTelegramSettings.objects.create(admin=user, enabled=True, target="both", group_chat_id="-100777001")
    conversation = Conversation.objects.create(
        guest_hash="a" * 64, name="Synthetic", subject="Synthetic", language="uz"
    )
    with patch("apps.support.tasks.send_telegram_message", return_value=True) as sender:
        notify_operators(str(conversation.pk))
        assert sender.call_count == (2 if preferences else 1)
        sender.reset_mock()
        settings.DEBUG = settings.LOCAL_DEMO_LOGIN_ENABLED = False
        notify_operators(str(conversation.pk))
        assert send_support_test(user.pk) is False
        sender.assert_not_called()


@pytest.mark.parametrize("role", ["platform_admin", "owner", "staff"])
def test_untagged_real_accounts_keep_access_even_with_a_demo_like_username(settings, role):
    # Names/phone prefixes alone must never block a real untagged account.
    settings.DEBUG = settings.LOCAL_DEMO_LOGIN_ENABLED = False
    user = UserFactory(username="demo_real_account", phone_number="+998000009992", role=role, password=PASSWORD)
    tokens = issue_tokens(user)
    assert access_request(tokens["access"]).status_code == 200
    assert APIClient().post(REFRESH, {"refresh": tokens["refresh"]}).status_code == 200
    ticket = None
    try:
        response = login(user)
        assert response.status_code == 200 and "access" not in response.data
        ticket = response.data["login_ticket"]
    finally:
        if ticket:
            login_ticket_service.redis_client.delete(login_ticket_service._ticket_key(ticket))
