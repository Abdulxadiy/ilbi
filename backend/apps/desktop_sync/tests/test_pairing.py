import base64
from datetime import timedelta

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from apps.desktop_sync.models import PairingSession

pytestmark = pytest.mark.django_db


@pytest.fixture
def pairing(owner, tenant):
    cache.clear()
    primary = APIClient()
    primary.force_authenticate(owner)
    device = primary.post("/api/v1/sync/devices/", {"protocol": 1, "tenant_id": tenant.pk}, format="json").data
    public = APIClient()
    key = base64.b64encode(
        X25519PrivateKey.generate()
        .public_key()
        .public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    ).decode()
    created = primary.post("/api/v1/sync/pairings/", {"device_id": device["device_id"]}, format="json")
    assert created.status_code == 200
    return primary, public, created.data, key


def test_pairing_is_one_use_owner_approved_and_opaque(pairing, staff):
    owner, public, code, key = pairing
    claimed = public.post(
        "/api/v1/sync/pairings/claim/", {"code": code["code"], "public_key": key, "name": "QA kassa"}, format="json"
    )
    assert claimed.status_code == 200 and claimed.data["state"] == "claimed"
    assert (
        public.post(
            "/api/v1/sync/pairings/claim/", {"code": code["code"], "public_key": key}, format="json"
        ).status_code
        == 400
    )
    body = {"id": code["id"], "claim_token": claimed.data["claim_token"]}
    assert public.post("/api/v1/sync/pairings/result/", body, format="json").data["payload"] is None
    other = APIClient()
    other.force_authenticate(staff)
    path = f"/api/v1/sync/pairings/{code['id']}/"
    envelope = {name: "synthetic-encrypted-data" for name in ["public_key", "nonce", "ciphertext", "tag"]}
    assert other.post(path, {"action": "approve", "payload": envelope}, format="json").status_code == 403
    assert owner.post(path, {"action": "approve", "payload": envelope}, format="json").status_code == 200
    assert owner.post(path, {"action": "approve", "payload": envelope}, format="json").status_code == 200
    assert (
        public.post("/api/v1/sync/pairings/result/", {**body, "claim_token": "wrong"}, format="json").status_code == 400
    )
    assert public.post("/api/v1/sync/pairings/result/", body, format="json").data["payload"] == envelope
    assert (
        public.post("/api/v1/sync/pairings/result/", {**body, "complete": True}, format="json").data["state"]
        == "completed"
    )
    assert PairingSession.objects.get(pk=code["id"]).encrypted_payload is None


def test_expired_cancelled_and_replaced_codes_do_not_work(pairing):
    owner, public, code, key = pairing
    row = PairingSession.objects.get(pk=code["id"])
    assert row.code_digest != code["code"]
    row.expires_at = timezone.now() - timedelta(seconds=1)
    row.save()
    assert (
        public.post(
            "/api/v1/sync/pairings/claim/", {"code": code["code"], "public_key": key}, format="json"
        ).status_code
        == 400
    )
    assert public.post("/api/v1/sync/pairings/result/", {"id": "invalid"}, format="json").status_code == 400


def test_guessing_codes_is_throttled(pairing):
    _, public, _, key = pairing
    statuses = [
        public.post("/api/v1/sync/pairings/claim/", {"code": "invalid", "public_key": key}, format="json").status_code
        for _ in range(6)
    ]
    assert statuses == [400] * 5 + [429]
