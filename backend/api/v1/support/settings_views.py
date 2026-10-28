from django.conf import settings
from django.db import transaction
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import IsPlatformAdmin
from apps.accounts.services.platform_accounts import log_platform_action
from apps.core.models import AuditAction
from apps.support.models import SupportTelegramSettings
from apps.support.tasks import configured_admin_recipients, send_support_test
from apps.tg_bot.identity import current_bot_id, is_group_chat_id, is_private_chat_id
from apps.tg_bot.models import TelegramContact


class TelegramSettingsInput(serializers.ModelSerializer):
    class Meta:
        model = SupportTelegramSettings
        fields = ["enabled", "target", "group_chat_id"]
        extra_kwargs = {name: {"required": True} for name in fields}

    def validate(self, data):
        group = data.get("group_chat_id", "")
        if group and not is_group_chat_id(group):
            raise serializers.ValidationError({"group_chat_id": "Guruhning manfiy raqamli chat ID sini kiriting."})
        if data.get("enabled"):
            if not current_bot_id():
                raise serializers.ValidationError({"detail": "Telegram bot serverda sozlanmagan."})
            if data.get("target") in ("group", "both") and not group:
                raise serializers.ValidationError({"group_chat_id": "Guruh chat ID sini kiriting."})
            if data.get("target") in ("personal", "both"):
                contact = TelegramContact.objects.filter(
                    phone_number=self.context["request"].user.phone_number, bot_id=current_bot_id()
                ).first()
                if not contact or not is_private_chat_id(contact.chat_id):
                    raise serializers.ValidationError({"detail": "Avval botning shaxsiy chatida raqamingizni ulang."})
        return data


class SupportTelegramSettingsView(APIView):
    permission_classes = [IsPlatformAdmin]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        row = SupportTelegramSettings.objects.filter(admin=request.user).first()
        data = (
            TelegramSettingsInput(row).data
            if row
            else {
                "enabled": request.user.phone_number in settings.SUPPORT_OPERATOR_PHONES,
                "target": "personal",
                "group_chat_id": "",
            }
        )
        contact = TelegramContact.objects.filter(
            phone_number=request.user.phone_number, bot_id=current_bot_id()
        ).first()
        return Response(
            {
                **data,
                "personal_linked": bool(contact and is_private_chat_id(contact.chat_id)),
                "bot_configured": bool(current_bot_id()),
            }
        )

    @extend_schema(request=TelegramSettingsInput, responses=OpenApiTypes.OBJECT)
    def put(self, request):
        serializer = TelegramSettingsInput(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            row, _ = SupportTelegramSettings.objects.update_or_create(
                admin=request.user, defaults=serializer.validated_data
            )
            log_platform_action(
                actor=request.user,
                action=AuditAction.SUPPORT_TELEGRAM_SETTINGS,
                target_model="SupportTelegramSettings",
                target_id=str(row.pk),
                changes={"operation": "support_telegram_settings", **serializer.validated_data},
                request=request,
            )
        return self.get(request)


class SupportTelegramTestView(APIView):
    permission_classes = [IsPlatformAdmin]

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        row = SupportTelegramSettings.objects.filter(admin=request.user, enabled=True).first()
        if row is None or not configured_admin_recipients(row):
            return Response({"detail": "Avval Telegram bildirishnomalarini sozlab, saqlang."}, status=400)
        try:
            send_support_test.delay(request.user.pk)
        except Exception:
            return Response({"detail": "Sinovni navbatga qo‘yib bo‘lmadi. Qayta urinib ko‘ring."}, status=503)
        return Response({"detail": "Sinov xabari yuborish navbatiga qo‘yildi."}, status=202)
