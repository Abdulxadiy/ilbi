"""
Place at: apps/accounts/tests/test_admin_login_views.py

API-level (integration) tests for the admin-panel login flow:
username+password -> Telegram contact gate -> OTP -> JWT tokens, with
progressive throttling and a permanent-ban escalation on top.

Covers:
- api/v1/accounts/views/admin_login.py  (AdminLoginView, AdminLoginVerifyOTPView)
- apps/accounts/services/login_throttle.py (the 5/3/1 -> ban state machine)

These are the first API/view-level tests in the project — everything
before this tested the service layer directly. Uses a real Redis (both
otp_services and login_throttle build their client from the same
settings.REDIS_URL) and DRF's APIClient to exercise the actual URL
routing + views, not just the underlying functions.
"""
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from apps.accounts.services import login_throttle, login_ticket_service
from apps.accounts.services import otp_services as otp
from apps.tg_bot.identity import current_bot_id
from apps.tg_bot.models import TelegramContact
from tests.factories import StaffFactory

pytestmark = pytest.mark.django_db

ADMIN_LOGIN_URL = "/api/v1/auth/admin-login/"
TELEGRAM_STATUS_URL = "/api/v1/auth/admin-login/telegram-status/"
SEND_OTP_URL = "/api/v1/auth/admin-login/send-otp/"
ADMIN_LOGIN_VERIFY_URL = "/api/v1/auth/admin-login/verify-otp/"
PASSWORD = "CorrectHorseBatteryStaple1"


@pytest.fixture(autouse=True)
def clean_redis():
    """Both otp_services and login_throttle build their Redis client from
    the same settings.REDIS_URL, so flushing via either clears state for
    both — matches the clean_redis fixture in test_otp_services.py."""
    login_throttle.redis_client.flushdb()
    yield
    login_throttle.redis_client.flushdb()


@pytest.fixture(autouse=True)
def mock_telegram_send(settings):
    """Every test in this module gets a working (mocked) Telegram
    delivery by default, so tests don't need to touch the real bot API."""
    settings.TELEGRAM_BOT_TOKEN = "123456789:unit-test-token"
    with patch("api.v1.accounts.views.misc.send_telegram_message", return_value=True) as mock:
        yield mock


@pytest.fixture
def api_client():
    # Named api_client (not `client`) to avoid shadowing pytest-django's
    # own `client` fixture (django.test.Client) — we specifically need
    # DRF's APIClient here.
    return APIClient()


@pytest.fixture
def staff_with_credentials(db):
    """A staff user who has already completed the admin-login credential
    setup: a real username (StaffFactory default), a known password, and
    a linked TelegramContact so OTP delivery can succeed."""
    user = StaffFactory(password=PASSWORD)
    TelegramContact.objects.create(phone_number=user.phone_number, chat_id="12345", bot_id=current_bot_id())
    return user


def _real_otp_code(phone_number):
    """Reach into otp_services' Redis key directly to read back the code
    that was actually sent — the test has no other way to 'receive' the
    Telegram message."""
    return otp.redis_client.get(otp._otp_key(phone_number))


class TestAdminLoginPasswordStep:
    """POST /auth/admin-login/ — step 1: username + password."""

    def test_wrong_password_rejected_generically(self, api_client, staff_with_credentials):
        response = api_client.post(
            ADMIN_LOGIN_URL,
            {"username": staff_with_credentials.username, "password": "wrong"},
        )

        assert response.status_code == 401
        assert response.data["detail"] == "Username or password incorrect!"

    def test_nonexistent_username_rejected_identically(self, api_client, staff_with_credentials):
        # The response for a wrong password on a REAL username must be
        # identical to a username that doesn't exist at all — otherwise
        # an attacker can enumerate valid usernames by comparing errors.
        wrong_password = api_client.post(
            ADMIN_LOGIN_URL,
            {"username": staff_with_credentials.username, "password": "wrong"},
        )
        nonexistent = api_client.post(
            ADMIN_LOGIN_URL,
            {"username": "no-such-user", "password": "whatever"},
        )

        assert nonexistent.status_code == wrong_password.status_code == 401
        assert nonexistent.data == wrong_password.data

    def test_correct_password_returns_ticket_without_sending_otp(
        self, api_client, staff_with_credentials, mock_telegram_send,
    ):
        response = api_client.post(
            ADMIN_LOGIN_URL,
            {"username": staff_with_credentials.username, "password": PASSWORD},
        )

        assert response.status_code == 200
        # StaffFactory always builds numbers as "+99890" + a 7-digit
        # sequence (see tests/factories.py), so the operator code is
        # always "90" — only the last 2 digits vary per test run.
        expected_hint = f"+998 90 *** ** {staff_with_credentials.phone_number[-2:]}"
        assert response.data["phone_hint"] == expected_hint
        assert response.data["telegram_linked"] is True
        assert response.data["login_ticket"]
        assert _real_otp_code(staff_with_credentials.phone_number) is None
        mock_telegram_send.assert_not_called()
        # The full phone number must never appear anywhere in the response.
        assert staff_with_credentials.phone_number not in str(response.data)


class TestAdminLoginOTPStep:
    """Telegram gate must succeed before the OTP can be issued or verified."""

    def _ticket(self, api_client, user):
        response = api_client.post(ADMIN_LOGIN_URL, {"username": user.username, "password": PASSWORD})
        assert response.status_code == 200
        return response.data["login_ticket"]

    def test_status_does_not_send_otp_and_old_bot_contact_is_stale(
        self, api_client, staff_with_credentials, mock_telegram_send,
    ):
        ticket = self._ticket(api_client, staff_with_credentials)
        status_response = api_client.post(TELEGRAM_STATUS_URL, {"login_ticket": ticket})
        assert status_response.status_code == 200
        assert status_response.data["telegram_linked"] is True
        assert _real_otp_code(staff_with_credentials.phone_number) is None
        mock_telegram_send.assert_not_called()

        TelegramContact.objects.filter(phone_number=staff_with_credentials.phone_number).update(bot_id="old-bot")
        stale_response = api_client.post(TELEGRAM_STATUS_URL, {"login_ticket": ticket})
        assert stale_response.status_code == 200
        assert stale_response.data["telegram_linked"] is False
        send_response = api_client.post(SEND_OTP_URL, {"login_ticket": ticket})
        assert send_response.status_code == 404
        assert send_response.data["error"] == "telegram_contact_not_found"
        mock_telegram_send.assert_not_called()

    def test_contact_can_be_linked_after_password_step(self, api_client, staff_with_credentials, mock_telegram_send):
        TelegramContact.objects.filter(phone_number=staff_with_credentials.phone_number).delete()
        ticket = self._ticket(api_client, staff_with_credentials)
        assert api_client.post(TELEGRAM_STATUS_URL, {"login_ticket": ticket}).data["telegram_linked"] is False
        TelegramContact.objects.create(
            phone_number=staff_with_credentials.phone_number,
            chat_id="98765",
            bot_id=current_bot_id(),
        )
        assert api_client.post(TELEGRAM_STATUS_URL, {"login_ticket": ticket}).data["telegram_linked"] is True
        sent = api_client.post(SEND_OTP_URL, {"login_ticket": ticket})
        assert sent.status_code == 200
        assert sent.data["otp_sent"] is True
        assert _real_otp_code(staff_with_credentials.phone_number) is not None
        mock_telegram_send.assert_called_once()

    def test_registration_rebinds_a_stale_contact_to_current_bot(self, api_client, staff_with_credentials):
        from api.v1.tg_bot.serializers import TelegramContactSerializer

        TelegramContact.objects.filter(phone_number=staff_with_credentials.phone_number).update(bot_id="old-bot")
        ticket = self._ticket(api_client, staff_with_credentials)
        assert api_client.post(TELEGRAM_STATUS_URL, {"login_ticket": ticket}).data["telegram_linked"] is False
        serializer = TelegramContactSerializer(data={
            "phone_number": staff_with_credentials.phone_number,
            "chat_id": "987654321",
        })
        assert serializer.is_valid()
        serializer.save()
        contact = TelegramContact.objects.get(phone_number=staff_with_credentials.phone_number)
        assert contact.bot_id == current_bot_id()
        assert api_client.post(TELEGRAM_STATUS_URL, {"login_ticket": ticket}).data["telegram_linked"] is True

    def test_failed_telegram_delivery_never_arms_ticket(self, api_client, staff_with_credentials):
        ticket = self._ticket(api_client, staff_with_credentials)
        with patch("api.v1.accounts.views.misc.send_telegram_message", return_value=False):
            response = api_client.post(SEND_OTP_URL, {"login_ticket": ticket})
        assert response.status_code == 502
        assert response.data["error"] == "telegram_send_failed"
        assert _real_otp_code(staff_with_credentials.phone_number) is None
        assert not login_ticket_service.was_otp_sent(ticket)

    def test_password_change_invalidates_existing_ticket(self, api_client, staff_with_credentials):
        ticket = self._ticket(api_client, staff_with_credentials)
        staff_with_credentials.set_password("NewPassword123!")
        staff_with_credentials.token_version += 1
        staff_with_credentials.save(update_fields=["password", "token_version"])
        response = api_client.post(TELEGRAM_STATUS_URL, {"login_ticket": ticket})
        assert response.status_code == 401
        assert response.data["error"] == "invalid_or_expired_login_ticket"

    def test_ticket_shortens_to_five_minutes_after_otp_send(self, api_client, staff_with_credentials):
        ticket = self._ticket(api_client, staff_with_credentials)
        before_send = login_ticket_service.redis_client.ttl(login_ticket_service._ticket_key(ticket))
        assert 0 < before_send <= login_ticket_service.TICKET_TTL_SECONDS
        assert api_client.post(SEND_OTP_URL, {"login_ticket": ticket}).status_code == 200
        after_send = login_ticket_service.redis_client.ttl(login_ticket_service._ticket_key(ticket))
        assert 0 < after_send <= login_ticket_service.OTP_TICKET_TTL_SECONDS

    def test_concurrent_ticket_claim_has_one_winner(self, api_client, staff_with_credentials):
        ticket = self._ticket(api_client, staff_with_credentials)
        with ThreadPoolExecutor(max_workers=8) as pool:
            claims = list(pool.map(login_ticket_service.consume_ticket, [ticket] * 8))
        assert claims.count(True) == 1

    def test_no_jwt_if_ticket_consumption_loses_race(self, api_client, staff_with_credentials):
        ticket = self._ticket(api_client, staff_with_credentials)
        assert api_client.post(SEND_OTP_URL, {"login_ticket": ticket}).status_code == 200
        code = _real_otp_code(staff_with_credentials.phone_number)
        with patch("api.v1.accounts.views.admin_login.login_ticket_service.consume_ticket", return_value=False):
            response = api_client.post(
                ADMIN_LOGIN_VERIFY_URL,
                {"login_ticket": ticket, "verification_code": code},
            )
        assert response.status_code == 401
        assert "access" not in response.data

    def test_verify_requires_ticket_and_explicit_send(self, api_client, staff_with_credentials):
        ticket = self._ticket(api_client, staff_with_credentials)
        without_ticket = api_client.post(
            ADMIN_LOGIN_VERIFY_URL,
            {"username": staff_with_credentials.username, "verification_code": "000000"},
        )
        assert without_ticket.status_code == 400
        before_send = api_client.post(
            ADMIN_LOGIN_VERIFY_URL,
            {"login_ticket": ticket, "verification_code": "000000"},
        )
        assert before_send.status_code == 400
        assert before_send.data["error"] == "otp_not_requested"

    def test_send_cooldown_returns_retry_after(self, api_client, staff_with_credentials):
        ticket = self._ticket(api_client, staff_with_credentials)
        assert api_client.post(SEND_OTP_URL, {"login_ticket": ticket}).status_code == 200
        cooldown = api_client.post(SEND_OTP_URL, {"login_ticket": ticket})
        assert cooldown.status_code == 429
        assert cooldown.data["error"] == "cooldown"
        assert cooldown.data["retry_after_seconds"] > 0

    def test_wrong_otp_rejected_generically(self, api_client, staff_with_credentials):
        ticket = self._ticket(api_client, staff_with_credentials)
        api_client.post(SEND_OTP_URL, {"login_ticket": ticket})

        response = api_client.post(
            ADMIN_LOGIN_VERIFY_URL,
            {"login_ticket": ticket, "verification_code": "000000"},
        )

        assert response.status_code == 401
        assert response.data["detail"] == "Verification code incorrect!"

    def test_five_wrong_codes_consume_ticket(self, api_client, staff_with_credentials):
        ticket = self._ticket(api_client, staff_with_credentials)
        api_client.post(SEND_OTP_URL, {"login_ticket": ticket})
        real_code = _real_otp_code(staff_with_credentials.phone_number)
        wrong_code = "000000" if real_code != "000000" else "111111"
        for _ in range(otp.MAX_ATTEMPTS):
            response = api_client.post(
                ADMIN_LOGIN_VERIFY_URL,
                {"login_ticket": ticket, "verification_code": wrong_code},
            )
            assert response.status_code == 401
        expired = api_client.post(TELEGRAM_STATUS_URL, {"login_ticket": ticket})
        assert expired.status_code == 401
        assert expired.data["error"] == "invalid_or_expired_login_ticket"

    def test_correct_otp_issues_tokens_and_clears_throttle(self, api_client, staff_with_credentials):
        ticket = self._ticket(api_client, staff_with_credentials)
        api_client.post(SEND_OTP_URL, {"login_ticket": ticket})
        code = _real_otp_code(staff_with_credentials.phone_number)
        assert code is not None  # sanity check: step 1 actually stored a code

        response = api_client.post(
            ADMIN_LOGIN_VERIFY_URL,
            {"login_ticket": ticket, "verification_code": code},
        )

        assert response.status_code == 200
        assert set(response.data.keys()) == {"access", "refresh"}

        # Verify custom JWT claims in the issued access token
        from rest_framework_simplejwt.tokens import AccessToken
        token = AccessToken(response.data["access"])
        assert token["role"] == "staff"
        assert "tenant_id" not in token

        locked, _ = login_throttle.is_locked(staff_with_credentials.username)
        assert locked is False
        reused = api_client.post(ADMIN_LOGIN_VERIFY_URL, {"login_ticket": ticket, "verification_code": code})
        assert reused.status_code == 401
        assert reused.data["error"] == "invalid_or_expired_login_ticket"


class TestLoginThrottleStateMachine:
    """Whitebox tests against login_throttle.py directly — same style as
    test_otp_services.py. Lock expiry is simulated by deleting the Redis
    lock key directly instead of sleeping for real (60s/1hr/1day would
    make the suite unusably slow); from register_failure()'s point of
    view, an expired key and a deleted key are indistinguishable."""

    USERNAME = "throttletarget"

    def _expire_lock(self):
        login_throttle.redis_client.delete(login_throttle._lock_key(self.USERNAME))

    def _exhaust_one_full_cycle(self):
        """5 -> 3 -> 1 failures, expiring the lock between each stage —
        one complete cycle ending in a 1-day lock (one strike)."""
        for _ in range(5):
            login_throttle.register_failure(self.USERNAME)
        self._expire_lock()
        for _ in range(3):
            login_throttle.register_failure(self.USERNAME)
        self._expire_lock()
        login_throttle.register_failure(self.USERNAME)
        self._expire_lock()

    def test_stage_one_locks_after_five_failures(self):
        for _ in range(5):
            login_throttle.register_failure(self.USERNAME)

        locked, remaining = login_throttle.is_locked(self.USERNAME)
        assert locked is True
        assert 0 < remaining <= 60

    def test_stage_two_locks_after_three_more_failures(self):
        for _ in range(5):
            login_throttle.register_failure(self.USERNAME)
        self._expire_lock()

        for _ in range(3):
            login_throttle.register_failure(self.USERNAME)

        locked, remaining = login_throttle.is_locked(self.USERNAME)
        assert locked is True
        assert 3000 < remaining <= 3600

    def test_stage_three_locks_after_one_more_failure_and_registers_a_strike(self):
        for _ in range(5):
            login_throttle.register_failure(self.USERNAME)
        self._expire_lock()
        for _ in range(3):
            login_throttle.register_failure(self.USERNAME)
        self._expire_lock()

        login_throttle.register_failure(self.USERNAME)

        locked, remaining = login_throttle.is_locked(self.USERNAME)
        assert locked is True
        assert 86000 < remaining <= 86400
        assert login_throttle.redis_client.get(login_throttle._strikes_key(self.USERNAME)) == "1"

    def test_third_consecutive_strike_bans_permanently_and_clears_the_counter(self):
        user = StaffFactory(username=self.USERNAME)

        for _ in range(3):
            self._exhaust_one_full_cycle()

        user.refresh_from_db()
        assert user.is_active is False
        assert login_throttle.redis_client.get(login_throttle._strikes_key(self.USERNAME)) is None


class TestBannedAccountLogin:
    def test_banned_user_blocked_even_with_correct_password(self, api_client, staff_with_credentials):
        staff_with_credentials.is_active = False
        staff_with_credentials.save(update_fields=["is_active"])

        response = api_client.post(
            ADMIN_LOGIN_URL,
            {"username": staff_with_credentials.username, "password": PASSWORD},
        )

        assert response.status_code == 429
        assert "blocked" in response.data["detail"]

