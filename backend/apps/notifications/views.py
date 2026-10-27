from pathlib import Path

from django.conf import settings
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .registration import CATEGORIES, register_installation, revoke_installation


class PushRegistrationSerializer(serializers.Serializer):
    installation_id = serializers.UUIDField()
    revoke_secret = serializers.RegexField(r"^[a-f0-9]{64}$", write_only=True)
    token = serializers.RegexField(r"^[A-Za-z0-9_:.-]{32,4096}$", write_only=True)
    platform = serializers.ChoiceField(choices=["android"])
    application_id = serializers.ChoiceField(choices=["uz.ilbi.mobile"])
    categories = serializers.DictField(child=serializers.BooleanField(), required=False)

    def validate_categories(self, value):
        if set(value) - CATEGORIES:
            raise serializers.ValidationError("Bildirishnoma kategoriyasi tasdiqlanmadi.")
        return value


class PushRevokeSerializer(serializers.Serializer):
    installation_id = serializers.UUIDField()
    revoke_secret = serializers.RegexField(r"^[a-f0-9]{64}$", write_only=True)


class PushRegistrationView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=PushRegistrationSerializer, responses={200: OpenApiTypes.OBJECT})
    def post(self, request):
        if not request.user.terms_accepted:
            raise PermissionDenied("Avval foydalanish shartlarini qabul qiling.")
        serializer = PushRegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        installation = register_installation(request.user, serializer.validated_data)
        ready = bool(
            settings.MOBILE_PUSH_ENABLED
            and settings.FCM_PROJECT_ID
            and settings.FCM_SERVICE_ACCOUNT_FILE
            and Path(settings.FCM_SERVICE_ACCOUNT_FILE).is_file()
        )
        return Response({"installation_id": str(installation.pk), "registered": True, "delivery_enabled": ready})


class PushRevokeView(APIView):
    # An unguessable per-installation revocation secret allows offline logout
    # cleanup after the JWT has been erased. It can only deactivate, never bind.
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=PushRevokeSerializer, responses={204: None})
    def post(self, request):
        serializer = PushRevokeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        revoke_installation(serializer.validated_data["installation_id"], serializer.validated_data["revoke_secret"])
        return Response(status=status.HTTP_204_NO_CONTENT)
