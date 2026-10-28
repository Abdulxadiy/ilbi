from django.db import IntegrityError, transaction
from rest_framework import serializers

from apps.tg_bot.identity import current_bot_id, is_private_chat_id
from apps.tg_bot.models import TelegramContact


class TelegramContactSerializer(serializers.Serializer):
    phone_number = serializers.CharField(max_length=20)
    chat_id = serializers.CharField(max_length=100)

    def validate_chat_id(self, value):
        if not is_private_chat_id(value):
            raise serializers.ValidationError("2FA uchun shaxsiy Telegram chat IDsi talab qilinadi.")
        return value

    def save(self, **kwargs):
        phone_number = self.validated_data["phone_number"]
        chat_id = self.validated_data["chat_id"]
        bot_id = current_bot_id()
        if not bot_id:
            raise serializers.ValidationError("Telegram bot sozlanmagan.")
        conflict = {
            "code": "telegram_chat_already_linked",
            "detail": (
                "Bu Telegram akkaunti boshqa raqamga ulangan. Avvalgi login bilan davom eting "
                "yoki platforma administratoriga murojaat qiling."
            ),
        }
        if TelegramContact.objects.filter(chat_id=chat_id).exclude(phone_number=phone_number).exists():
            raise serializers.ValidationError(conflict)
        try:
            with transaction.atomic():
                obj, created = TelegramContact.objects.update_or_create(
                    phone_number=phone_number,
                    defaults={"chat_id": chat_id, "bot_id": bot_id},
                )
        except IntegrityError as exc:
            if (
                getattr(exc.__cause__, "pgcode", None) == "23505"
                and getattr(exc.__cause__.diag, "table_name", None) == TelegramContact._meta.db_table
            ):
                raise serializers.ValidationError(conflict) from exc
            raise
        return obj
