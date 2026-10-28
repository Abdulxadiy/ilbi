from django.db import transaction
from django.db.models import F, Q
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from api.pagination import StandardResultsSetPagination
from api.permissions import IsPlatformAdmin
from apps.accounts.models import User
from apps.accounts.services import login_throttle
from apps.accounts.services.password_reset_service import invalidate_password_links
from apps.accounts.services.platform_accounts import log_platform_action, recover_identity, verify_admin
from apps.core.models import AuditAction, AuditLog
from apps.support.models import Conversation, Message
from apps.tenants.models import SellerProfile, Tenant
from apps.tg_bot.identity import current_bot_id, is_private_chat_id
from apps.tg_bot.models import TelegramContact


class RecoveryInput(serializers.Serializer):
    phone_number = serializers.RegexField(r"^\+[1-9][0-9]{7,14}$")
    expected_phone_number = serializers.CharField(max_length=20)
    expected_version = serializers.IntegerField(min_value=0)
    telegram_action = serializers.ChoiceField(choices=["replace", "unlink"])
    telegram_chat_id = serializers.CharField(max_length=100, allow_blank=True, required=False)
    admin_password = serializers.CharField(write_only=True, trim_whitespace=False)
    reason = serializers.CharField(min_length=5, max_length=500)
    ownership_verified = serializers.BooleanField()

    def validate(self, attrs):
        if not attrs["ownership_verified"]:
            raise serializers.ValidationError({"ownership_verified": "Avval hisob egasini tekshiring."})
        if attrs["telegram_action"] == "replace" and not is_private_chat_id(attrs.get("telegram_chat_id")):
            raise serializers.ValidationError({"telegram_chat_id": "Shaxsiy Telegram chat ID kiriting."})
        return attrs


class PlatformWriteThrottle(SimpleRateThrottle):
    scope = "platform_security"

    def get_rate(self):
        return "10/min"

    def get_cache_key(self, request, view):
        if request.method in ("GET", "HEAD", "OPTIONS") or not request.user.is_authenticated:
            return None
        return self.cache_format % {"scope": self.scope, "ident": request.user.pk}


def account_data(user, contacts=None):
    contact = (
        contacts.get(user.phone_number)
        if contacts is not None
        else TelegramContact.objects.filter(phone_number=user.phone_number).first()
    )
    linked = bool(contact and contact.bot_id == current_bot_id() and is_private_chat_id(contact.chat_id))
    return {
        "id": user.pk,
        "name": user.get_full_name(),
        "username": user.username,
        "phone_number": user.phone_number,
        "email": user.email,
        "role": user.role,
        "is_active": user.is_active,
        "created_at": user.created_at,
        "security_version": user.token_version,
        "telegram_chat_id": contact.chat_id if linked else "",
        "telegram_linked": linked,
        "memberships": [
            {"id": row.tenant_id, "name": row.tenant.name, "is_owner": row.is_owner, "is_active": row.is_active}
            for row in user.employments.all()
        ],
    }


class PlatformAccountsView(APIView):
    permission_classes = [IsPlatformAdmin]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        rows = User.objects.prefetch_related("employments__tenant").order_by("-created_at", "-pk")
        search = request.query_params.get("search", "").strip()[:100]
        if search:
            rows = rows.filter(
                Q(phone_number__icontains=search)
                | Q(username__icontains=search)
                | Q(first_name__icontains=search)
                | Q(last_name__icontains=search)
                | Q(email__icontains=search)
            )
        role = request.query_params.get("role")
        if role:
            if role not in dict(User.ROLE_CHOICES):
                raise ValidationError({"role": "Hisob turi noto‘g‘ri."})
            rows = rows.filter(role=role)
        active = request.query_params.get("active", "")
        if active:
            if active not in ("true", "false"):
                raise ValidationError({"active": "Holat noto‘g‘ri."})
            rows = rows.filter(is_active=active == "true")
        paginator = StandardResultsSetPagination()
        page = paginator.paginate_queryset(rows, request, view=self)
        contacts = {
            row.phone_number: row
            for row in TelegramContact.objects.filter(phone_number__in=[user.phone_number for user in page])
        }
        return paginator.get_paginated_response([account_data(user, contacts) for user in page])


class PlatformIdentityView(APIView):
    permission_classes = [IsPlatformAdmin]
    throttle_classes = [PlatformWriteThrottle]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request, pk):
        return Response(account_data(get_object_or_404(User, pk=pk)))

    @extend_schema(request=RecoveryInput, responses=OpenApiTypes.OBJECT)
    def post(self, request, pk):
        get_object_or_404(User, pk=pk)
        serializer = RecoveryInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = recover_identity(actor=request.user, user_id=pk, values=serializer.validated_data, request=request)
        return Response(
            {**account_data(user), "detail": "Login va Telegram yangilandi. Eski sessiyalar bekor qilindi."}
        )


class AccountStatusInput(serializers.Serializer):
    blocked = serializers.BooleanField()
    admin_password = serializers.CharField(write_only=True, trim_whitespace=False)
    reason = serializers.CharField(min_length=5, max_length=500)


class PlatformAccountStatusView(APIView):
    permission_classes = [IsPlatformAdmin]
    throttle_classes = [PlatformWriteThrottle]

    @extend_schema(request=AccountStatusInput, responses=OpenApiTypes.OBJECT)
    def post(self, request, pk):
        serializer = AccountStatusInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            rows = {
                row.pk: row
                for row in User.objects.select_for_update()
                .filter(
                    pk__in=[pk, request.user.pk],
                )
                .order_by("pk")
            }
            actor = rows[request.user.pk]
            verify_admin(actor, data["admin_password"])
            if actor.token_version != request.user.token_version:
                raise ValidationError({"detail": "Sessiya o‘zgargan. Qayta kiring."})
            user = get_object_or_404(User, pk=pk)
            if user.role == "platform_admin":
                raise ValidationError({"detail": "Platforma administratorini bu oynadan bloklab bo‘lmaydi."})
            if user.is_active == data["blocked"]:
                invalidate_password_links(user.pk)
                user.is_active = not data["blocked"]
                user.token_version += 1
                user.save(update_fields=["is_active", "token_version"])
                if user.is_active:
                    login_throttle.register_success(user.phone_number)
                log_platform_action(
                    actor=actor,
                    action=AuditAction.EMPLOYEE_BLOCK if data["blocked"] else AuditAction.EMPLOYEE_UNBLOCK,
                    target_model="User",
                    target_id=str(pk),
                    changes={"reason": data["reason"], "blocked": data["blocked"]},
                    request=request,
                )
        return Response(account_data(user))


class PlatformSupportUnreadView(APIView):
    permission_classes = [IsPlatformAdmin]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        unread = (
            Message.objects.filter(sender="visitor", id__gt=F("conversation__operator_read_id"))
            .exclude(
                conversation__status="closed",
            )
            .count()
        )
        return Response({"unread": unread})


class PlatformOverviewView(APIView):
    permission_classes = [IsPlatformAdmin]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        counts = {
            "accounts": User.objects.count(),
            "blocked_accounts": User.objects.filter(is_active=False).count(),
            "tenants": Tenant.objects.count(),
            "active_tenants": Tenant.objects.filter(is_active=True).count(),
            "support_waiting": Conversation.objects.filter(status="waiting").count(),
            "support_active": Conversation.objects.filter(status="active").count(),
            "seller_pending": SellerProfile.objects.filter(status="pending").count(),
        }
        recent = AuditLog.objects.select_related("actor").order_by("-created_at", "-pk")[:8]
        return Response(
            {
                "counts": counts,
                "telegram_configured": bool(current_bot_id()),
                "activity": [
                    {
                        "id": row.pk,
                        "action": row.get_action_display(),
                        "actor": row.actor.get_full_name() if row.actor else "Tizim",
                        "description": row.description,
                        "created_at": row.created_at,
                    }
                    for row in recent
                ],
            }
        )
