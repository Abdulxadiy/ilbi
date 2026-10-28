"""A password may reuse this browser's second factor until its fixed 24-hour deadline."""

from django.core import signing
from django.utils import timezone
from rest_framework.exceptions import AuthenticationFailed

WINDOW = 24 * 60 * 60
COOKIE_PREFIX = "ilbi_mfa_"
SALT = "ilbi-daily-second-factor-v1"


def cookie_name(user):
    return COOKIE_PREFIX + str(user.pk)


def verified_at(token, *, required=False):
    start = token.get("mfa_verified_at") if token else None
    end = token.get("mfa_expires_at") if token else None
    if start is None and end is None and not required:
        return None
    now = timezone.now().timestamp()
    if type(start) is not int or type(end) is not int or end != start + WINDOW or not start <= now < end:
        raise AuthenticationFailed(
            "24 soatlik tasdiqlash muddati tugadi. Telegram kodi bilan qayta tasdiqlang.", code="mfa_required"
        )
    return start


def browser_verified_at(request, user):
    value = request.COOKIES.get(cookie_name(user), "")
    try:
        proof = signing.loads(value, salt=SALT, max_age=WINDOW)
        if proof.get("user") != user.pk or proof.get("version") != user.token_version:
            return None
        return verified_at(proof, required=True)
    except (signing.BadSignature, TypeError, ValueError, AttributeError, AuthenticationFailed):
        return None


def remember_browser(response, user, start):
    proof = signing.dumps(
        {"user": user.pk, "version": user.token_version, "mfa_verified_at": start, "mfa_expires_at": start + WINDOW},
        salt=SALT,
    )
    response.set_cookie(
        cookie_name(user), proof, max_age=WINDOW, secure=True, httponly=True, samesite="Lax", path="/api/v1/auth/"
    )
    return response
