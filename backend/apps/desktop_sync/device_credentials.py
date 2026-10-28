"""Revocable trusted-device renewal; ordinary web token lifetimes stay unchanged."""

import hmac
import secrets

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from .cloud import device_for, device_uuid
from .grants import access_policy
from .models import SyncActor, SyncDevice


def trusted_device_valid(user, device_id):
    from rest_framework.exceptions import APIException

    from apps.accounts.services.demo_access_service import DemoAccessService

    try:
        device = SyncDevice.objects.filter(pk=device_uuid(device_id)).first()
        if not device:
            return False
        owner = get_user_model().objects.filter(pk=device.user_id, is_active=True).first()
        if not owner or DemoAccessService.is_blocked(owner):
            return False
        device_for(owner, device.pk)
        return (
            access_policy(user, device.tenant_id)["role"] in {"owner", "staff"}
            and SyncActor.objects.filter(device=device, user_id=user.pk, token_version=user.token_version)
            .exclude(credential_digest="")
            .exists()
        )
    except (APIException, ValueError):
        return False


def device_tokens(device, user):
    from rest_framework_simplejwt.tokens import RefreshToken

    from api.v1.accounts.views.misc import issue_tokens

    token = RefreshToken(issue_tokens(user)["refresh"])
    token["desktop_cloud_device"] = str(device.pk)
    return {"access": str(token.access_token), "refresh": str(token)}


def digest(device_id, user_id, secret):
    return hmac.digest(
        settings.SECRET_KEY.encode(), f"ilbi-device-session:{device_id}:{user_id}:{secret}".encode(), "sha256"
    ).hex()


def issue_credential(device, user):
    secret = secrets.token_urlsafe(32)
    SyncActor.objects.filter(device=device, user_id=user.pk).update(
        credential_digest=digest(device.pk, user.pk, secret)
    )
    return {"device_id": str(device.pk), "user_id": user.pk, "secret": secret}


class DeviceSessionThrottle(SimpleRateThrottle):
    scope = "desktop_session"
    rate = "60/min"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


@extend_schema(tags=["Desktop sync"], request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
class DeviceSessionView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [DeviceSessionThrottle]

    @transaction.atomic
    def post(self, request):
        device = SyncDevice.objects.filter(pk=device_uuid(request.data.get("device_id"))).first()
        user_id = request.data.get("user_id")
        secret = request.data.get("secret")
        if not device or type(user_id) is not int or not isinstance(secret, str) or not 40 <= len(secret) <= 100:
            raise PermissionDenied("Qurilma sessiyasi tasdiqlanmadi.")
        users = get_user_model().objects.filter(is_active=True)
        owner = users.filter(pk=device.user_id).first()
        user = users.filter(pk=user_id).first()
        actor = SyncActor.objects.filter(device=device, user_id=user_id).first()
        if not owner or not user or not actor or actor.token_version != user.token_version:
            raise PermissionDenied("Hisob yoki qurilma ruxsati bekor qilingan.")
        if not actor.credential_digest or not hmac.compare_digest(
            actor.credential_digest, digest(device.pk, user.pk, secret)
        ):
            raise PermissionDenied("Qurilma sessiyasi tasdiqlanmadi.")
        device_for(owner, device.pk, lock=True)  # Includes lease, revocation, owner version and active ownership.
        try:
            policy = access_policy(user, device.tenant_id)
        except ValueError as exc:
            raise PermissionDenied("Hisob ruxsati bekor qilingan.") from exc
        if policy["role"] not in {"owner", "staff"}:
            raise PermissionDenied("Hisob ruxsati bekor qilingan.")
        return Response(device_tokens(device, user))
