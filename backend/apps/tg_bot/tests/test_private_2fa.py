from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest
from rest_framework.test import APIClient

from api.v1.accounts.views import misc
from apps.accounts.services import login_ticket_service, otp_services
from apps.tg_bot.identity import current_bot_id
from apps.tg_bot.models import TelegramContact
from apps.tg_bot.services import send_telegram_message
from tests.factories import StaffFactory

pytestmark = pytest.mark.django_db
REGISTER_URL = "/api/v1/internal/telegram/register/"
LOGIN_URL = "/api/v1/auth/admin-login/"
STATUS_URL = "/api/v1/auth/admin-login/telegram-status/"
SEND_URL = "/api/v1/auth/admin-login/send-otp/"
VERIFY_URL = "/api/v1/auth/admin-login/verify-otp/"
PASSWORD = "SyntheticPrivateChatPassword42!"


@pytest.fixture(autouse=True)
def configured_bot(settings):
    settings.TELEGRAM_BOT_TOKEN = "100001:synthetic-private-chat-tests"
    settings.INTERNAL_SERVICE_TOKEN = "synthetic-internal-private-chat-tests"
    with patch.object(misc, "send_telegram_message", return_value=True) as send:
        yield send


@pytest.mark.parametrize(
    "chat_id",
    ["-12345", "-1001234567890", "0", "00123", "+123", "١٢٣", "123.0", "1e3", "not-a-chat", str(2**52), None, "", True],
)
def test_registration_rejects_invalid_id_without_changing_existing_contact(chat_id, settings):
    contact = TelegramContact.objects.create(phone_number="+998900001111", chat_id="12345", bot_id=current_bot_id())
    response = APIClient().post(
        REGISTER_URL,
        {"phone_number": contact.phone_number, "chat_id": chat_id},
        format="json",
        HTTP_AUTHORIZATION=f"Internal {settings.INTERNAL_SERVICE_TOKEN}",
    )
    assert response.status_code == 400
    assert "chat_id" in response.data
    contact.refresh_from_db()
    assert contact.chat_id == "12345"
    assert TelegramContact.objects.count() == 1


@pytest.mark.parametrize("chat_id", ["12345", "4294967296", str(2**52 - 1), 123456])
def test_registration_accepts_positive_user_id(chat_id, settings):
    response = APIClient().post(
        REGISTER_URL,
        {"phone_number": "+998900001111", "chat_id": chat_id},
        format="json",
        HTTP_AUTHORIZATION=f"Internal {settings.INTERNAL_SERVICE_TOKEN}",
    )
    assert response.status_code == 200
    contact = TelegramContact.objects.get(phone_number="+998900001111")
    assert contact.chat_id == str(chat_id)
    assert contact.bot_id == current_bot_id()


@pytest.mark.parametrize("authorization", ["", "Internal incorrect-synthetic-token"])
def test_registration_still_requires_internal_authentication(authorization):
    response = APIClient().post(
        REGISTER_URL,
        {"phone_number": "+998900001111", "chat_id": "12345"},
        HTTP_AUTHORIZATION=authorization,
    )
    assert response.status_code == 403
    assert not TelegramContact.objects.exists()


@pytest.fixture
def login_context():
    user = StaffFactory(username=f"private-2fa-{uuid4().hex}", password=PASSWORD)
    client = APIClient()
    keys = [
        otp_services._otp_key(user.phone_number),
        otp_services._attempts_key(user.phone_number),
        otp_services._cooldown_key(user.phone_number),
    ]
    otp_services.redis_client.delete(*keys)
    ticket = None

    def start_login():
        nonlocal ticket
        response = client.post(LOGIN_URL, {"username": user.username, "password": PASSWORD})
        assert response.status_code == 200
        ticket = response.data["login_ticket"]
        return response

    try:
        yield user, client, start_login
    finally:
        otp_services.redis_client.delete(*keys)
        if ticket:
            login_ticket_service.redis_client.delete(
                login_ticket_service._ticket_key(ticket),
                login_ticket_service._sent_key(ticket),
            )


@pytest.mark.parametrize("chat_id", ["-12345", "-1001234567890", "0", "not-a-chat"])
def test_legacy_group_or_invalid_contact_is_unlinked_and_receives_no_otp(login_context, configured_bot, chat_id):
    user, client, start_login = login_context
    contact = TelegramContact.objects.create(phone_number=user.phone_number, chat_id=chat_id, bot_id=current_bot_id())
    response = start_login()
    assert response.data["telegram_linked"] is False
    ticket = response.data["login_ticket"]
    assert client.post(STATUS_URL, {"login_ticket": ticket}).data["telegram_linked"] is False
    sent = client.post(SEND_URL, {"login_ticket": ticket})
    assert sent.status_code == 404
    assert sent.data["error"] == "telegram_contact_not_found"
    assert "shaxsiy chat" in sent.data["detail"]
    configured_bot.assert_not_called()
    assert not otp_services.redis_client.exists(otp_services._otp_key(user.phone_number))
    assert not otp_services.is_in_cooldown(user.phone_number)
    assert not login_ticket_service.was_otp_sent(ticket)
    contact.refresh_from_db()
    assert contact.chat_id == chat_id  # Existing rows are never silently rewritten.


def test_relinking_group_to_private_chat_allows_full_otp_login(login_context, configured_bot, settings):
    user, client, start_login = login_context
    contact = TelegramContact.objects.create(
        phone_number=user.phone_number,
        chat_id="-1001234567890",
        bot_id=current_bot_id(),
    )
    ticket = start_login().data["login_ticket"]
    assert client.post(SEND_URL, {"login_ticket": ticket}).status_code == 404
    assert (
        client.post(
            REGISTER_URL,
            {"phone_number": user.phone_number, "chat_id": "4294967296"},
            HTTP_AUTHORIZATION=f"Internal {settings.INTERNAL_SERVICE_TOKEN}",
        ).status_code
        == 200
    )
    contact.refresh_from_db()
    assert contact.chat_id == "4294967296"
    assert client.post(STATUS_URL, {"login_ticket": ticket}).data["telegram_linked"] is True
    assert client.post(SEND_URL, {"login_ticket": ticket}).status_code == 200
    configured_bot.assert_called_once()
    assert configured_bot.call_args.args[0] == "4294967296"
    code = otp_services.redis_client.get(otp_services._otp_key(user.phone_number))
    verified = client.post(VERIFY_URL, {"login_ticket": ticket, "verification_code": code})
    assert verified.status_code == 200
    assert verified.data["access"] and verified.data["refresh"]


@pytest.mark.parametrize("chat_id", ["-12345", "-1001234567890", "0", "invalid", None, 12345])
def test_final_otp_sender_blocks_invalid_contact_before_generating_code(chat_id, configured_bot):
    with patch.object(otp_services, "generate_code") as generate, patch.object(otp_services, "store_code") as store:
        response = misc.send_otp_or_error("+998900001111", SimpleNamespace(chat_id=chat_id))
    assert response.status_code == 404
    generate.assert_not_called()
    store.assert_not_called()
    configured_bot.assert_not_called()


def test_general_telegram_sender_still_allows_group_reports():
    with patch("apps.tg_bot.services.requests.post") as post:
        post.return_value.json.return_value = {"ok": True}
        assert send_telegram_message("-1001234567890", "Synthetic store report") is True
    assert post.call_args.kwargs["json"]["chat_id"] == "-1001234567890"
