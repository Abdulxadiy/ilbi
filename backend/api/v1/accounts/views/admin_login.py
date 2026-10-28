from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema

"""
Admin-panel login for staff / owner / platform_admin: username + password,
Telegram contact gate, then an OTP as a second factor. Separate from the customer
phone-OTP login in login.py -- different audience, different
security requirements.
"""

from apps.accounts.services import login_throttle, login_ticket_service, otp_services, password_reset_service
from apps.accounts.services.demo_access_service import DemoAccessService
from apps.accounts.services.phone_utils import mask_phone_number
from django.contrib.auth import get_user_model
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from api.v1.accounts.serializers import (
    AdminLoginSerializer,
    AdminLoginTicketSerializer,
    AdminLoginVerifyOTPSerializer,
)
from api.v1.accounts.views.misc import (
    get_current_telegram_contact,
    get_telegram_contact_or_error,
    issue_tokens,
    send_otp_or_error,
)

User = get_user_model()


def _bad_credentials():
    return Response(
        {"detail": "Username or password incorrect!"},
        status=status.HTTP_401_UNAUTHORIZED,

    )


def _bad_otp():
    return Response(
        {"detail": "Verification code incorrect!"},
        status=status.HTTP_401_UNAUTHORIZED,
    )


def _bad_ticket():
    return Response(
        {
            "error": "invalid_or_expired_login_ticket",
            "detail": "Kirish muddati tugagan. Login va parolni qayta kiriting.",
        },
        status=status.HTTP_401_UNAUTHORIZED,
    )


def _blocked(second_remining: int):
    return Response(
        {
            "detail": (
                "Too many failed attempts from this device. Access to"
                "this platform has been blocked. Contact the"
                "administrator to restore access."
            ),
            "retry_after_seconds": second_remining,
        },
        status=status.HTTP_429_TOO_MANY_REQUESTS,
    )


class AdminLoginView(APIView):
    """POST /api/v1/accounts/auth/admin-login/ {username, password}"""
    permission_classes = [AllowAny]

    @extend_schema(request=AdminLoginSerializer, responses={200: OpenApiTypes.OBJECT})
    def post(self, request):
        serializer = AdminLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        username = serializer.validated_data['username']
        password = serializer.validated_data['password']

        locked, remining =login_throttle.is_locked(username)
        if locked:
            return _blocked(remining)
        user = User.objects.filter(
            Q(username=username) | Q(phone_number=username) | Q(email=username)
        ).first()

        if user is None or not user.check_password(password):
            login_throttle.register_failure(username)
            return _bad_credentials()

        if DemoAccessService.is_blocked(user):
            return _bad_credentials()

        if user.role not in ("staff", "owner", "platform_admin"):
            # Shouldn't happen structurally (customers never get a
            # username), but stay defensive rather than silently allow it.
            login_throttle.register_failure(username)
            return _bad_credentials()

        if not user.is_active:
            locked, remining = login_throttle.is_locked(username)
            return _blocked(remining if locked else 0)

        if DemoAccessService.enabled_for(user):
            if not DemoAccessService.has_active_access(user):
                return Response(
                    {"detail": "Faol do‘kon yoki xodim vakolati topilmadi."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            login_throttle.register_success(username)
            return Response({**issue_tokens(user), "demo_login": True}, status=status.HTTP_200_OK)

        from apps.accounts.services.daily_mfa import browser_verified_at

        verified = browser_verified_at(request, user)
        if verified is not None and get_current_telegram_contact(user.phone_number) is not None:
            login_throttle.register_success(username)
            return Response({**issue_tokens(user, mfa_verified_at=verified), "password_login": True}, status=status.HTTP_200_OK)

        return Response(
            {
                "detail": "Parol tasdiqlandi. Telegram botga ulanishni tekshiring.",
                "login_ticket": login_ticket_service.create_ticket(user, username),
                "telegram_linked": get_current_telegram_contact(user.phone_number) is not None,
                "phone_hint": mask_phone_number(user.phone_number),
            },
            status=status.HTTP_200_OK,
        )


class AdminLoginTelegramStatusView(APIView):
    """Check whether the verified user's phone was registered by the current bot."""
    permission_classes = [AllowAny]

    @extend_schema(request=AdminLoginTicketSerializer, responses={200: OpenApiTypes.OBJECT})
    def post(self, request):
        serializer = AdminLoginTicketSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        resolved = login_ticket_service.resolve_ticket(serializer.validated_data["login_ticket"])
        if resolved is None:
            return _bad_ticket()
        user, _identifier = resolved
        return Response({
            "telegram_linked": get_current_telegram_contact(user.phone_number) is not None,
            "phone_hint": mask_phone_number(user.phone_number),
        })


class AdminLoginSendOTPView(APIView):
    """Send an OTP only after password proof and current-bot contact binding."""
    permission_classes = [AllowAny]

    @extend_schema(request=AdminLoginTicketSerializer, responses={200: OpenApiTypes.OBJECT})
    def post(self, request):
        serializer = AdminLoginTicketSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ticket = serializer.validated_data["login_ticket"]
        resolved = login_ticket_service.resolve_ticket(ticket)
        if resolved is None:
            return _bad_ticket()
        user, login_identifier = resolved
        locked, remaining = login_throttle.is_locked(login_identifier)
        if locked:
            return _blocked(remaining)

        contact, error = get_telegram_contact_or_error(user.phone_number)
        if error:
            return error
        error = send_otp_or_error(user.phone_number, contact)
        if error:
            return error
        login_ticket_service.mark_otp_sent(ticket)
        return Response({
            "detail": "Tasdiqlash kodi Telegram orqali yuborildi.",
            "otp_sent": True,
            "phone_hint": mask_phone_number(user.phone_number),
        })


class AdminLoginVerifyOTPView(APIView):
    """POST /api/v1/auth/admin-login/verify-otp/ {login_ticket, verification_code}"""
    permission_classes = [AllowAny]

    @extend_schema(request=AdminLoginVerifyOTPSerializer, responses={200: OpenApiTypes.OBJECT})
    def post(self, request):
        serializer = AdminLoginVerifyOTPSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ticket = serializer.validated_data['login_ticket']
        code = serializer.validated_data['verification_code']

        resolved = login_ticket_service.resolve_ticket(ticket)
        if resolved is None:
            return _bad_ticket()
        user, username = resolved

        locked, remining = login_throttle.is_locked(username)
        if locked:
            return _blocked(remining)

        if not login_ticket_service.was_otp_sent(ticket):
            return Response(
                {"error": "otp_not_requested", "detail": "Avval Telegram tasdiqlash kodini so‘rang."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        is_valid, reason = otp_services.verify_code(user.phone_number, code)
        if not is_valid:
            if reason == "Too many attempts":
                login_ticket_service.consume_ticket(ticket)
            login_throttle.register_failure(username)
            return _bad_otp()

        if not login_ticket_service.consume_ticket(ticket):
            return _bad_ticket()
        password_reset_service.complete_pending_invitations(user.id)
        login_throttle.register_success(username)
        from apps.accounts.services.daily_mfa import remember_browser

        verified = int(timezone.now().timestamp())
        return remember_browser(Response(issue_tokens(user, mfa_verified_at=verified), status=status.HTTP_200_OK), user, verified)
