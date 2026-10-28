"""Cloud-signed offline capabilities. Desktop installations hold only the public key."""

import base64
import hmac
import json

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from django.conf import settings
from django.core import signing
from django.utils import timezone
from rest_framework.exceptions import ValidationError


def encode(value):
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def decode(value):
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def private_key():
    if getattr(settings, "DESKTOP_MODE", False):
        raise ValueError("Offline qurilmada server imzolash kaliti bo‘lmaydi.")
    seed = hmac.digest(settings.SECRET_KEY.encode(), b"ilbi-offline-grants-ed25519-v1", "sha256")
    return Ed25519PrivateKey.from_private_bytes(seed)


def public_key():
    return encode(private_key().public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))


def access_policy(user, tenant_id):
    from apps.accounts.models import Employee

    employee = Employee.objects.filter(user=user, tenant_id=tenant_id, is_active=True).first()
    if employee is None or not user.is_active:
        raise ValueError("Xodimning do‘konga kirish ruxsati yo‘q.")
    return {
        "role": user.role,
        "owner": employee.is_owner,
        "permissions": sorted(permission.full_code for permission in employee.permissions.all()),
        "token_version": user.token_version,
    }


def issue_grant(device, user):
    payload = {
        "version": 1,
        "device": str(device.pk),
        "user": user.pk,
        "tenant": device.tenant_id,
        "issued": int(timezone.now().timestamp()),
        "expires": int(device.lease_until.timestamp()),
        "policy": access_policy(user, device.tenant_id),
    }
    body = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return encode(body) + "." + encode(private_key().sign(body))


def issue_mfa_proof(user, device_id, register, verified):
    from apps.accounts.services.daily_mfa import WINDOW

    payload = {"version": 1, "kind": "daily_mfa", "device": str(device_id), "user": user.pk,
               "register": register, "token_version": user.token_version, "verified_at": verified,
               "expires": verified + WINDOW}
    body = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return encode(body) + "." + encode(private_key().sign(body))


def verify_grant(value, key):
    try:
        if not isinstance(value, str) or not isinstance(key, str):
            raise ValueError
        body, signature = value.split(".")
        body = decode(body)
        Ed25519PublicKey.from_public_bytes(decode(key)).verify(decode(signature), body)
        result = json.loads(body)
        if not isinstance(result, dict) or result.get("version") != 1 or type(result.get("expires")) is not int:
            raise ValueError
        return result
    except (ValueError, TypeError, KeyError, InvalidSignature) as exc:
        raise ValueError("Offline ruxsat imzosi tasdiqlanmadi. Internet orqali qayta kiring.") from exc


def credential_ticket(user):
    return signing.dumps({"user": user.pk, "version": user.token_version}, salt="ilbi-offline-account-proof")


def check_credential_ticket(user, data):
    if data.get("credential_mode") != "account":
        return  # Older app releases remain usable until their one-time upgrade.
    try:
        value = signing.loads(data.get("credential_ticket", ""), salt="ilbi-offline-account-proof", max_age=600)
        if value != {"user": user.pk, "version": user.token_version}:
            raise ValueError
    except (signing.BadSignature, ValueError, TypeError) as exc:
        raise ValidationError("Hisobni tasdiqlash muddati tugadi. Odatiy parolingiz bilan qayta kiring.") from exc
