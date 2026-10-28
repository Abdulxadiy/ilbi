"""Platform-only account recovery; never merge users or take another account's chat."""

from ipaddress import ip_address

from django.db import IntegrityError, transaction
from django.db.models import Q
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from apps.accounts.models import User
from apps.accounts.services import login_throttle, otp_services
from apps.accounts.services.password_reset_service import invalidate_password_links
from apps.core.models import AuditAction, AuditLog
from apps.tg_bot.identity import current_bot_id
from apps.tg_bot.models import TelegramContact


def verify_admin(actor, password):
    if not actor.is_active or actor.role != "platform_admin":
        raise PermissionDenied("Faqat platforma administratori uchun.")
    if not actor.check_password(password):
        raise ValidationError({"admin_password": "Administrator paroli noto‘g‘ri."})


def log_platform_action(
    *, actor, action, target_model, target_id, changes, request, description="Platforma boshqaruvi"
):
    candidate = request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[-1].strip() or request.META.get(
        "REMOTE_ADDR", ""
    )
    try:
        address = str(ip_address(candidate))
    except ValueError:
        address = None
    return AuditLog.objects.create(
        tenant=None,
        actor=actor,
        action=action,
        target_model=target_model,
        target_id=str(target_id),
        changes=changes,
        description=description,
        ip_address=address,
        user_agent=request.META.get("HTTP_USER_AGENT", "")[:500],
    )


def recover_identity(*, actor, user_id, values, request):
    try:
        with transaction.atomic():
            users = {
                row.pk: row
                for row in User.objects.select_for_update()
                .filter(
                    pk__in=[actor.pk, user_id],
                )
                .order_by("pk")
            }
            admin, user = users.get(actor.pk), users.get(user_id)
            if admin is None or user is None:
                raise NotFound("Hisob topilmadi.")
            verify_admin(admin, values["admin_password"])
            if admin.token_version != actor.token_version:
                raise PermissionDenied("Sessiya yangilangan. Qayta kiring.")
            old_phone, new_phone = user.phone_number, values["phone_number"]
            if old_phone != values["expected_phone_number"]:
                raise ValidationError({"detail": "Hisob o‘zgargan. Ma’lumotni yangilab, qayta tekshiring."})
            if user.token_version != values["expected_version"]:
                raise ValidationError({"detail": "Hisob xavfsizlik ma’lumotlari o‘zgargan. Yangilab tekshiring."})
            if User.objects.filter(phone_number=new_phone).exclude(pk=user.pk).exists():
                raise ValidationError({"phone_number": "Bu login raqami boshqa hisobga tegishli."})
            chat_id = values.get("telegram_chat_id", "") if values["telegram_action"] == "replace" else ""
            bot_id = current_bot_id()
            if chat_id and not bot_id:
                raise ValidationError({"telegram_chat_id": "Telegram bot sozlanmagan."})
            contacts = list(
                TelegramContact.objects.select_for_update()
                .filter(
                    Q(phone_number__in=[old_phone, new_phone]) | Q(chat_id=chat_id),
                )
                .order_by("pk")
            )
            if any(row.chat_id == chat_id and row.phone_number not in (old_phone, new_phone) for row in contacts):
                raise ValidationError({"telegram_chat_id": "Bu Telegram chati boshqa hisobga ulangan."})
            previous = next((row.chat_id for row in contacts if row.phone_number == old_phone), "")
            invalidate_password_links(user.pk)
            TelegramContact.objects.filter(phone_number__in=[old_phone, new_phone]).delete()
            if chat_id:
                TelegramContact.objects.create(phone_number=new_phone, chat_id=chat_id, bot_id=bot_id)
            user.phone_number = new_phone
            user.token_version += 1
            fields = ["phone_number", "token_version"]
            if old_phone != new_phone:
                user.is_phone_verified = False
                fields.append("is_phone_verified")
            user.save(update_fields=fields)
            login_throttle.register_success(new_phone)
            otp_services.discard_code(old_phone)
            if old_phone != new_phone:
                otp_services.discard_code(new_phone)
            log_platform_action(
                actor=admin,
                action=AuditAction.ACCOUNT_IDENTITY_UPDATE,
                target_model="User",
                target_id=str(user.pk),
                changes={
                    "operation": "identity_recovery",
                    "old_phone": old_phone,
                    "new_phone": new_phone,
                    "old_chat_id": previous,
                    "new_chat_id": chat_id,
                    "reason": values["reason"],
                    "ownership_verified": True,
                },
                request=request,
                description="Login va Telegram ulanishi administrator tomonidan yangilandi",
            )
            return user
    except IntegrityError as exc:
        cause = exc.__cause__
        if getattr(cause, "pgcode", None) == "23505" and getattr(cause.diag, "table_name", None) in (
            User._meta.db_table,
            TelegramContact._meta.db_table,
        ):
            raise ValidationError({"detail": "Raqam yoki Telegram ulanishi band bo‘ldi. Yangilab tekshiring."}) from exc
        raise
