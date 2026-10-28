from apps.accounts.services import otp_services
from apps.accounts.services.demo_access_service import DemoAccessService
from apps.tg_bot.identity import current_bot_id, is_private_chat_id
from apps.tg_bot.models import TelegramContact
from apps.tg_bot.services import send_telegram_message
from rest_framework import status
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken


def issue_tokens(user, *, mfa_verified_at=None):
    """
    Generate JWT access and refresh tokens with custom claims for the user.

    Tenant access is resolved from active database memberships per request;
    a tenant id in a JWT would go stale and is not authoritative.
    """
    if DemoAccessService.is_blocked(user):
        raise AuthenticationFailed("Hisobga kirish ruxsat etilmagan.")
    refresh = RefreshToken.for_user(user)

    # Attach custom claims to refresh token
    refresh["role"] = user.role
    refresh["token_version"] = getattr(user, "token_version", 1)
    if mfa_verified_at is not None:
        from apps.accounts.services.daily_mfa import WINDOW

        refresh["mfa_verified_at"] = mfa_verified_at
        refresh["mfa_expires_at"] = mfa_verified_at + WINDOW

    # Attach custom claims to access token
    access = refresh.access_token
    access["role"] = user.role
    access["token_version"] = getattr(user, "token_version", 1)

    return {
        "access": str(access),
        "refresh": str(refresh),
    }

def get_current_telegram_contact(phone_number):
    """Only a contact registered through the configured bot counts as linked."""
    bot_id = current_bot_id()
    if not bot_id:
        return None
    contact = TelegramContact.objects.filter(phone_number=phone_number, bot_id=bot_id).first()
    return contact if contact and is_private_chat_id(contact.chat_id) else None


def _telegram_not_linked_response():
    return Response(
        {
            'error': 'telegram_contact_not_found',
            'detail': (
                "Telefon raqamingiz Telegram botdagi shaxsiy chatga ulanmagan. "
                "Iltimos, Telegramda @ilbi_bot bilan shaxsiy chatni ochib, /start bosing "
                "va telefon raqamingizni ulang."
            ),
        },
        status=status.HTTP_404_NOT_FOUND,
    )


def get_telegram_contact_or_error(phone_number):
    """
    Common for both flows (register/login): telegram_not_linked
    Removed because the check and cooldown check are the same.
    """
    contact = get_current_telegram_contact(phone_number)
    if contact is None:
        return None, _telegram_not_linked_response()

    if otp_services.is_in_cooldown(phone_number):
        remaining = otp_services.get_cooldown_remaining(phone_number)
        return None, Response(
            {
                'error': 'cooldown',
                'detail': f"Tasdiqlash kodi yaqinda yuborilgan. Yangi kod so'rash uchun {remaining} soniya kuting.",
                'retry_after_seconds': remaining,
            },
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )
    return contact, None

def send_otp_or_error(phone_number, contact):
    # Keep this final boundary safe even if a caller supplies a stale/invalid contact.
    if not is_private_chat_id(getattr(contact, "chat_id", None)):
        return _telegram_not_linked_response()

    code = otp_services.generate_code()
    otp_services.store_code(phone_number, code)

    otp_message = (
        "🔐 *ILBI* | *Tasdiqlash Kodi*\n\n"
        f"Sizning bir martalik kirish kodingiz:\n"
        f"👉 `{code}`  _(nusxalash uchun ustiga bosing)_\n\n"
        "⏱ _Kod faqat 3 daqiqa amal qiladi._\n"
        "🔒 _Xavfsizlik uchun kodni begonalarga bermang!_"
    )

    sent = send_telegram_message(
        contact.chat_id,
        otp_message,
    )
    if not sent:
        otp_services.discard_code(phone_number)
        return Response(
            {
                'error': 'telegram_send_failed',
                'detail': (
                    "Telegram bot orqali tasdiqlash kodini yuborib bo‘lmadi. "
                    "Iltimos, Telegramda @ilbi_bot ga kirib, /start bosing "
                    "va telefon raqamingizni yangilang."
                ),
            },
            status=status.HTTP_502_BAD_GATEWAY,
        )
    return None
