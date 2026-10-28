from datetime import timedelta
from uuid import uuid4
from unittest.mock import Mock, patch

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from apps.accounts.models import Employee
from apps.desktop_sync.models import SyncActor, SyncDevice
from apps.desktop_sync.server_policy import OFFICIAL_SERVER
from apps.desktop_sync.transport import cloud_request

pytestmark = pytest.mark.django_db


@pytest.fixture
def trusted(owner, tenant):
    cache.clear()
    owner.set_password("synthetic-verified-account-password")
    owner.save()
    client = APIClient()
    client.force_authenticate(owner, token={"mfa_verified_at": int(timezone.now().timestamp()), "mfa_expires_at": int(timezone.now().timestamp()) + 86400})
    proof = client.post("/api/v1/sync/credentials/", {"password": "synthetic-verified-account-password", "device_id": str(uuid4())}).data
    enrolled = client.post(
        "/api/v1/sync/devices/",
        {
            "protocol": 1,
            "tenant_id": tenant.pk,
            "credential_mode": "account",
            "credential_ticket": proof["credential_ticket"],
        },
        format="json",
    )
    assert enrolled.status_code == 200
    return client, enrolled.data


def test_automatic_device_reconnect_after_four_day_outage_without_changing_web_sessions(owner, trusted):
    _, enrolled = trusted
    ordinary = RefreshToken.for_user(owner)
    ordinary["token_version"] = owner.token_version
    ordinary.set_exp(from_time=timezone.now() - timedelta(days=4), lifetime=timedelta(days=1))
    public = APIClient()
    assert public.post("/api/v1/auth/token/refresh/", {"refresh": str(ordinary)}, format="json").status_code == 401
    renewed = public.post("/api/v1/sync/session/", enrolled["cloud_credential"], format="json")
    assert renewed.status_code == 200
    assert str(AccessToken(renewed.data["access"])["user_id"]) == str(owner.pk)
    fresh = RefreshToken(renewed.data["refresh"])
    assert fresh["exp"] - fresh["iat"] == 86400  # Ordinary web policy is unchanged.
    row = SyncActor.objects.get(device_id=enrolled["device_id"], user_id=owner.pk)
    assert row.credential_digest != enrolled["cloud_credential"]["secret"]


@pytest.mark.parametrize("reason", ["expired", "revoked", "password_changed"])
def test_device_renewal_stops_when_lease_or_owner_authorization_ends(owner, trusted, reason):
    _, enrolled = trusted
    device = SyncDevice.objects.get(pk=enrolled["device_id"])
    if reason == "expired":
        device.lease_until = timezone.now() - timedelta(seconds=1)
        device.save()
    elif reason == "revoked":
        device.revoked_at = timezone.now()
        device.save()
    else:
        owner.token_version += 1
        owner.save()
    assert APIClient().post("/api/v1/sync/session/", enrolled["cloud_credential"], format="json").status_code == 403


def test_device_credential_is_bound_to_actor_and_replaced_on_online_reconfirmation(owner, staff, tenant, trusted):
    client, enrolled = trusted
    public = APIClient()
    wrong = {**enrolled["cloud_credential"], "user_id": staff.pk}
    assert public.post("/api/v1/sync/session/", wrong, format="json").status_code == 403
    proof = client.post("/api/v1/sync/credentials/", {"password": "synthetic-verified-account-password", "device_id": str(uuid4())}).data
    linked = client.post(
        "/api/v1/sync/actors/",
        {
            "device_id": enrolled["device_id"],
            "credential_mode": "account",
            "credential_ticket": proof["credential_ticket"],
        },
        format="json",
    )
    assert linked.status_code == 200
    assert public.post("/api/v1/sync/session/", enrolled["cloud_credential"], format="json").status_code == 403
    assert public.post("/api/v1/sync/session/", linked.data["cloud_credential"], format="json").status_code == 200


def test_cipher_vault_credential_renews_transport_after_normal_refresh_expired():
    credential = {"device_id": "synthetic-device", "user_id": 1, "secret": "synthetic-private-device-key"}
    stored = {
        "server": OFFICIAL_SERVER,
        "primary_user": 1,
        "access": "old",
        "refresh": "expired",
        "cloud_credential": credential,
    }
    with (
        patch("apps.desktop_sync.transport.Vault") as vault,
        patch(
            "apps.desktop_sync.transport.requests.request", side_effect=[Mock(status_code=401), Mock(status_code=200)]
        ),
        patch(
            "apps.desktop_sync.transport.requests.post",
            side_effect=[
                Mock(ok=False),
                Mock(ok=True, json=lambda: {"access": "renewed", "refresh": "renewed-refresh"}),
            ],
        ) as post,
    ):
        vault.return_value.read.return_value = stored
        assert cloud_request("GET", "sync/changes/").status_code == 200
        assert post.call_args_list[1].args == (OFFICIAL_SERVER + "/api/v1/sync/session/",)
        assert post.call_args_list[1].kwargs["allow_redirects"] is False
        assert vault.return_value.put_user.call_args.args[1]["cloud_credential"] == credential


def test_missing_cashier_credential_never_falls_back_to_owner():
    with (
        patch("apps.desktop_sync.transport.Vault") as vault,
        patch("apps.desktop_sync.transport.requests.request") as send,
    ):
        vault.return_value.read.return_value = {
            "server": OFFICIAL_SERVER,
            "primary_user": 1,
            "access": "owner-only",
            "actors": {},
        }
        with pytest.raises(KeyError):
            cloud_request("GET", "support/", user_id=7)
        send.assert_not_called()


def test_fired_cashier_cannot_renew_a_trusted_device_session(staff, tenant, trusted):
    _, enrolled = trusted
    employment = Employee.objects.create(user=staff, tenant=tenant, is_active=True)
    staff.set_password("synthetic-cashier-password")
    staff.save()
    client = APIClient()
    client.force_authenticate(staff, token={"mfa_verified_at": int(timezone.now().timestamp()), "mfa_expires_at": int(timezone.now().timestamp()) + 86400})
    proof = client.post("/api/v1/sync/credentials/", {"password": "synthetic-cashier-password", "device_id": str(uuid4())}).data
    grant = client.post(
        "/api/v1/sync/actors/",
        {
            "device_id": enrolled["device_id"],
            "credential_mode": "account",
            "credential_ticket": proof["credential_ticket"],
        },
        format="json",
    )
    assert grant.status_code == 200
    assert APIClient().post("/api/v1/sync/session/", grant.data["cloud_credential"], format="json").status_code == 200
    employment.is_active = False
    employment.save()
    assert APIClient().post("/api/v1/sync/session/", grant.data["cloud_credential"], format="json").status_code == 403


def test_revoking_device_invalidates_its_already_issued_cloud_access_and_refresh(trusted):
    _, enrolled = trusted
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION="Bearer " + enrolled["cloud_tokens"]["access"])
    assert client.get("/api/v1/auth/me/").status_code == 200
    SyncDevice.objects.filter(pk=enrolled["device_id"]).update(revoked_at=timezone.now())
    assert client.get("/api/v1/auth/me/").status_code == 401
    assert (
        APIClient()
        .post("/api/v1/auth/token/refresh/", {"refresh": enrolled["cloud_tokens"]["refresh"]}, format="json")
        .status_code
        == 401
    )
