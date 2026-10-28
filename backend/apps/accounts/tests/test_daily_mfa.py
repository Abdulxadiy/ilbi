"""The remembered second factor belongs to this browser and never slides on login/refresh."""

from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.services import daily_mfa, login_throttle, otp_services
from apps.tg_bot.identity import current_bot_id
from apps.tg_bot.models import TelegramContact
from tests.factories import StaffFactory

pytestmark = pytest.mark.django_db
LOGIN = "/api/v1/auth/admin-login/"
PASSWORD = "Synthetic-daily-password-123"


@pytest.fixture
def daily_browser(settings):
    settings.TELEGRAM_BOT_TOKEN = "123456789:daily-mfa-synthetic"
    cache.clear()
    login_throttle.redis_client.flushdb()
    user = StaffFactory(password=PASSWORD)
    TelegramContact.objects.create(phone_number=user.phone_number, chat_id="12345", bot_id=current_bot_id())
    client = APIClient()
    with patch("api.v1.accounts.views.misc.send_telegram_message", return_value=True) as send:
        first = client.post(LOGIN, {"username": user.username, "password": PASSWORD}).data
        assert client.post(LOGIN + "send-otp/", {"login_ticket": first["login_ticket"]}).status_code == 200
        code = otp_services.redis_client.get(otp_services._otp_key(user.phone_number))
        verified = client.post(
            LOGIN + "verify-otp/", {"login_ticket": first["login_ticket"], "verification_code": code}
        )
        assert verified.status_code == 200
        yield client, user, verified, send
    login_throttle.redis_client.flushdb()


def test_second_factor_cookie_is_secure_and_password_login_reuses_fixed_deadline(daily_browser, monkeypatch):
    client, user, initial, send = daily_browser
    first = AccessToken(initial.data["access"])
    cookie = initial.cookies[daily_mfa.cookie_name(user)]
    assert cookie["httponly"] and cookie["secure"] and cookie["samesite"] == "Lax"
    assert cookie["max-age"] == 86400
    original = timezone.now()
    monkeypatch.setattr(daily_mfa.timezone, "now", lambda: original + timedelta(hours=23))
    again = client.post(LOGIN, {"username": user.username, "password": PASSWORD})
    assert again.status_code == 200 and again.data["password_login"] is True
    current = AccessToken(again.data["access"])
    assert current["mfa_verified_at"] == first["mfa_verified_at"]
    assert current["mfa_expires_at"] == first["mfa_expires_at"]
    assert not again.cookies  # A password login never renews the trust cookie.
    send.assert_called_once()


def test_exact_24_hour_boundary_requires_otp_and_rejects_existing_session_and_refresh(daily_browser, monkeypatch):
    client, user, initial, _ = daily_browser
    expiry = AccessToken(initial.data["access"])["mfa_expires_at"]
    now = timezone.datetime.fromtimestamp(expiry, tz=timezone.get_current_timezone())
    monkeypatch.setattr(daily_mfa.timezone, "now", lambda: now - timedelta(microseconds=1))
    before = client.post(LOGIN, {"username": user.username, "password": PASSWORD})
    assert before.data["password_login"] is True
    monkeypatch.setattr(daily_mfa.timezone, "now", lambda: now)
    after = client.post(LOGIN, {"username": user.username, "password": PASSWORD})
    assert "login_ticket" in after.data and "access" not in after.data
    client.credentials(HTTP_AUTHORIZATION="Bearer " + initial.data["access"])
    assert client.get("/api/v1/auth/me/").status_code == 401
    client.credentials()
    assert client.post("/api/v1/auth/token/refresh/", {"refresh": initial.data["refresh"]}).status_code == 401


def test_token_refresh_keeps_original_second_factor_deadline(daily_browser):
    client, _, initial, _ = daily_browser
    original = AccessToken(initial.data["access"])
    refreshed = client.post("/api/v1/auth/token/refresh/", {"refresh": initial.data["refresh"]})
    assert refreshed.status_code == 200
    current = AccessToken(refreshed.data["access"])
    assert current["mfa_expires_at"] == original["mfa_expires_at"]


def test_another_browser_account_or_changed_password_cannot_reuse_trust(daily_browser):
    client, user, _, _ = daily_browser
    fresh = APIClient().post(LOGIN, {"username": user.username, "password": PASSWORD})
    assert "login_ticket" in fresh.data and "access" not in fresh.data
    other = StaffFactory(password=PASSWORD)
    assert "login_ticket" in client.post(LOGIN, {"username": other.username, "password": PASSWORD}).data
    assert client.post(LOGIN, {"username": user.username, "password": "wrong"}).status_code == 401
    user.token_version += 1
    user.save(update_fields=["token_version"])
    assert "login_ticket" in client.post(LOGIN, {"username": user.username, "password": PASSWORD}).data


def test_tampered_cookie_cannot_skip_otp(daily_browser):
    client, user, _, _ = daily_browser
    client.cookies[daily_mfa.cookie_name(user)] = "forged-second-factor"
    result = client.post(LOGIN, {"username": user.username, "password": PASSWORD})
    assert "login_ticket" in result.data and "access" not in result.data


def test_desktop_proof_requires_real_second_factor_and_keeps_original_time(daily_browser):
    client, user, initial, _ = daily_browser
    client.credentials(HTTP_AUTHORIZATION="Bearer " + initial.data["access"])
    installation = str(uuid4())
    response = client.post(
        "/api/v1/sync/credentials/",
        {"password": PASSWORD, "device_id": installation, "register_id": "cashier-register"},
    )
    assert response.status_code == 200
    from apps.desktop_sync.grants import verify_grant

    proof = verify_grant(response.data["mfa_proof"], response.data["grant_key"])
    assert proof["device"] == installation and proof["register"] == "cashier-register" and proof["user"] == user.pk
    assert proof["expires"] == AccessToken(initial.data["access"])["mfa_expires_at"]
    # A background synchronization token or old JWT cannot mint a daily proof.
    from api.v1.accounts.views.misc import issue_tokens

    client.credentials(HTTP_AUTHORIZATION="Bearer " + issue_tokens(user)["access"])
    assert (
        client.post("/api/v1/sync/credentials/", {"password": PASSWORD, "device_id": installation}).status_code == 401
    )
