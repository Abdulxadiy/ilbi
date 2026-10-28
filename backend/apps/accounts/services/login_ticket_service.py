"""Short-lived proof that the password or setup link was verified before Telegram 2FA."""

import hashlib
import json
import secrets

import redis
from django.conf import settings
from django.contrib.auth import get_user_model

from .demo_access_service import DemoAccessService

TICKET_TTL_SECONDS = 30 * 60
OTP_TICKET_TTL_SECONDS = 5 * 60
redis_client = (
    redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
    if getattr(settings, "REDIS_URL", None)
    else None
)


def _ticket_key(ticket: str) -> str:
    return f"admin_login:ticket:{hashlib.sha256(ticket.encode()).hexdigest()}"


def _sent_key(ticket: str) -> str:
    return f"admin_login:ticket_sent:{hashlib.sha256(ticket.encode()).hexdigest()}"


def create_ticket(
    user,
    login_identifier: str | None = None,
    max_ttl_seconds: int | None = None,
    invitation_key: str | None = None,
) -> str:
    ticket = secrets.token_urlsafe(32)
    payload = {
        "user_id": user.id,
        "phone_number": user.phone_number,
        "token_version": getattr(user, "token_version", 1),
        "login_identifier": login_identifier or user.username or user.phone_number,
    }
    if invitation_key:
        payload["invitation_key"] = invitation_key
    ttl = TICKET_TTL_SECONDS if max_ttl_seconds is None else min(TICKET_TTL_SECONDS, max(1, max_ttl_seconds))
    if redis_client:
        redis_client.set(_ticket_key(ticket), json.dumps(payload), ex=ttl)
    return ticket


def resolve_ticket(ticket: str):
    """Return (user, login_identifier) only while the credentials are unchanged."""
    if not redis_client or not ticket or len(ticket) > 128:
        return None
    raw = redis_client.get(_ticket_key(ticket))
    if not raw:
        return None
    try:
        payload = json.loads(raw)
        user = get_user_model().objects.filter(pk=payload["user_id"]).first()
    except (ValueError, TypeError, KeyError):
        return None
    if (
        user is None
        or not user.is_active
        or DemoAccessService.is_blocked(user)
        or user.role not in ("staff", "owner", "platform_admin")
        or user.phone_number != payload.get("phone_number")
        or getattr(user, "token_version", 1) != payload.get("token_version")
    ):
        return None
    invitation_key = payload.get("invitation_key")
    if invitation_key:
        try:
            invitation = json.loads(redis_client.get(invitation_key) or "null")
        except (ValueError, TypeError):
            return None
        if not isinstance(invitation, dict) or (
            invitation.get("user_id") != user.id
            or invitation.get("phase") != "pending_2fa"
            or invitation.get("password_version") != getattr(user, "token_version", 1)
        ):
            return None
    return user, payload.get("login_identifier") or user.username or user.phone_number


def mark_otp_sent(ticket: str) -> None:
    if not redis_client:
        return
    ttl = redis_client.ttl(_ticket_key(ticket))
    if ttl > 0:
        otp_ttl = min(ttl, OTP_TICKET_TTL_SECONDS)
        redis_client.expire(_ticket_key(ticket), otp_ttl)
        redis_client.set(_sent_key(ticket), "1", ex=otp_ttl)


def was_otp_sent(ticket: str) -> bool:
    if not redis_client:
        return False
    return bool(redis_client.exists(_sent_key(ticket)))


def consume_ticket(ticket: str) -> bool:
    """Claim a ticket exactly once, even if two requests arrive concurrently."""
    if not redis_client:
        return False
    claimed = redis_client.getdel(_ticket_key(ticket)) is not None
    redis_client.delete(_sent_key(ticket))
    return claimed
