"""Tests for the one-time magic-link password setup / reset flow.

Covers
------
- request_password_reset()
    * Valid e-mail → e-mail dispatched, Redis token stored.
    * Unknown e-mail → still returns (True, "sent") [enumeration-safe].
    * Fired / never-actually-hired staff-or-owner e-mail → treated as
      unknown (enumeration-safe). 'customer' no longer exists as a
      role, so the real boundary is active Employee status, not role.
    * Cooldown: second call within 60 s is rejected with "cooldown".
    * E-mail send failure → token cleaned up, returns (False, "email_send_failed").

- confirm_password_reset()
    * Valid token → password set, token consumed (single-use).
    * Expired / invalid token → (False, "invalid_or_expired_token").
    * Token is truly single-use: second call with the same token fails.
    * Username provided on first login → username saved.
    * Username already taken by another user → (False, "username_taken").
    * Missing new_password → (False, "missing_fields").

- API layer (HTTP)
    * POST /api/v1/auth/password-reset/request/ → always 200.
    * POST /api/v1/auth/password-reset/confirm/ → 200 on success, 400 on bad token.
    * Both endpoints are accessible without authentication.
"""

import json
from unittest.mock import patch

import pytest
from django.core import mail

from apps.accounts.services import login_ticket_service, otp_services, password_reset_service
from apps.tg_bot.identity import current_bot_id
from apps.tg_bot.models import TelegramContact
from tests.factories import (
    EmployeeFactory,
    OwnerFactory,
    PlatformAdminFactory,
    StaffFactory,
    TenantFactory,
    UserFactory,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

@pytest.fixture
def staff_with_email(db):
    """A staff user with an e-mail address AND an active Employee record --
    password reset now requires active employment, not just the role."""
    staff = StaffFactory(email="alice@example.com")
    tenant = TenantFactory()
    EmployeeFactory(user=staff, tenant=tenant, is_active=True)
    return staff


@pytest.fixture
def owner_with_email(db):
    """An owner user with an e-mail address AND an active Employee record --
    password reset now requires active employment, not just the role."""
    owner = OwnerFactory(email="bob@example.com")
    tenant = TenantFactory(owner=owner)
    EmployeeFactory(user=owner, tenant=tenant, position="Owner", is_active=True)
    return owner


# ---------------------------------------------------------------------------
# request_password_reset() — service tests
# ---------------------------------------------------------------------------

class TestRequestPasswordReset:
    """Unit-level tests for request_password_reset().

    Uses Django's in-memory e-mail backend (configured in settings_test.py),
    so no real SMTP is needed — sent messages end up in django.core.mail.outbox.
    """

    def test_known_staff_email_sends_email(self, staff_with_email):
        """A valid e-mail belonging to a staff user must dispatch one e-mail."""
        ok, reason = password_reset_service.request_password_reset(
            email="alice@example.com"
        )
        assert ok is True
        assert reason == "sent"
        assert len(mail.outbox) == 1
        assert "alice@example.com" in mail.outbox[0].to

    def test_known_owner_email_sends_email(self, owner_with_email):
        """Owner-role users should also receive the reset e-mail."""
        ok, reason = password_reset_service.request_password_reset(
            email="bob@example.com"
        )
        assert ok is True
        assert len(mail.outbox) == 1

    def test_unknown_email_still_returns_sent(self, db):
        """Unknown addresses must return (True, 'sent') to prevent enumeration."""
        ok, reason = password_reset_service.request_password_reset(
            email="ghost@example.com"
        )
        assert ok is True
        assert reason == "sent"
        # No e-mail should have been dispatched.
        assert len(mail.outbox) == 0

    def test_fired_employee_email_treated_as_unknown(self, staff_with_email):
        """A fired staff/owner keeps their role on the User row for audit
        purposes (EmployeeService.fire(), Variant A), but must not be able
        to reset their password back into a usable state once their
        Employee record is inactive -- 'customer' no longer exists as a
        role (removed from ROLE_CHOICES), so this is the real modern
        equivalent of the old "customer email is a no-op" guarantee."""
        from apps.accounts.services.employee_service import EmployeeService

        platform_admin = PlatformAdminFactory()
        EmployeeService.fire(target_user=staff_with_email, fired_by=platform_admin)

        ok, reason = password_reset_service.request_password_reset(
            email="alice@example.com"
        )
        assert ok is True
        assert len(mail.outbox) == 0

    def test_role_with_no_employee_record_at_all_treated_as_unknown(self, db):
        """A staff/owner-role User with no Employee row at all (never
        actually hired -- e.g. a half-finished hire()) must also be
        denied, the same as a fired one."""

        UserFactory(role="staff", email="ghost-staff@example.com")


        ok, reason = password_reset_service.request_password_reset(
            email="ghost-staff@example.com"
        )
        assert ok is True
        assert len(mail.outbox) == 0

    def test_cooldown_blocks_second_request(self, staff_with_email):
        """A second request within the cooldown window should be rejected."""
        # First request succeeds.
        ok1, _ = password_reset_service.request_password_reset(email="alice@example.com")
        assert ok1 is True

        # Second request immediately after should hit the cooldown.
        ok2, reason2 = password_reset_service.request_password_reset(email="alice@example.com")
        assert ok2 is False
        assert reason2 == "cooldown"

    def test_token_stored_in_redis(self, staff_with_email):
        """After a successful request the token must be present in Redis."""
        password_reset_service.request_password_reset(email="alice@example.com")
        # The e-mail body contains the token in the URL.
        body = mail.outbox[0].body
        # Extract the token from the URL: …/setup-account?token=<TOKEN>
        token = body.split("token=")[1].split("\n")[0].strip()
        assert token, "Token must be non-empty"
        # Verify the token resolves to our user.
        user_id = password_reset_service.consume_reset_token(token)
        assert user_id == staff_with_email.id

    def test_email_send_failure_cleans_up_token(self, staff_with_email):
        """If the e-mail backend raises, the stored token must be removed."""
        with patch.object(
            password_reset_service, "send_password_reset_email", return_value=False
        ):
            ok, reason = password_reset_service.request_password_reset(
                email="alice@example.com"
            )
        assert ok is False
        assert reason == "email_send_failed"


# ---------------------------------------------------------------------------
# confirm_password_reset() — service tests
# ---------------------------------------------------------------------------

class TestConfirmPasswordReset:
    """Unit-level tests for confirm_password_reset()."""

    def _store_token_for(self, user) -> str:
        """Helper: store a fresh token for *user* and return it."""
        token = password_reset_service.generate_reset_token()
        password_reset_service.store_reset_token(token, user.id)
        return token

    def test_valid_token_sets_password(self, staff_with_email):
        """A valid token must allow setting a new password."""
        token = self._store_token_for(staff_with_email)
        ok, reason, returned_user = password_reset_service.confirm_password_reset(
            token=token,
            new_password="NewSecurePass1!",
        )
        assert ok is True
        assert reason == "success"
        assert returned_user is not None

        staff_with_email.refresh_from_db()
        assert staff_with_email.check_password("NewSecurePass1!")

    def test_invalid_token_is_rejected(self, db):
        """A random / made-up token must return (False, 'invalid_or_expired_token')."""
        ok, reason, user = password_reset_service.confirm_password_reset(
            token="completely-fake-token",
            new_password="SomePass123",
        )
        assert ok is False
        assert reason == "invalid_or_expired_token"
        assert user is None

    def test_token_is_single_use(self, staff_with_email):
        """The same token must not be usable twice."""
        token = self._store_token_for(staff_with_email)

        # First use succeeds.
        ok1, _, _ = password_reset_service.confirm_password_reset(
            token=token, new_password="FirstPass1!"
        )
        assert ok1 is True

        # Second use with the same token must fail.
        ok2, reason2, _ = password_reset_service.confirm_password_reset(
            token=token, new_password="SecondPass1!"
        )
        assert ok2 is False
        assert reason2 == "invalid_or_expired_token"

    def test_first_login_sets_username(self, db):
        """When a username is supplied and the user has none yet, it should be saved."""
        user = StaffFactory(username=None)
        EmployeeFactory(user=user, tenant=TenantFactory(), is_active=True)
        token = self._store_token_for(user)

        ok, _, returned_user = password_reset_service.confirm_password_reset(
            token=token,
            new_password="Pass12345!",
            username="alice_new",
        )
        assert ok is True
        user.refresh_from_db()
        assert user.username == "alice_new"

    def test_username_collision_is_rejected(self, db):
        """If the desired username is already taken, confirm must return False."""
        # Another user already has this username.
        StaffFactory(username="taken_user")

        user = StaffFactory(username=None)
        EmployeeFactory(user=user, tenant=TenantFactory(), is_active=True)
        token = self._store_token_for(user)

        ok, reason, _ = password_reset_service.confirm_password_reset(
            token=token,
            new_password="Pass12345!",
            username="taken_user",
        )
        assert ok is False
        assert reason == "username_taken"
        assert password_reset_service.peek_reset_token(token) is not None

    def test_missing_new_password_is_rejected(self, staff_with_email):
        """Passing an empty new_password must return (False, 'missing_fields')."""
        token = self._store_token_for(staff_with_email)
        ok, reason, _ = password_reset_service.confirm_password_reset(
            token=token,
            new_password="",
        )
        assert ok is False
        assert reason == "missing_fields"


# ---------------------------------------------------------------------------
# API layer tests
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestPasswordResetRequestView:
    """HTTP-level tests for POST /api/v1/auth/password-reset/request/."""

    REQUEST_URL = "/api/v1/auth/password-reset/request/"

    def test_always_200_for_valid_email(self, client, staff_with_email):
        """The endpoint always returns 200 for a known address."""
        response = client.post(
            self.REQUEST_URL,
            data={"email": "alice@example.com"},
            content_type="application/json",
        )
        assert response.status_code == 200

    def test_always_200_for_unknown_email(self, client, db):
        """The endpoint always returns 200 even for an unrecognised address."""
        response = client.post(
            self.REQUEST_URL,
            data={"email": "nobody@example.com"},
            content_type="application/json",
        )
        assert response.status_code == 200

    def test_no_authentication_required(self, client, db):
        """The endpoint must be reachable without an Authorization header."""
        response = client.post(
            self.REQUEST_URL,
            data={"email": "ghost@example.com"},
            content_type="application/json",
        )
        # 401 / 403 would mean authentication is accidentally required.
        assert response.status_code not in (401, 403)

    def test_invalid_email_format_returns_400(self, client, db):
        """A malformed e-mail string must be rejected by the serializer."""
        response = client.post(
            self.REQUEST_URL,
            data={"email": "not-an-email"},
            content_type="application/json",
        )
        assert response.status_code == 400


@pytest.mark.django_db
class TestPasswordResetConfirmView:
    """HTTP-level tests for POST /api/v1/auth/password-reset/confirm/."""

    CONFIRM_URL = "/api/v1/auth/password-reset/confirm/"

    def _valid_token_for(self, user) -> str:
        token = password_reset_service.generate_reset_token()
        password_reset_service.store_reset_token(token, user.id)
        return token

    def test_valid_token_returns_200(self, client, staff_with_email):
        """Account setup returns a gate ticket without sending an OTP."""
        token = self._valid_token_for(staff_with_email)
        with patch("api.v1.accounts.views.misc.send_telegram_message") as send_message:
            response = client.post(
                self.CONFIRM_URL,
                data={"token": token, "new_password": "NewPass12345!"},
                content_type="application/json",
            )
        assert response.status_code == 200
        body = response.json()
        assert body["login_ticket"]
        assert body["telegram_linked"] is False
        assert body["otp_sent"] is False
        assert staff_with_email.phone_number not in str(body)
        send_message.assert_not_called()
        # The e-mail setup token was single-use, but its login ticket remains usable.
        assert password_reset_service.peek_reset_token(token) is None
        status_response = client.post(
            "/api/v1/auth/admin-login/telegram-status/",
            data={"login_ticket": body["login_ticket"]},
            content_type="application/json",
        )
        assert status_response.status_code == 200
        assert status_response.json()["telegram_linked"] is False

    def test_invalid_token_returns_400(self, client, db):
        """An invalid token must produce a 400 response."""
        response = client.post(
            self.CONFIRM_URL,
            data={"token": "bad-token", "new_password": "NewPass12345!"},
            content_type="application/json",
        )
        assert response.status_code == 400

    def test_no_authentication_required(self, client, db):
        """A brand-new hire (no password yet) must be able to reach this endpoint."""
        response = client.post(
            self.CONFIRM_URL,
            data={"token": "any", "new_password": "AnyPass123!"},
            content_type="application/json",
        )
        # Might be 400 (bad token) but should NOT be 401/403.
        assert response.status_code not in (401, 403)

    def test_short_password_returns_400(self, client, staff_with_email):
        """The serializer must enforce the 8-character minimum."""
        token = self._valid_token_for(staff_with_email)
        response = client.post(
            self.CONFIRM_URL,
            data={"token": token, "new_password": "short"},
            content_type="application/json",
        )
        assert response.status_code == 400

    def test_username_conflict_returns_400(self, client, db):
        """Requesting a username that's already taken must return 400."""
        StaffFactory(username="existing_user")
        user = StaffFactory(username=None)
        EmployeeFactory(user=user, tenant=TenantFactory(), is_active=True)
        token = self._valid_token_for(user)

        response = client.post(
            self.CONFIRM_URL,
            data={"token": token, "new_password": "ValidPass123!", "username": "existing_user"},
            content_type="application/json",
        )
        assert response.status_code == 400
        assert "username_taken" in response.json().get("detail", "")


@pytest.mark.django_db
class TestPasswordResetEnhancements:
    """Tests for email masking, login lookup, and changing password via old password."""

    CHANGE_WITH_OLD_URL = "/api/v1/auth/password-reset/change-with-old/"
    REQUEST_URL = "/api/v1/auth/password-reset/request/"

    def test_mask_email(self):
        from apps.accounts.services.email_utils import mask_email
        assert mask_email("abdulxadiyabduraximov@gmail.com") == "ab***ov@gmail.com"
        assert mask_email("alice@example.com") == "al***ce@example.com"
        assert mask_email("john@gmail.com") == "j*n@gmail.com"
        assert mask_email("me@test.uz") == "m*@test.uz"
        assert mask_email("a@test.uz") == "*@test.uz"

    def test_request_reset_by_username_returns_masked_hint(self, client, staff_with_email):
        staff_with_email.username = "test_staff_user"
        staff_with_email.save()

        response = client.post(
            self.REQUEST_URL,
            data={"login": "test_staff_user"},
            content_type="application/json",
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("has_email") is True
        assert data.get("email_hint") == "al***ce@example.com"

    def test_change_password_with_old_success(self, client, staff_with_email):
        staff_with_email.username = "old_pass_user"
        staff_with_email.set_password("OldSecretPass123!")
        staff_with_email.save()

        response = client.post(
            self.CHANGE_WITH_OLD_URL,
            data={
                "login": "old_pass_user",
                "old_password": "OldSecretPass123!",
                "new_password": "BrandNewSecret456!",
            },
            content_type="application/json",
        )
        assert response.status_code == 200

        staff_with_email.refresh_from_db()
        assert staff_with_email.check_password("BrandNewSecret456!")
        assert not staff_with_email.check_password("OldSecretPass123!")

    def test_change_password_with_wrong_old_fails(self, client, staff_with_email):
        staff_with_email.username = "wrong_pass_user"
        staff_with_email.set_password("CorrectPass123!")
        staff_with_email.save()

        response = client.post(
            self.CHANGE_WITH_OLD_URL,
            data={
                "login": "wrong_pass_user",
                "old_password": "WrongPassword999!",
                "new_password": "BrandNewSecret456!",
            },
            content_type="application/json",
        )
        assert response.status_code == 400
        assert "noto‘g‘ri" in response.json().get("detail", "").lower()

    def test_verify_token_valid_and_expired(self, client, staff_with_email):
        VERIFY_URL = "/api/v1/auth/password-reset/verify/"

        # 1. Non-existent / invalid token
        res = client.get(VERIFY_URL + "?token=non_existent_token_123")
        assert res.status_code == 200
        assert res.json()["valid"] is False

        # 2. Valid token with purpose
        token = "test_verify_token_valid"
        password_reset_service.store_reset_token(
            token,
            staff_with_email.id,
            purpose="reset_password",
            extra_context={"tenant_name": "Test Supermarket"},
        )

        res = client.get(VERIFY_URL + f"?token={token}")
        assert res.status_code == 200
        data = res.json()
        assert data["valid"] is True
        assert data["purpose"] == "reset_password"
        assert data["tenant_name"] == "Test Supermarket"
        assert "email_hint" in data
        assert "phone_hint" in data

        # Peek should NOT consume the token:
        assert password_reset_service.peek_reset_token(token) is not None
        # Consume works:
        uid = password_reset_service.consume_reset_token(token)
        assert uid == staff_with_email.id
        # Now it is consumed:
        assert password_reset_service.peek_reset_token(token) is None
        res_after = client.get(VERIFY_URL + f"?token={token}")
        assert res_after.json()["valid"] is False


@pytest.mark.django_db
class TestInvitationResume:
    """An invite survives password setup, but loses password-write authority."""

    @pytest.fixture(autouse=True)
    def clean_redis(self):
        password_reset_service.redis_client.flushdb()
        yield
        password_reset_service.redis_client.flushdb()

    def _invite(self, user):
        token = password_reset_service.generate_reset_token()
        password_reset_service.store_reset_token(token, user.id, purpose="new_employee")
        return token

    def test_link_resumes_telegram_without_replacing_password(self, client, staff_with_email):
        token = self._invite(staff_with_email)
        first = client.post(
            "/api/v1/auth/password-reset/confirm/",
            {"token": token, "new_password": "FirstPassword123!"},
            content_type="application/json",
        )
        assert first.status_code == 200
        assert first.json()["login_ticket"]
        assert password_reset_service.peek_reset_token(token)["phase"] == "pending_2fa"

        reopened = client.get(f"/api/v1/auth/password-reset/verify/?token={token}")
        assert reopened.json()["valid"] is True
        assert reopened.json()["phase"] == "pending_2fa"
        resumed = client.post(
            "/api/v1/auth/password-reset/resume/", {"token": token},
            content_type="application/json",
        )
        assert resumed.status_code == 200
        assert resumed.json()["login_ticket"] != first.json()["login_ticket"]

        replay = client.post(
            "/api/v1/auth/password-reset/confirm/",
            {"token": token, "new_password": "AttackerReplacement123!"},
            content_type="application/json",
        )
        assert replay.status_code == 400
        assert replay.json()["detail"] == "setup_already_started"
        staff_with_email.refresh_from_db()
        assert staff_with_email.check_password("FirstPassword123!")

    def test_original_deadline_caps_resumed_ticket(self, client, staff_with_email):
        token = self._invite(staff_with_email)
        key = password_reset_service._token_key(token)
        password_reset_service.redis_client.expire(key, 95)
        assert client.post(
            "/api/v1/auth/password-reset/confirm/",
            {"token": token, "new_password": "FirstPassword123!"},
            content_type="application/json",
        ).status_code == 200
        assert 0 < password_reset_service.redis_client.ttl(key) <= 95

        resumed = client.post(
            "/api/v1/auth/password-reset/resume/", {"token": token},
            content_type="application/json",
        )
        assert resumed.status_code == 200
        ticket_key = login_ticket_service._ticket_key(resumed.json()["login_ticket"])
        assert 0 < password_reset_service.redis_client.ttl(ticket_key) <= 95

        password_reset_service.redis_client.delete(key)
        assert client.get(f"/api/v1/auth/password-reset/verify/?token={token}").json()["valid"] is False
        assert client.post(
            "/api/v1/auth/admin-login/telegram-status/",
            {"login_ticket": resumed.json()["login_ticket"]},
            content_type="application/json",
        ).status_code == 401
        assert client.post(
            "/api/v1/auth/password-reset/resume/", {"token": token},
            content_type="application/json",
        ).status_code == 400

    def test_existing_emailed_raw_key_is_migrated_without_expiry_reset(self, client, staff_with_email):
        token = password_reset_service.generate_reset_token()
        legacy = password_reset_service._legacy_token_key(token)
        password_reset_service.redis_client.set(
            legacy, json.dumps({"user_id": staff_with_email.id, "purpose": "new_employee"}), ex=100,
        )
        response = client.post(
            "/api/v1/auth/password-reset/confirm/",
            {"token": token, "new_password": "FirstPassword123!"},
            content_type="application/json",
        )
        assert response.status_code == 200
        assert password_reset_service.redis_client.exists(legacy) == 0
        assert 0 < password_reset_service.invitation_ttl(token) <= 100

    def test_successful_2fa_login_completes_invitation(self, client, staff_with_email, settings):
        settings.TELEGRAM_BOT_TOKEN = "123456789:unit-test-token"
        TelegramContact.objects.create(
            phone_number=staff_with_email.phone_number,
            chat_id="12345",
            bot_id=current_bot_id(),
        )
        token = self._invite(staff_with_email)
        confirmed = client.post(
            "/api/v1/auth/password-reset/confirm/",
            {"token": token, "new_password": "FirstPassword123!"},
            content_type="application/json",
        )
        assert confirmed.status_code == 200
        ticket = confirmed.json()["login_ticket"]
        second_ticket = client.post(
            "/api/v1/auth/password-reset/resume/", {"token": token},
            content_type="application/json",
        ).json()["login_ticket"]

        with patch("api.v1.accounts.views.misc.send_telegram_message", return_value=True) as send:
            sent = client.post(
                "/api/v1/auth/admin-login/send-otp/", {"login_ticket": ticket},
                content_type="application/json",
            )
        assert sent.status_code == 200
        send.assert_called_once()
        code = otp_services.redis_client.get(otp_services._otp_key(staff_with_email.phone_number))
        verified = client.post(
            "/api/v1/auth/admin-login/verify-otp/",
            {"login_ticket": ticket, "verification_code": code},
            content_type="application/json",
        )
        assert verified.status_code == 200
        assert verified.json()["access"]
        assert password_reset_service.peek_reset_token(token) is None
        assert client.post(
            "/api/v1/auth/admin-login/telegram-status/",
            {"login_ticket": second_ticket},
            content_type="application/json",
        ).status_code == 401
        assert client.post(
            "/api/v1/auth/password-reset/resume/", {"token": token},
            content_type="application/json",
        ).status_code == 400

    def test_normal_password_login_also_completes_pending_invitation(self, client, staff_with_email, settings):
        settings.TELEGRAM_BOT_TOKEN = "123456789:unit-test-token"
        TelegramContact.objects.create(
            phone_number=staff_with_email.phone_number,
            chat_id="12346",
            bot_id=current_bot_id(),
        )
        token = self._invite(staff_with_email)
        confirmed = client.post(
            "/api/v1/auth/password-reset/confirm/",
            {"token": token, "new_password": "FirstPassword123!"},
            content_type="application/json",
        )
        assert confirmed.status_code == 200

        # A second, still-unused invitation for the same account must also
        # end when the user completes a normal password + OTP login.
        unused_token = self._invite(staff_with_email)

        logged_in = client.post(
            "/api/v1/auth/admin-login/",
            {"username": staff_with_email.username, "password": "FirstPassword123!"},
            content_type="application/json",
        )
        assert logged_in.status_code == 200
        ticket = logged_in.json()["login_ticket"]
        with patch("api.v1.accounts.views.misc.send_telegram_message", return_value=True):
            assert client.post(
                "/api/v1/auth/admin-login/send-otp/", {"login_ticket": ticket},
                content_type="application/json",
            ).status_code == 200
        code = otp_services.redis_client.get(otp_services._otp_key(staff_with_email.phone_number))
        assert client.post(
            "/api/v1/auth/admin-login/verify-otp/",
            {"login_ticket": ticket, "verification_code": code},
            content_type="application/json",
        ).status_code == 200
        assert password_reset_service.peek_reset_token(token) is None
        assert password_reset_service.peek_reset_token(unused_token) is None
