import json
from datetime import timedelta
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from django.core.cache import cache
from django.test import RequestFactory, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.desktop_sync.account_access import save_actor
from apps.desktop_sync.authentication import DesktopJWTAuthentication
from apps.desktop_sync.desktop_api import endpoint
from apps.desktop_sync.grants import credential_ticket, issue_grant, issue_mfa_proof, public_key, verify_grant
from apps.desktop_sync.local import get_state, set_state
from apps.desktop_sync.models import SyncDevice
from apps.desktop_sync.security import DesktopLocked, lock, password_value, pending_accounts, remember_pending
from apps.desktop_sync.server_policy import OFFICIAL_SERVER

pytestmark = pytest.mark.django_db
PASSWORD = "synthetic-normal-account-password"


def test_daily_proof_expiry_and_cross_register_replay_cannot_unlock(owner, secured, monkeypatch):
    from apps.desktop_sync import security

    device, _ = secured
    actor = get_state("actors")[str(owner.pk)]
    proof = security.assert_mfa(owner, get_state("device"), actor, "primary")
    monkeypatch.setattr(security, "trusted_now", lambda: proof["expires"] - .001)
    assert security.assert_mfa(owner, get_state("device"), actor, "primary")["expires"] == proof["expires"]
    with pytest.raises(DesktopLocked):
        security.assert_mfa(owner, get_state("device"), actor, "another-register")
    monkeypatch.setattr(security, "trusted_now", lambda: proof["expires"])
    response = endpoint(RequestFactory().post("/desktop/unlock/", {"username": owner.username, "password": PASSWORD}, content_type="application/json"), "unlock/")
    assert response.status_code == 423
    assert "24 soat" in json.loads(response.content)["detail"]
    assert get_state("actors")[str(owner.pk)]["mfa_proofs"]["primary"] == actor["mfa_proofs"]["primary"]


def test_local_signature_cannot_extend_cloud_second_factor(owner, secured):
    from apps.desktop_sync.security import assert_mfa, seal_actor

    actor = get_state("actors")[str(owner.pk)]
    actor["mfa_proofs"]["primary"] += "tampered"
    actor = seal_actor(actor)  # Knowing the local MAC key cannot forge the server signature.
    with pytest.raises(DesktopLocked):
        assert_mfa(owner, get_state("device"), actor, "primary")


def test_native_daily_cookie_stays_encrypted_and_separate_for_each_register(owner, secured, monkeypatch):
    import requests

    from apps.desktop_sync.middleware import DesktopMiddleware
    from apps.desktop_sync.transport import Vault

    remote = requests.Response()
    remote.status_code = 200
    remote._content = b'{"access":"synthetic-cloud-access","refresh":"synthetic-cloud-refresh"}'
    remote.cookies.set("ilbi_mfa_1", "synthetic-private-second-factor")
    calls = []

    def send(*args, **kwargs):
        calls.append(kwargs)
        return remote

    monkeypatch.setattr(requests, "request", send)
    middleware = DesktopMiddleware(lambda request: None)
    request = RequestFactory().post("/api/v1/auth/admin-login/verify-otp/", {}, content_type="application/json", HTTP_X_ILBI_REGISTER_ID="register-one")
    response = middleware.proxy(request, "auth/admin-login/verify-otp/")
    assert response["X-ILBI-Account-Verified"] == "1" and "Set-Cookie" not in response
    assert b"synthetic-private-second-factor" not in Vault().path.read_bytes()
    middleware.proxy(request, "auth/admin-login/")
    assert calls[-1]["cookies"] == {"ilbi_mfa_1": "synthetic-private-second-factor"}
    request = RequestFactory().post("/api/v1/auth/admin-login/", {}, content_type="application/json", HTTP_X_ILBI_REGISTER_ID="register-two")
    middleware.proxy(request, "auth/admin-login/")
    assert calls[-1]["cookies"] == {}
    remote._content = b'{"login_ticket":"only-a-password-proof"}'
    assert "X-ILBI-Account-Verified" not in middleware.proxy(request, "auth/admin-login/")


@pytest.fixture
def secured(owner, tenant, tmp_path, monkeypatch):
    from apps.desktop_sync import security

    monkeypatch.setenv("ILBI_DESKTOP_VAULT_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(security, "clock_anchor", None)
    pending_accounts.clear()
    device = SyncDevice.objects.create(
        id=uuid4(),
        user_id=owner.pk,
        tenant_id=tenant.pk,
        token_version=owner.token_version,
        lease_until=timezone.now() + timedelta(days=7),
        name="QA",
    )
    with override_settings(DESKTOP_DATA_DIR=tmp_path, DESKTOP_SERVER=OFFICIAL_SERVER):
        set_state(
            "device",
            {
                "device_id": str(device.pk),
                "tenant_id": tenant.pk,
                "user_id": owner.pk,
                "lease_until": device.lease_until.isoformat(),
            },
        )
        remember_pending(owner.pk, owner.username, PASSWORD, credential_ticket(owner), mfa_proof=issue_mfa_proof(owner, device.pk, "primary", int(timezone.now().timestamp())))
        pending = pending_accounts[owner.pk]
        result = {
            "user_id": owner.pk,
            "actor_ticket": "synthetic-actor-ticket",
            "offline_grant": issue_grant(device, owner),
            "grant_key": public_key(),
            "lease_until": device.lease_until.isoformat(),
        }
        tokens = save_actor(result, pending, "Bearer synthetic-cloud-access", "synthetic-refresh", "primary")
        yield device, tokens


def test_cloud_requires_verified_password_before_new_account_enrollment(owner, tenant):
    cache.clear()
    owner.set_password(PASSWORD)
    owner.save()
    client = APIClient()
    client.force_authenticate(owner, token={"mfa_verified_at": int(timezone.now().timestamp()), "mfa_expires_at": int(timezone.now().timestamp()) + 86400})
    assert client.post("/api/v1/sync/credentials/", {"password": "wrong"}).status_code == 400
    proof = client.post("/api/v1/sync/credentials/", {"password": PASSWORD, "device_id": str(uuid4())}).data
    bad = client.post(
        "/api/v1/sync/devices/",
        {"protocol": 1, "tenant_id": tenant.pk, "credential_mode": "account", "credential_ticket": "invalid"},
        format="json",
    )
    assert bad.status_code == 400
    good = client.post(
        "/api/v1/sync/devices/",
        {
            "protocol": 1,
            "tenant_id": tenant.pk,
            "credential_mode": "account",
            "credential_ticket": proof["credential_ticket"],
        },
        format="json",
    )
    assert good.status_code == 200, good.data
    grant = verify_grant(good.data["offline_grant"], good.data["grant_key"])
    assert grant["user"] == owner.pk and grant["tenant"] == tenant.pk and grant["policy"]["owner"]
    assert PASSWORD not in json.dumps(good.data, default=str)


def test_account_password_unlocks_and_old_or_other_register_tokens_cannot(owner, secured):
    device, tokens = secured
    authentication = DesktopJWTAuthentication()
    authentication.register = "primary"
    assert authentication.get_user(AccessToken(tokens["access"])).pk == owner.pk
    lock(owner.pk, "primary")
    with pytest.raises(DesktopLocked):
        authentication.get_user(AccessToken(tokens["access"]))
    request = RequestFactory().post(
        "/desktop/unlock/", {"username": owner.username, "password": PASSWORD}, content_type="application/json"
    )
    response = endpoint(request, "unlock/")
    assert response.status_code == 200
    new = json.loads(response.content)
    assert authentication.get_user(AccessToken(new["access"])).pk == owner.pk
    with pytest.raises(DesktopLocked):
        authentication.get_user(AccessToken(tokens["access"]))
    authentication.register = "another-register"
    with pytest.raises(DesktopLocked):
        authentication.get_user(AccessToken(new["access"]))


def test_idle_lock_is_enforced_by_backend_and_polling_does_not_renew_it(owner, secured):
    _, tokens = secured
    actors = get_state("actors")
    actors[str(owner.pk)]["sessions"]["primary"]["activity"] -= 611
    from apps.desktop_sync.security import seal_session

    actors[str(owner.pk)]["sessions"]["primary"] = seal_session(
        owner.pk, "primary", actors[str(owner.pk)]["sessions"]["primary"]
    )
    set_state("actors", actors)
    with pytest.raises(DesktopLocked):
        DesktopJWTAuthentication().get_user(AccessToken(tokens["access"]))
    assert get_state("actors")[str(owner.pk)]["sessions"]["primary"]["locked"]


def test_password_verifier_grant_and_privilege_tampering_are_rejected(owner, secured):
    _, tokens = secured
    actors = get_state("actors")
    actor = actors[str(owner.pk)]
    assert actor["password_hash"] != PASSWORD and password_value(owner.pk, PASSWORD) != PASSWORD
    actor["password_hash"] = "attacker-changed"
    set_state("actors", actors)
    with pytest.raises(DesktopLocked):
        DesktopJWTAuthentication().get_user(AccessToken(tokens["access"]))


def test_signed_grant_cannot_be_extended_or_replaced(owner, secured):
    device, tokens = secured
    actors = get_state("actors")
    signed = actors[str(owner.pk)]["offline_grant"]
    with pytest.raises(ValueError):
        verify_grant(signed + "changed", public_key())
    set_state("security_denied", True)
    with pytest.raises(DesktopLocked):
        DesktopJWTAuthentication().get_user(AccessToken(tokens["access"]))


def test_clock_rollback_requires_online_confirmation(owner, secured, monkeypatch):
    _, tokens = secured
    from apps.desktop_sync import security

    earlier = timezone.now() - timedelta(hours=2)
    monkeypatch.setattr(security.timezone, "now", lambda: earlier)
    with pytest.raises(DesktopLocked, match="vaqti"):
        DesktopJWTAuthentication().get_user(AccessToken(tokens["access"]))


def test_wrong_password_lockout_is_per_account_not_whole_store(owner, tenant, secured):
    from apps.desktop_sync.security import verify_password

    for _ in range(5):
        with pytest.raises(ValueError):
            verify_password("unknown-cashier", "wrong", "primary")
    with pytest.raises(DesktopLocked) as blocked:
        verify_password("unknown-cashier", "wrong", "primary")
    assert blocked.value.status_code == 429
    assert verify_password(owner.username, PASSWORD, "primary")["user_id"] == owner.pk


def test_register_restart_keeps_work_but_blocks_saved_session(owner, secured):
    _, tokens = secured
    from apps.desktop_sync.models import LocalOperation

    LocalOperation.objects.create(
        user_id=owner.pk, tenant_id=get_state("device")["tenant_id"], title="Unsynced QA", payload={}
    )
    response = endpoint(
        RequestFactory().post("/desktop/register-start/", {}, content_type="application/json"), "register-start/"
    )
    assert response.status_code == 200 and LocalOperation.objects.count() == 1
    with pytest.raises(DesktopLocked):
        DesktopJWTAuthentication().get_user(AccessToken(tokens["access"]))


def test_tampered_session_cannot_extend_activity_or_unlock(owner, secured):
    _, tokens = secured
    actors = get_state("actors")
    actors[str(owner.pk)]["sessions"]["primary"]["activity"] += 100000
    set_state("actors", actors)
    with pytest.raises(DesktopLocked, match="xavfsizlik"):
        DesktopJWTAuthentication().get_user(AccessToken(tokens["access"]))


def test_old_logout_cannot_lock_a_newly_authenticated_session(owner, secured):
    _, tokens = secured
    unlocked = endpoint(
        RequestFactory().post(
            "/desktop/unlock/", {"username": owner.username, "password": PASSWORD}, content_type="application/json"
        ),
        "unlock/",
    )
    new = json.loads(unlocked.content)
    stale = RequestFactory().post(
        "/desktop/lock/", {}, content_type="application/json", HTTP_AUTHORIZATION="Bearer " + tokens["access"]
    )
    assert endpoint(stale, "lock/").status_code == 423
    assert DesktopJWTAuthentication().get_user(AccessToken(new["access"])).pk == owner.pk


def test_security_renewal_does_not_wait_for_pending_work(owner, secured, monkeypatch):
    from unittest.mock import Mock

    import requests

    from apps.desktop_sync import worker
    from apps.desktop_sync.models import LocalOperation

    device, _ = secured
    daily_proof = get_state("actors")[str(owner.pk)]["mfa_proofs"]["primary"]
    old = get_state("device")["lease_until"]
    device.lease_until = timezone.now() + timedelta(days=8)
    payload = {
        "grant_key": public_key(),
        "offline_grants": {str(owner.pk): issue_grant(device, owner)},
        "lease_until": device.lease_until.isoformat(),
    }
    operation = LocalOperation.objects.create(
        user_id=owner.pk, tenant_id=device.tenant_id, title="Still waiting", payload={}
    )

    def remote(method, path, **kwargs):
        if path.startswith("sync/security/"):
            return Mock(ok=True, json=lambda: payload)
        raise requests.ConnectionError("Synthetic interrupted push")

    monkeypatch.setattr(worker, "last_security_check", 0)
    monkeypatch.setattr(worker, "cloud_request", remote)
    worker.sync_once()
    assert get_state("device")["lease_until"] > old
    operation.refresh_from_db()
    assert get_state("actors")[str(owner.pk)]["mfa_proofs"]["primary"] == daily_proof
    assert (
        operation.status == "waiting"
        and get_state("actors")[str(owner.pk)]["offline_grant"] == payload["offline_grants"][str(owner.pk)]
    )


def test_revocation_removes_access_without_deleting_outbox(owner, secured):
    from apps.desktop_sync.models import LocalOperation
    from apps.desktop_sync.security import refresh_grants

    LocalOperation.objects.create(
        user_id=owner.pk, tenant_id=get_state("device")["tenant_id"], title="Preserved", payload={}
    )
    refresh_grants({"grant_key": public_key(), "offline_grants": {}}, update_policy=True)
    assert str(owner.pk) not in get_state("actors")
    assert LocalOperation.objects.count() == 1


def test_denied_device_requires_online_login_instead_of_returning_unusable_local_tokens(owner, secured):
    from apps.desktop_sync.transport import Vault

    Vault().set_denied(True)
    request = RequestFactory().post(
        "/desktop/unlock/", {"username": owner.username, "password": PASSWORD}, content_type="application/json"
    )
    assert endpoint(request, "unlock/").status_code == 423
