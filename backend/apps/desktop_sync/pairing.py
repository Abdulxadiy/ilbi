"""Temporary HTTPS rendezvous. Register secrets remain end-to-end encrypted."""

import base64
import hashlib
import hmac
import math
import secrets
from datetime import timedelta
from uuid import UUID

from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PublicKey
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from .cloud import device_for
from .models import PairingSession


def digest(value):
    return hmac.digest(settings.SECRET_KEY.encode(), ("ilbi-pairing:" + value).encode(), "sha256").hex()


def fingerprint(public_key):
    value = hashlib.sha256(base64.b64decode(public_key, validate=True)).hexdigest()[:8].upper()
    return value[:4] + " " + value[4:]


class PairingThrottle(SimpleRateThrottle):
    scope = "pairing_claim"
    rate = "5/min"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class PairingPollThrottle(PairingThrottle):
    scope = "pairing_poll"
    rate = "120/min"


def public_state(row):
    return {
        "id": str(row.pk),
        "expires_at": row.expires_at.isoformat(),
        "remaining": max(0, math.ceil((row.expires_at - timezone.now()).total_seconds())),
        "client_name": row.client_name,
        "fingerprint": fingerprint(row.client_public_key) if row.client_public_key else "",
        "state": "expired"
        if row.expires_at <= timezone.now()
        else "completed"
        if row.completed_at
        else "approved"
        if row.encrypted_payload
        else "claimed"
        if row.claimed_at
        else "waiting",
    }


@extend_schema(tags=["Desktop sync"], request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
class PairingCreateView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request):
        device = device_for(request.user, request.data.get("device_id"), lock=True)
        PairingSession.objects.filter(expires_at__lt=timezone.now() - timedelta(days=1)).delete()
        PairingSession.objects.filter(device=device, completed_at__isnull=True).update(
            expires_at=timezone.now(), encrypted_payload=None
        )
        for _ in range(20):
            code = f"{secrets.randbelow(100_000_000):08d}"
            if not PairingSession.objects.filter(code_digest=digest(code)).exists():
                break
        else:
            raise ValidationError("Kod yaratib bo‘lmadi. Qayta urinib ko‘ring.")
        row = PairingSession.objects.create(
            device=device, code_digest=digest(code), expires_at=timezone.now() + timedelta(minutes=3)
        )
        return Response({**public_state(row), "code": code})


@extend_schema(tags=["Desktop sync"], request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
class PairingClaimView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [PairingThrottle]

    @transaction.atomic
    def post(self, request):
        code = str(request.data.get("code", "")).replace(" ", "").replace("-", "")
        row = (
            PairingSession.objects.select_for_update().filter(code_digest=digest(code)).first()
            if len(code) == 8 and code.isascii() and code.isdigit()
            else None
        )
        if not row or row.expires_at <= timezone.now() or row.claimed_at or row.device.revoked_at:
            raise ValidationError("Kod noto‘g‘ri, ishlatilgan yoki muddati tugagan. Asosiy kassadan yangi kod oling.")
        key = request.data.get("public_key", "")
        try:
            raw = base64.b64decode(key, validate=True)
            if len(raw) != 32 or raw == b"\0" * 32:
                raise ValueError
            X25519PublicKey.from_public_bytes(raw)
        except (ValueError, TypeError) as exc:
            raise ValidationError("Qurilma kaliti noto‘g‘ri.") from exc
        claim = secrets.token_urlsafe(32)
        row.claimed_at = timezone.now()
        row.claim_digest = digest(claim)
        row.client_public_key = key
        row.client_name = str(request.data.get("name", "Yangi kassa"))[:80]
        row.save(update_fields=["claimed_at", "claim_digest", "client_public_key", "client_name"])
        return Response({**public_state(row), "claim_token": claim})


@extend_schema(tags=["Desktop sync"], request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
class PairingOwnerView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pairing_id):
        row = PairingSession.objects.select_for_update().filter(pk=pairing_id).first()
        if not row:
            raise ValidationError("Ulanish topilmadi.")
        device_for(request.user, row.device_id)
        action = request.data.get("action", "state")
        if action == "cancel":
            row.expires_at = timezone.now()
            row.encrypted_payload = None
            row.save(update_fields=["expires_at", "encrypted_payload"])
        elif action == "approve":
            if row.expires_at <= timezone.now() or not row.claimed_at or row.completed_at:
                raise ValidationError("Ulanish muddati tugagan yoki yangi kassa hali kodni kiritmagan.")
            payload = request.data.get("payload")
            if not isinstance(payload, dict) or set(payload) != {"public_key", "nonce", "ciphertext", "tag"}:
                raise ValidationError("Himoyalangan ulanish ma’lumoti noto‘g‘ri.")
            if any(not isinstance(value, str) or len(value) > 12000 for value in payload.values()):
                raise ValidationError("Ulanish ma’lumoti juda katta.")
            if row.encrypted_payload and row.encrypted_payload != payload:
                raise ValidationError("Bu ulanish allaqachon tasdiqlangan.")
            row.encrypted_payload = payload
            row.save(update_fields=["encrypted_payload"])
        elif action != "state":
            raise ValidationError("Ulanish amali noto‘g‘ri.")
        value = public_state(row)
        if row.client_public_key:
            value["public_key"] = row.client_public_key
        return Response(value)


@extend_schema(tags=["Desktop sync"], request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
class PairingResultView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [PairingPollThrottle]

    @transaction.atomic
    def post(self, request):
        try:
            pairing_id = UUID(str(request.data.get("id")))
        except ValueError as exc:
            raise ValidationError("Ulanish identifikatori noto‘g‘ri.") from exc
        row = PairingSession.objects.select_for_update().filter(pk=pairing_id).first()
        token = request.data.get("claim_token", "")
        if (
            not row
            or not isinstance(token, str)
            or not row.claim_digest
            or not hmac.compare_digest(row.claim_digest, digest(token))
        ):
            raise ValidationError("Ulanish tasdiqlanmadi.")
        if row.expires_at <= timezone.now() or row.device.revoked_at:
            raise ValidationError("Ulanish muddati tugadi. Yangi kod oling.")
        if request.data.get("complete"):
            if not row.encrypted_payload and not row.completed_at:
                raise ValidationError("Ulanish hali tasdiqlanmagan.")
            row.completed_at = timezone.now()
            row.encrypted_payload = None
            row.save(update_fields=["completed_at", "encrypted_payload"])
        return Response({**public_state(row), "payload": row.encrypted_payload})
