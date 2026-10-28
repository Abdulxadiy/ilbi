"""
Service layer for password setup and reset via secure one-time links sent by email.
Roadmap reference: Phase 7 (Password reset / setup via email).
"""

import hashlib
import json
import logging
import secrets

import redis
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q

from apps.accounts.models import Employee
from apps.accounts.services import login_throttle
from apps.accounts.services.demo_access_service import DemoAccessService
from apps.accounts.services.email_utils import mask_email
from apps.core.branding import send_branded_email as send_mail

logger = logging.getLogger(__name__)

User = get_user_model()
redis_client = (
    redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
    if getattr(settings, "REDIS_URL", None)
    else None
)

TOKEN_TTL_SECONDS = 86400  # 24 hours
COOLDOWN_SECONDS = 60      # Minimum interval between email dispatch requests


def _token_key(token: str) -> str:
    """New bearer tokens are stored under their digest, never the URL token."""
    return f"pwd_reset:{hashlib.sha256(token.encode()).hexdigest()}"


def _legacy_token_key(token: str) -> str:
    """Old emailed links remain usable for the rest of their original TTL."""
    return f"pwd_reset:{token}"


def _invitation_index_key(user_id: int) -> str:
    return f"pwd_reset_invites_user:{user_id}"


INVITE_PURPOSES = frozenset(("new_owner", "new_employee", "transfer_owner"))


def _cooldown_key(user_id: int) -> str:
    """Redis key tracking cooldown per user to prevent email spam."""
    return f"pwd_reset_cooldown:{user_id}"


def generate_reset_token() -> str:
    """Generate a cryptographically secure 32-byte URL-safe token."""
    return secrets.token_urlsafe(32)


def is_in_cooldown(user_id: int) -> bool:
    """Check if the user is currently throttled from requesting another reset email."""
    return redis_client.exists(_cooldown_key(user_id)) == 1


def store_reset_token(
    token: str,
    user_id: int,
    purpose: str = "reset_password",
    extra_context: dict | None = None,
) -> None:
    """
    Store the token mapped to user_id, purpose, and context metadata with 24-hour expiration
    and set the 60-second cooldown key.
    """
    payload = {
        "user_id": user_id,
        "purpose": purpose,
        "extra_context": extra_context or {},
        "account_version": User.objects.filter(pk=user_id).values_list("token_version", flat=True).first(),
    }
    pipe = redis_client.pipeline()
    pipe.set(_token_key(token), json.dumps(payload), ex=TOKEN_TTL_SECONDS)
    pipe.set(_cooldown_key(user_id), "1", ex=COOLDOWN_SECONDS)
    if purpose in INVITE_PURPOSES:
        index_key = _invitation_index_key(user_id)
        pipe.sadd(index_key, _token_key(token))
        pipe.expire(index_key, TOKEN_TTL_SECONDS)
    pipe.execute()


def _parse_token_raw(raw_val: str | None) -> dict | None:
    """Safely parse token payload, supporting both new JSON format and legacy integer string."""
    if raw_val is None:
        return None
    try:
        data = json.loads(raw_val)
        if isinstance(data, dict):
            return data
    except (json.JSONDecodeError, ValueError, TypeError):
        pass
    # Legacy fallback: raw string was just user_id integer
    try:
        return {
            "user_id": int(raw_val),
            "purpose": "reset_password",
            "extra_context": {},
        }
    except (ValueError, TypeError):
        return None


def _read_token(token: str) -> tuple[str, dict | None]:
    key = _token_key(token)
    raw = redis_client.get(key)
    if raw is None:
        key = _legacy_token_key(token)
        raw = redis_client.get(key)
    return key, _parse_token_raw(raw)


def _eligible_user(user) -> bool:
    return bool(
        user
        and user.is_active
        and not DemoAccessService.is_blocked(user)
        and user.role in ("staff", "owner", "platform_admin")
        and (
            user.role == "platform_admin"
            or Employee.objects.filter(user=user, is_active=True, tenant__is_active=True).exists()
        )
    )


def consume_reset_token(token: str) -> int | None:
    """
    Retrieve user_id associated with token and immediately delete it
    to enforce single-use semantics. Returns user_id or None if invalid/expired.
    """
    if not token:
        return None
    key, _ = _read_token(token)
    parsed = _parse_token_raw(redis_client.getdel(key))
    if not parsed:
        return None
    if parsed.get("purpose") in INVITE_PURPOSES:
        redis_client.srem(_invitation_index_key(parsed["user_id"]), _token_key(token))
    return parsed.get("user_id")


def peek_reset_token(token: str) -> dict | None:
    """
    Inspect token metadata without deleting it.
    Used by frontend on mount to validate token and retrieve tailored UI context.
    """
    if not token:
        return None
    _key, parsed = _read_token(token)
    if not parsed:
        return None

    user_id = parsed.get("user_id")
    if not user_id:
        return None

    user = User.objects.filter(id=user_id).first()
    if not _eligible_user(user):
        return None
    if parsed.get("phase") != "pending_2fa" and parsed.get("account_version") not in (None, user.token_version):
        return None
    if parsed.get("phase") == "pending_2fa" and (
        parsed.get("password_version") != getattr(user, "token_version", 1)
        or parsed.get("purpose") not in INVITE_PURPOSES
    ):
        return None

    ctx = parsed.get("extra_context") or {}
    tenant_name = ctx.get("tenant_name")
    if not tenant_name:
        memberships = list(
            user.employments.filter(is_active=True)
            .select_related("tenant")[:2]
        )
        if len(memberships) == 1:
            tenant_name = memberships[0].tenant.name

    from apps.accounts.services.phone_utils import mask_phone_number

    return {
        "valid": True,
        "purpose": parsed.get("purpose", "reset_password"),
        "has_username": bool(user.username),
        "username": user.username or "",
        "phone_hint": mask_phone_number(user.phone_number) if user.phone_number else "",
        "email_hint": mask_email(user.email) if user.email else "",
        "tenant_name": tenant_name or "",
        "position": ctx.get("position", ""),
        "role": user.role,
        "phase": parsed.get("phase", "password_required"),
    }


def resume_invitation(token: str):
    """An unfinished invitation can resume 2FA, but can never reset the password again."""
    info = peek_reset_token(token)
    if not info or info["phase"] != "pending_2fa":
        return None
    _key, payload = _read_token(token)
    if not payload or payload.get("phase") != "pending_2fa":
        return None
    user = User.objects.filter(pk=payload.get("user_id")).first()
    if not _eligible_user(user) or payload.get("password_version") != getattr(user, "token_version", 1):
        return None
    return user


def invitation_ttl(token: str) -> int:
    """Remaining absolute lifetime; resuming must not start a new 24-hour window."""
    if not token:
        return 0
    key, parsed = _read_token(token)
    return max(redis_client.ttl(key), 0) if parsed else 0


def complete_pending_invitations(user_id: int) -> None:
    """Successful Telegram 2FA login terminates every outstanding invite for this account."""
    index_key = _invitation_index_key(user_id)
    while key := redis_client.spop(index_key):
        parsed = _parse_token_raw(redis_client.get(key))
        if parsed and parsed.get("user_id") == user_id and parsed.get("purpose") in INVITE_PURPOSES:
            redis_client.delete(key)


def invalidate_password_links(user_id: int) -> None:
    """Revoke all setup/reset links, including legacy keys, after an account edit."""
    for key in redis_client.scan_iter(match="pwd_reset:*"):
        parsed = _parse_token_raw(redis_client.get(key))
        if parsed and parsed.get("user_id") == user_id:
            redis_client.delete(key)
    redis_client.delete(_invitation_index_key(user_id), _cooldown_key(user_id))


def _resolve_email_copy(
    purpose: str,
    user,
    extra_context: dict | None = None,
) -> dict:
    """
    Resolve email subject, title, body, CTA, and hints based on the purpose:
    - 'reset_password': User forgot password on Login or requested reset from Profile.
    - 'new_owner': Brand-new tenant store owner onboarding.
    - 'new_employee': Brand-new employee onboarding invitation.
    - 'transfer_owner': Tenant store ownership transferred to user.
    """
    ctx = extra_context or {}
    tenant_name = ctx.get("tenant_name", "")
    position = ctx.get("position", "")

    if purpose == "new_owner":
        tenant_badge = f" (Do‘kon: <strong>{tenant_name}</strong>)" if tenant_name else ""
        return {
            "subject": "ILBI — Yangi do‘koningiz yaratildi! Hisobingizni faollashtiring",
            "title": "Do‘koningizga xush kelibsiz! 🎉",
            "message_html": (
                f"Assalomu alaykum! Siz ILBI savdo platformasiga do‘kon egasi sifatida ro‘yxatdan o‘tkazildingiz{tenant_badge}. "
                "Do‘koningizni boshqarish, tovarlarni kiritish va savdoni yo‘lga qo‘yish uchun shaxsiy parolingizni belgilang va hisobingizni faollashtiring."
            ),
            "plain_intro": (
                f"Siz ILBI platformasiga do‘kon egasi sifatida ro‘yxatdan o‘tkazildingiz{f' ({tenant_name})' if tenant_name else ''}.\n"
                "Do‘koningizni boshqarishni boshlash uchun shaxsiy parolingizni belgilang va hisobingizni faollashtiring."
            ),
            "button_text": "Hisobni faollashtirish &rarr;",
            "step_title": "🚀 Boshlash uchun qadamlar:",
            "step_desc": "1. Shaxsiy parolni belgilang &rarr; 2. @ilbi_bot da /start bosib telefon kontaktingizni ulang &rarr; 3. Telegram 2FA kodini tasdiqlang.",
            "security_note": "🔒 Ushbu havola <strong>24 soatgacha</strong> yoki Telegram orqali tizimga kirguningizcha amal qiladi. Parol saqlangach, havola orqali parolni qayta o‘zgartirib bo‘lmaydi.",
        }

    elif purpose == "new_employee":
        pos_str = f" ({position})" if position else ""
        tenant_badge = f" (Do‘kon: <strong>{tenant_name}</strong>)" if tenant_name else ""
        return {
            "subject": "ILBI — Siz jamoaga taklif qilindingiz",
            "title": "ILBI jamoasiga xush kelibsiz! 👋",
            "message_html": (
                f"Assalomu alaykum! Siz ILBI tizimiga do‘kon xodimi{pos_str} sifatida taklif qilindingiz{tenant_badge}. "
                "Tizimda ishlashni boshlash uchun shaxsiy parolingizni belgilang va hisobingizni faollashtiring."
            ),
            "plain_intro": (
                f"Siz ILBI tizimiga xodim{pos_str} sifatida taklif qilindingiz.\n"
                "Tizimda ishlashni boshlash uchun shaxsiy parolingizni o‘rnating."
            ),
            "button_text": "Parol o‘rnatish va kirish &rarr;",
            "step_title": "💡 Keyingi qadam:",
            "step_desc": "Parolni belgilang, @ilbi_bot da /start bosib o‘z telefon kontaktingizni ulang, so‘ng Telegram 2FA kodini tasdiqlang.",
            "security_note": "🔒 Ushbu taklif havolasi <strong>24 soatgacha</strong> yoki Telegram orqali tizimga kirguningizcha amal qiladi. Parol saqlangach, havola orqali parolni qayta o‘zgartirib bo‘lmaydi.",
        }

    elif purpose == "transfer_owner":
        tenant_badge = f" (<strong>{tenant_name}</strong>)" if tenant_name else ""
        return {
            "subject": "ILBI — Do‘kon egaligi sizga topshirildi",
            "title": "Do‘kon boshqaruvi topshirildi 🏢",
            "message_html": (
                f"Assalomu alaykum! Sizga ILBI tizimidagi do‘kon{tenant_badge} egaligi va to‘liq boshqaruv huquqi topshirildi. "
                "Yangi boshqaruvchi sifatida tizimga kirish uchun shaxsiy parolingizni belgilang."
            ),
            "plain_intro": (
                f"Sizga ILBI tizimidagi do‘kon{f' ({tenant_name})' if tenant_name else ''} egaligi topshirildi.\n"
                "Tizimga kirish uchun shaxsiy parolingizni belgilang."
            ),
            "button_text": "Boshqaruvni qabul qilish &rarr;",
            "step_title": "💡 Keyingi qadam:",
            "step_desc": "Parolni belgilang, @ilbi_bot da /start bosib telefon kontaktingizni ulang, so‘ng Telegram 2FA kodini tasdiqlang.",
            "security_note": "🔒 Ushbu havola <strong>24 soatgacha</strong> yoki Telegram orqali tizimga kirguningizcha amal qiladi. Parol saqlangach, havola orqali parolni qayta o‘zgartirib bo‘lmaydi.",
        }

    else:
        # Default: reset_password
        return {
            "subject": "ILBI — Parolingizni qayta tiklash",
            "title": "Parolingizni qayta tiklash",
            "message_html": (
                "Assalomu alaykum! Sizning ILBI hisobingiz uchun parolni qayta tiklash so‘rovi qabul qilindi. "
                "Yangi xavfsiz parol o‘rnatish uchun quyidagi tugmani bosing."
            ),
            "plain_intro": (
                "Sizning ILBI hisobingiz uchun parolni qayta tiklash so‘rovi qabul qilindi.\n"
                "Yangi xavfsiz parol o‘rnatish uchun quyidagi havoladan foydalaning."
            ),
            "button_text": "Parolni qayta tiklash &rarr;",
            "step_title": "💡 Keyingi qadam:",
            "step_desc": "Yangi parol belgilagach, hisobingiz xavfsizligi uchun Telegram orqali 6 xonali tasdiqlash kodi yuboriladi va tizimga avtomatik kirasiz.",
            "security_note": (
                "🔒 Ushbu havola <strong>24 soat</strong> davomida faqat bir marta foydalanish uchun amal qiladi. "
                "Agar bu so‘rovni siz yubormagan bo‘lsangiz, xavotir olmang — parolingiz o‘zgarmaydi. Xatni shunchaki e’tiborsiz qoldirishingiz mumkin."
            ),
        }


def send_password_reset_email(
    user,
    token: str,
    purpose: str = "reset_password",
    extra_context: dict | None = None,
) -> bool:
    """
    Send an email containing the one-time account setup / password reset link
    both in plain text and formatted responsive HTML for Gmail/clients.
    Supports tailored messaging for password resets, new store owners, new employees, etc.
    """
    reset_url = f"{settings.FRONTEND_URL}/setup-account?token={token}"
    copy = _resolve_email_copy(purpose, user, extra_context=extra_context)

    subject = copy["subject"]
    title = copy["title"]
    message_html = copy["message_html"]
    button_text = copy["button_text"]
    step_title = copy["step_title"]
    step_desc = copy["step_desc"]
    security_note = copy["security_note"]

    # Plain text version for non-HTML clients
    lifetime_note = (
        "Ushbu taklif havolasi 24 soatgacha yoki Telegram orqali tizimga kirguningizcha amal qiladi. "
        "Parol saqlangach, havola faqat 2FA bosqichini davom ettiradi."
        if purpose in INVITE_PURPOSES
        else "Ushbu parolni tiklash havolasi 24 soat davomida bir marta ishlatiladi."
    )
    plain_message = (
        f"Assalomu alaykum,\n\n"
        f"{copy['plain_intro']}\n\n"
        f"Tizimga kirish uchun havola:\n"
        f"{reset_url}\n\n"
        f"{step_title} {step_desc}\n\n"
        f"{lifetime_note}\n"
        f"Agar bu so‘rovni siz yubormagan bo‘lsangiz, xatni e’tiborsiz qoldirishingiz mumkin."
    )

    # Minimalist Stripe-style responsive HTML template for Gmail & modern clients
    html_message = f"""
    <!DOCTYPE html>
    <html lang="uz">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>{subject}</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f8fafc; padding: 40px 15px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 520px; background-color: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.03); overflow: hidden;">
              <tr>
                <td style="padding: 40px 36px 36px 36px;">
                  
                  <!-- Embedded ILBI identity; no external image request is required. -->
                  <img src="cid:ilbi-logo" alt="ilbi.uz" width="174" height="80"
                       style="display: block; width: 174px; height: 80px; margin-bottom: 28px; border: 0;">

                  <!-- Title -->
                  <h1 style="font-size: 22px; font-weight: 700; color: #0f172a; margin: 0 0 14px 0; letter-spacing: -0.02em;">
                    {title}
                  </h1>

                  <!-- Message -->
                  <p style="font-size: 14.5px; line-height: 1.65; color: #475569; margin: 0 0 28px 0;">
                    {message_html}
                  </p>

                  <!-- Primary Action Button -->
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 0 28px 0;">
                    <tr>
                      <td align="center" style="background-color: #006bff; border-radius: 10px;">
                        <a href="{reset_url}" target="_blank" style="display: inline-block; padding: 14px 32px; font-size: 14.5px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 10px; letter-spacing: -0.01em;">
                          {button_text}
                        </a>
                      </td>
                    </tr>
                  </table>

                  <!-- Next Step Note -->
                  <div style="background-color: #f8fafc; border: 1px solid #f1f5f9; border-radius: 12px; padding: 14px 18px; margin: 0 0 24px 0;">
                    <div style="font-size: 12.5px; font-weight: 700; color: #334155; margin-bottom: 4px;">
                      {step_title}
                    </div>
                    <div style="font-size: 12.5px; line-height: 1.55; color: #64748b;">
                      {step_desc}
                    </div>
                  </div>

                  <!-- Direct URL Fallback -->
                  <p style="font-size: 12px; line-height: 1.6; color: #94a3b8; margin: 0 0 20px 0;">
                    Agar tugma ishlamasa, quyidagi havolani brauzeringizga nusxalang:<br>
                    <a href="{reset_url}" style="color: #0f172a; text-decoration: underline; word-break: break-all;">{reset_url}</a>
                  </p>

                  <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0 20px 0;">

                  <!-- Security Footnote -->
                  <p style="font-size: 11.5px; line-height: 1.55; color: #94a3b8; margin: 0;">
                    {security_note}
                  </p>
                </td>
              </tr>

              <!-- Clean Card Footer -->
              <tr>
                <td style="background-color: #fafbfc; border-top: 1px solid #f1f5f9; padding: 18px 36px; text-align: center; font-size: 11px; color: #94a3b8;">
                  © 2026 ILBI Platform. Barcha huquqlar himoyalangan.
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
    """

    logger.info("Password reset email attempt: user_id=%s purpose=%s", user.id, purpose)

    try:
        sent_count = send_mail(
            subject=subject,
            message=plain_message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            html_message=html_message,
            fail_silently=False,
        )
        if sent_count != 1:
            logger.error("Email delivery was not accepted: user_id=%s purpose=%s", user.id, purpose)
            return False
        logger.info("Email muvaffaqiyatli jo'natildi: user_id=%s (purpose=%s)", user.id, purpose)
        return True
    except Exception as exc:
        logger.error("Email jo'natishda xatolik yuz berdi: user_id=%s error=%s", user.id, type(exc).__name__)
        return False


@transaction.atomic
def _request_password_reset_for_user(
    user, purpose: str, extra_context: dict | None = None,
) -> tuple[bool, str, str | None]:
    """Send a setup link to this exact account, without an ambiguous e-mail lookup."""
    user = User.objects.select_for_update().get(pk=user.pk)
    if user.role not in ("staff", "owner", "platform_admin"):
        return False, "invalid_user", None
    if not user.is_active or DemoAccessService.is_blocked(user):
        return False, "inactive_user", None
    if user.role != "platform_admin" and not Employee.objects.filter(
        user=user, is_active=True
    ).exists():
        return False, "inactive_user", None

    if not user.email:
        return False, "no_email", None

    if is_in_cooldown(user.id):
        return False, "cooldown", None

    # Smart auto-detection of email purpose if caller left as 'auto'
    resolved_purpose = purpose
    if resolved_purpose == "auto":
        if not user.has_usable_password():
            if user.role == "owner":
                resolved_purpose = "new_owner"
            elif user.role == "staff":
                resolved_purpose = "new_employee"
            else:
                resolved_purpose = "reset_password"
        else:
            resolved_purpose = "reset_password"

    token = generate_reset_token()
    store_reset_token(
        token,
        user.id,
        purpose=resolved_purpose,
        extra_context=extra_context,
    )

    sent = send_password_reset_email(
        user,
        token,
        purpose=resolved_purpose,
        extra_context=extra_context,
    )
    if not sent:
        # A failed attempt must not consume the resend cooldown.
        redis_client.delete(_token_key(token), _cooldown_key(user.id))
        redis_client.srem(_invitation_index_key(user.id), _token_key(token))
        return False, "email_send_failed", None

    return True, "sent", mask_email(user.email)


def request_password_reset_for_user(
    user_id: int, purpose: str = "auto", extra_context: dict | None = None,
) -> tuple[bool, str]:
    """Internal invitation path: target the account by ID, not by a shared e-mail."""
    user = User.objects.filter(pk=user_id).first()
    if user is None:
        return False, "user_not_found"
    ok, reason, _ = _request_password_reset_for_user(user, purpose, extra_context)
    return ok, reason


def request_password_reset(
    email: str = "",
    identifier: str = "",
    return_hint: bool = False,
    purpose: str = "auto",
    extra_context: dict | None = None,
) -> tuple[bool, str] | tuple[bool, str, str | None]:
    """Public reset lookup; unknown accounts get a generic success response."""
    ident = (identifier or email or "").strip()
    if not ident:
        if return_hint:
            return False, "identifier_required", None
        return False, "email_required"

    user = User.objects.filter(
        Q(email__iexact=ident) | Q(username__iexact=ident) | Q(phone_number=ident)
    ).first()
    if user is None:
        if return_hint:
            return True, "sent", None
        return True, "sent"

    ok, reason, email_hint = _request_password_reset_for_user(user, purpose, extra_context)
    # Preserve the generic public response for accounts without an active role.
    if reason in ("invalid_user", "inactive_user"):
        ok, reason, email_hint = True, "sent", None
    if return_hint:
        return ok, reason, email_hint
    return ok, reason


def request_password_reset_with_hint(
    identifier: str,
    purpose: str = "reset_password",
    extra_context: dict | None = None,
) -> tuple[bool, str, str | None]:
    """Helper returning (ok, reason, email_hint) for API views."""
    return request_password_reset(
        identifier=identifier,
        return_hint=True,
        purpose=purpose,
        extra_context=extra_context,
    )


@transaction.atomic
def change_password_with_old(login: str, old_password: str, new_password: str) -> tuple[bool, str, User | None]:
    """
    Change password by providing valid old_password when email reset is not accessible.
    Validates user credentials, new password policy, updates password and token_version,
    and logs audit trail.
    """
    if not login or not old_password or not new_password:
        return False, "Barcha maydonlar to‘ldirilishi shart.", None

    if len(new_password) < 8:
        return False, "Yangi parol kamida 8 ta belgidan iborat bo‘lishi kerak.", None

    if old_password == new_password:
        return False, "Yangi parol joriy paroldan farq qilishi kerak.", None

    ident = login.strip()
    user = User.objects.select_for_update().filter(
        Q(username__iexact=ident) | Q(phone_number=ident) | Q(email__iexact=ident)
    ).first()

    if (
        user is None
        or not user.is_active
        or DemoAccessService.is_blocked(user)
        or not user.check_password(old_password)
    ):
        return False, "Login yoki eski parol noto‘g‘ri.", None

    if user.role not in ("staff", "owner", "platform_admin"):
        return False, "Ruxsat etilmagan foydalanuvchi.", None

    if user.role != "platform_admin" and not Employee.objects.filter(
        user=user, is_active=True
    ).exists():
        return False, "Foydalanuvchi faol emas.", None

    try:
        validate_password(new_password, user)
    except ValidationError as exc:
        return False, " ".join(exc.messages), None
    user.set_password(new_password)
    user.token_version = getattr(user, 'token_version', 1) + 1
    user.save(update_fields=["password", "token_version"])

    try:
        from apps.core.models import AuditAction
        from apps.core.services.audit_service import AuditService
        AuditService.log(
            action=AuditAction.PASSWORD_RESET,
            actor=user,
            tenant=getattr(user, 'tenant', None),
            target_model="User",
            target_id=str(user.id),
            changes={"token_version": user.token_version},
            description=f"User {user.username or user.phone_number} changed password via old password verification",
        )
    except Exception:
        pass

    return True, "Parolingiz muvaffaqiyatli yangilandi! Endi yangi parol bilan kirishingiz mumkin.", user


@transaction.atomic
def confirm_password_reset(
    token: str, new_password: str, username: str = ""
) -> tuple[bool, str, User | None]:
    """
    Set the password once. Invitation links then become resume-only until OTP
    login succeeds or the original 24-hour deadline expires.
    """
    if not token or not new_password:
        return False, "missing_fields", None

    lock_key = f"pwd_reset_lock:{hashlib.sha256(token.encode()).hexdigest()}"
    with redis_client.lock(lock_key, timeout=30, blocking_timeout=5):
        key, payload = _read_token(token)
        if not payload or redis_client.ttl(key) <= 0:
            return False, "invalid_or_expired_token", None
        if payload.get("phase") == "pending_2fa":
            return False, "setup_already_started", None

        user = User.objects.select_for_update().filter(id=payload.get("user_id")).first()
        if not _eligible_user(user):
            return False, "invalid_or_expired_token", None
        # A directory edit may revoke this link while the account row was locked.
        key, payload = _read_token(token)
        if not payload or payload.get("account_version") not in (None, user.token_version):
            return False, "invalid_or_expired_token", None

        cleaned_username = username.strip() if username else ""
        if cleaned_username and User.objects.filter(
            username__iexact=cleaned_username
        ).exclude(id=user.id).exists():
            return False, "username_taken", None

        if cleaned_username:
            user.username = cleaned_username
        try:
            validate_password(new_password, user)
        except ValidationError as exc:
            return False, " ".join(exc.messages), None
        user.set_password(new_password)
        user.token_version = getattr(user, "token_version", 1) + 1
        try:
            user.save()
        except IntegrityError:
            return False, "username_taken", None

        if payload.get("purpose") in INVITE_PURPOSES:
            # Reuse the *remaining* TTL. A page refresh after password setup
            # can obtain a fresh login ticket but cannot choose another password.
            ttl = max(redis_client.ttl(key), 1)
            payload["phase"] = "pending_2fa"
            payload["password_version"] = user.token_version
            canonical_key = _token_key(token)
            index_key = _invitation_index_key(user.id)
            pipe = redis_client.pipeline()
            pipe.set(canonical_key, json.dumps(payload), ex=ttl)
            if key != canonical_key:
                pipe.delete(key)
            pipe.sadd(index_key, canonical_key)
            pipe.expire(index_key, max(redis_client.ttl(index_key), ttl))
            pipe.execute()
        else:
            redis_client.delete(key)

    from apps.core.models import AuditAction
    from apps.core.services.audit_service import AuditService
    AuditService.log(
        action=AuditAction.PASSWORD_RESET,
        actor=user,
        tenant=getattr(user, "tenant", None),
        target_model="User",
        target_id=str(user.id),
        changes={"token_version": user.token_version},
        description=f"Password reset for user {user.phone_number or user.username or user.id}",
    )

    # Clear throttle lock if user was previously banned/throttled on login
    if user.username:
        login_throttle.register_success(user.username)

    return True, "success", user
