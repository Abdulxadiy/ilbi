import hashlib
import logging
import re
from ipaddress import ip_address

from django.conf import settings
from django.core.cache import caches
from django.db import ProgrammingError, transaction
from django.db.models import Count, F, Q, Sum
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from api.pagination import StandardResultsSetPagination
from api.permissions import IsPlatformAdmin
from apps.accounts.services.tenant_context_service import resolve_active_context
from apps.support.models import Conversation, Message
from apps.support.tasks import enqueue_notification
from apps.support.notifications import notify_support_message, mark_support_read, suppress_unassigned_operator_alerts

from .serializers import (
    ConversationPageSerializer,
    ConversationSerializer,
    CustomerProfileSerializer,
    CustomerProfileUpdateSerializer,
    MessageSerializer,
    MessagePageSerializer,
    SendSerializer,
    StartSerializer,
    SupportMetadataSerializer,
)

logger = logging.getLogger(__name__)


class SupportThrottle(SimpleRateThrottle):
    scope = "support"

    @property
    def cache(self):
        return caches["support"]

    def get_rate(self):
        return "120/min"

    def get_ident(self, request):
        # Both project Nginx configs append the actual client address. Do not
        # include a client-supplied XFF prefix in the rate-limit identity.
        forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
        candidate = forwarded.split(",")[-1].strip() if forwarded else request.META.get("REMOTE_ADDR", "")
        try:
            return str(ip_address(candidate))
        except ValueError:
            return request.META.get("REMOTE_ADDR", "unknown")

    def get_cache_key(self, request, view):
        ident = f"user:{request.user.pk}" if request.user.is_authenticated else self.get_ident(request)
        return self.cache_format % {"scope": self.scope, "ident": ident}


class SupportWriteThrottle(SupportThrottle):
    scope = "support_write"

    def get_rate(self):
        return "20/min"

    def allow_request(self, request, view):
        return True if request.method in ("GET", "HEAD", "OPTIONS") else super().allow_request(request, view)


def is_operator(request):
    return request.user.is_authenticated and request.user.role == "platform_admin"


def guest_hash(request):
    token = request.headers.get("X-Support-Token", "")
    if not re.fullmatch(r"[a-f0-9]{64}", token):
        raise PermissionDenied("A private support browser key is required.")
    return hashlib.sha256(token.encode()).hexdigest()


def accessible(request, *, inbox=False):
    queryset = Conversation.objects.select_related("operator")
    if inbox:
        if not is_operator(request):
            raise PermissionDenied()
        return queryset
    if request.user.is_authenticated:
        return queryset.filter(user=request.user)
    return queryset.filter(user__isnull=True, guest_hash=guest_hash(request))


def with_unread(queryset, operator):
    return queryset.annotate(
        unread_count=Count(
            "messages",
            filter=Q(
                messages__sender="visitor" if operator else "operator",
                messages__id__gt=F("operator_read_id" if operator else "visitor_read_id"),
            ),
        )
    ).order_by("-updated_at", "id")


class SupportView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [SupportThrottle, SupportWriteThrottle]

    def handle_exception(self, exc):
        # A development code reload does not apply new migrations. Keep this
        # failure recoverable without hiding unrelated SQL/programming errors.
        driver_error = getattr(exc, "__cause__", None)
        missing_table = getattr(driver_error, "pgcode", None) == "42P01"
        support_table = any(f'"{table}"' in str(exc) for table in ("support_conversation", "support_message"))
        if isinstance(exc, ProgrammingError) and missing_table and support_table:
            logger.error("Support tables are missing; apply the support migrations before serving chat requests.")
            return Response(
                {
                    "error": {
                        "code": "support_not_ready",
                        "message": "Support is temporarily unavailable. Try again shortly.",
                    }
                },
                status=503,
                headers={"Retry-After": "30"},
            )
        return super().handle_exception(exc)

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "no-store"
        response["Vary"] = "Authorization, X-Support-Token"
        return response


@extend_schema_view(get=extend_schema(responses=SupportMetadataSerializer))
class MetadataView(SupportView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        return Response(
            {
                "phone": settings.SUPPORT_PHONE,
                "telegram_username": settings.SUPPORT_TELEGRAM_USERNAME,
                "languages": ["uz"],
                "ai_enabled": False,
                "max_image_bytes": 2 * 1024 * 1024,
            }
        )


@extend_schema_view(
    get=extend_schema(responses=ConversationPageSerializer),
    post=extend_schema(request=StartSerializer, responses={200: ConversationSerializer, 201: ConversationSerializer}),
)
class ConversationsView(SupportView):
    def get(self, request):
        queryset = with_unread(accessible(request), False)
        paginator = StandardResultsSetPagination()
        page = paginator.paginate_queryset(queryset, request)
        response = paginator.get_paginated_response(ConversationSerializer(page, many=True).data)
        response.data["unread_total"] = queryset.aggregate(total=Sum("unread_count"))["total"] or 0
        return response

    @transaction.atomic
    def post(self, request):
        data = StartSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        values = data.validated_data
        if request.user.is_authenticated:
            # Serialize concurrent copies of the authenticated start request.
            # No-key locking still permits normal FK references to this user.
            from apps.accounts.models import User
            User.objects.select_for_update(no_key=True).get(pk=request.user.pk)
        existing = accessible(request).filter(messages__client_id=values["client_id"]).first()
        if existing:
            return Response(ConversationSerializer(existing).data)
        if accessible(request).exclude(status="closed").count() >= 5:
            raise ValidationError("Please use one of your existing open conversations (limit: 5).")
        tenant = None
        if request.user.is_authenticated and request.headers.get("X-Tenant-ID"):
            tenant = resolve_active_context(request.user, request.headers.get("X-Tenant-ID")).tenant
        conversation = Conversation.objects.create(
            user=request.user if request.user.is_authenticated else None,
            guest_hash="" if request.user.is_authenticated else guest_hash(request),
            tenant=tenant,
            name=values["name"],
            subject=values["subject"],
            language=values["language"],
        )
        message = Message.objects.create(
            conversation=conversation,
            sender="visitor",
            author=request.user if request.user.is_authenticated else None,
            client_id=values["client_id"],
            text=values.get("text", ""),
            image_data=values.get("image"),
            has_image=bool(values.get("image")),
            voice_data=values.get("voice"),
            has_voice=bool(values.get("voice")),
            voice_duration=values.get("voice_duration", 0),
            sticker=values.get("sticker", ""),
        )
        notify_support_message(message)
        transaction.on_commit(lambda: enqueue_notification(conversation.pk))
        return Response(ConversationSerializer(conversation).data, status=201)


class GuestConversationsView(ConversationsView):
    authentication_classes = []
    permission_classes = [AllowAny]


@extend_schema_view(get=extend_schema(responses=ConversationPageSerializer))
class InboxView(SupportView):
    permission_classes = [IsPlatformAdmin]

    def get(self, request):
        queryset = with_unread(accessible(request, inbox=True), True)
        status = request.query_params.get("status")
        if status:
            if status not in Conversation.Status.values:
                raise ValidationError("Unknown status.")
            queryset = queryset.filter(status=status)
        if request.query_params.get("mine") == "true":
            queryset = queryset.filter(operator=request.user)
        paginator = StandardResultsSetPagination()
        page = paginator.paginate_queryset(queryset, request)
        response = paginator.get_paginated_response(ConversationSerializer(page, many=True).data)
        response.data["unread_total"] = queryset.aggregate(total=Sum("unread_count"))["total"] or 0
        return response


@extend_schema_view(
    get=extend_schema(responses=ConversationSerializer),
    post=extend_schema(request=OpenApiTypes.OBJECT, responses=ConversationSerializer),
)
class ConversationView(SupportView):
    inbox = False

    def get_conversation(self, request, pk, lock=False):
        queryset = accessible(request, inbox=self.inbox)
        if lock:
            queryset = queryset.select_for_update(of=("self",))
        return get_object_or_404(queryset, pk=pk)

    def get(self, request, pk):
        conversation = self.get_conversation(request, pk)
        return Response(
            ConversationSerializer(
                with_unread(
                    Conversation.objects.select_related("operator").filter(pk=conversation.pk),
                    self.inbox,
                ).get()
            ).data
        )

    @transaction.atomic
    def post(self, request, pk):
        conversation = self.get_conversation(request, pk, lock=True)
        action = request.data.get("action")
        if action == "read":
            field = serializers.IntegerField(min_value=0)
            through = field.run_validation(request.data.get("through_id"))
            latest = conversation.messages.order_by("-id").values_list("id", flat=True).first() or 0
            key = "operator_read_id" if self.inbox else "visitor_read_id"
            setattr(conversation, key, max(getattr(conversation, key), min(through, latest)))
            conversation.save(update_fields=[key])
            if through >= latest:
                mark_support_read(conversation, request.user if request.user.is_authenticated else None)
            return Response({"ok": True})
        if action == "claim" and self.inbox:
            if conversation.status == "closed":
                raise ValidationError("Reopen the conversation first.")
            if conversation.operator_id not in (None, request.user.pk):
                return Response({"detail": "Another operator has accepted this conversation."}, status=409)
            if conversation.status == "active" and conversation.operator_id == request.user.pk:
                return Response(ConversationSerializer(conversation).data)
            conversation.operator = request.user
            conversation.status = "active"
        elif action == "close":
            if self.inbox and conversation.operator_id not in (None, request.user.pk):
                return Response({"detail": "This conversation belongs to another operator."}, status=409)
            if conversation.status == "closed":
                return Response(ConversationSerializer(conversation).data)
            conversation.status = "closed"
        elif action == "reopen" and conversation.status == "closed":
            conversation.status = "waiting"
            conversation.operator = None
            transaction.on_commit(lambda: enqueue_notification(conversation.pk))
        else:
            raise ValidationError("Unknown action or invalid conversation state.")
        conversation.save(update_fields=["operator", "status", "updated_at"])
        if action in {'claim', 'close'}:
            suppress_unassigned_operator_alerts(conversation)
        Message.objects.create(
            conversation=conversation,
            sender="system",
            event=action,
            author=request.user if request.user.is_authenticated else None,
        )
        return Response(ConversationSerializer(conversation).data)


class GuestConversationView(ConversationView):
    authentication_classes = []
    permission_classes = [AllowAny]


class OperatorConversationView(ConversationView):
    permission_classes = [IsPlatformAdmin]
    inbox = True


@extend_schema_view(
    get=extend_schema(responses=MessagePageSerializer),
    post=extend_schema(request=SendSerializer, responses={200: MessageSerializer, 201: MessageSerializer}),
)
class MessagesView(ConversationView):
    def get(self, request, pk):
        conversation = self.get_conversation(request, pk)
        queryset = (
            conversation.messages.defer("image_data", "voice_data")
            .select_related("author", "reply_to", "reply_to__author", "reply_to__conversation")
        )
        after = request.query_params.get("after_id")
        before = request.query_params.get("before_id")
        if after and before:
            raise ValidationError("Use either after_id or before_id.")
        if after or before:
            cursor = serializers.IntegerField(min_value=0).run_validation(after or before)
            queryset = queryset.filter(id__gt=cursor) if after else queryset.filter(id__lt=cursor)
        rows = list(queryset.order_by("id" if after else "-id")[:51])
        more = len(rows) > 50
        rows = rows[:50]
        if not after:
            rows.reverse()
        return Response({"results": MessageSerializer(rows, many=True).data, "has_more": more})

    @transaction.atomic
    def post(self, request, pk):
        conversation = self.get_conversation(request, pk, lock=True)
        serializer = SendSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        sender = "operator" if self.inbox else "visitor"
        existing = (
            conversation.messages.filter(client_id=data["client_id"])
            .defer("image_data", "voice_data")
            .select_related("author", "reply_to", "reply_to__author", "reply_to__conversation")
            .first()
        )
        if existing:
            author_id = request.user.pk if request.user.is_authenticated else None
            if existing.sender != sender or existing.author_id != author_id:
                raise ValidationError("Message identifier is already in use.")
            return Response(MessageSerializer(existing).data)
        if conversation.status == "closed":
            raise ValidationError("Reopen the conversation before sending a message.")
        if self.inbox and (conversation.operator_id != request.user.pk or conversation.status != "active"):
            return Response({"detail": "Accept the conversation before replying."}, status=409)

        # Legacy personal threads remain private; bind only an explicitly
        # selected, authenticated visitor store, never an operator's guess.
        if not self.inbox and request.user.is_authenticated and conversation.tenant_id is None and request.headers.get('X-Tenant-ID'):
            conversation.tenant = resolve_active_context(request.user, request.headers.get('X-Tenant-ID')).tenant
            conversation.save(update_fields=['tenant'])

        reply_to = None
        reply_to_id = data.get("reply_to_id")
        if reply_to_id:
            reply_to = (
                conversation.messages.filter(id=reply_to_id)
                .defer("image_data", "voice_data")
                .select_related("author", "conversation")
                .first()
            )

        message = Message.objects.create(
            conversation=conversation,
            sender=sender,
            author=request.user if request.user.is_authenticated else None,
            client_id=data["client_id"],
            text=data.get("text", ""),
            image_data=data.get("image"),
            has_image=bool(data.get("image")),
            voice_data=data.get("voice"),
            has_voice=bool(data.get("voice")),
            voice_duration=data.get("voice_duration", 0),
            sticker=data.get("sticker", ""),
            reply_to=reply_to,
        )
        previous_update = conversation.updated_at
        conversation.updated_at = timezone.now()
        conversation.save(update_fields=["updated_at"])
        notify_support_message(message)
        if not self.inbox and (
            conversation.status == "waiting" or (conversation.updated_at - previous_update).total_seconds() > 60
        ):
            transaction.on_commit(lambda: enqueue_notification(conversation.pk))
        return Response(MessageSerializer(message).data, status=201)


class GuestMessagesView(MessagesView):
    authentication_classes = []
    permission_classes = [AllowAny]


class OperatorMessagesView(MessagesView):
    permission_classes = [IsPlatformAdmin]
    inbox = True


@extend_schema_view(
    get=extend_schema(responses={(200, 'image/jpeg'): OpenApiTypes.BINARY}),
    post=extend_schema(exclude=True),
)
class ImageView(ConversationView):
    def get(self, request, pk, message_id):
        conversation = self.get_conversation(request, pk)
        message = get_object_or_404(conversation.messages, pk=message_id, has_image=True)
        response = HttpResponse(bytes(message.image_data), content_type="image/jpeg")
        response["Content-Disposition"] = 'inline; filename="support-image.jpg"'
        response["X-Content-Type-Options"] = "nosniff"
        return response


class GuestImageView(ImageView):
    authentication_classes = []
    permission_classes = [AllowAny]


class OperatorImageView(ImageView):
    permission_classes = [IsPlatformAdmin]
    inbox = True


@extend_schema_view(
    get=extend_schema(responses={(200, 'audio/webm'): OpenApiTypes.BINARY}),
    post=extend_schema(exclude=True),
)
class VoiceView(ConversationView):
    def get(self, request, pk, message_id):
        conversation = self.get_conversation(request, pk)
        message = get_object_or_404(conversation.messages, pk=message_id, has_voice=True)
        data = bytes(message.voice_data) if message.voice_data else b""
        response = HttpResponse(data, content_type="audio/webm")
        response["Content-Length"] = str(len(data))
        response["Content-Disposition"] = f'inline; filename="voice-{message_id}.webm"'
        response["X-Content-Type-Options"] = "nosniff"
        response["Accept-Ranges"] = "bytes"
        return response


class GuestVoiceView(VoiceView):
    authentication_classes = []
    permission_classes = [AllowAny]


class OperatorVoiceView(VoiceView):
    permission_classes = [IsPlatformAdmin]
    inbox = True


@extend_schema_view(
    get=extend_schema(responses=CustomerProfileSerializer),
    patch=extend_schema(request=CustomerProfileUpdateSerializer, responses=CustomerProfileSerializer),
)
class CustomerProfileView(SupportView):
    permission_classes = [IsPlatformAdmin]

    def _get_conversation(self, pk):
        return get_object_or_404(
            Conversation.objects.select_related(
                "user",
                "tenant",
                "tenant__owner",
                "tenant__seller_profile",
            ),
            pk=pk,
        )

    def _build_profile_data(self, conversation):
        user = conversation.user
        tenant = conversation.tenant
        if not tenant and user:
            tenant = getattr(user, "owned_tenants", None) and user.owned_tenants.first()

        user_data = None
        guest_data = None
        if user:
            user_data = {
                "id": user.id,
                "phone_number": user.phone_number,
                "contact_phone": user.contact_phone or "",
                "username": user.username or "",
                "first_name": user.first_name or "",
                "last_name": user.last_name or "",
                "full_name": user.get_full_name(),
                "email": user.email or "",
                "role": user.role,
                "role_display": user.get_role_display(),
                "is_active": user.is_active,
                "is_staff": user.is_staff,
                "is_phone_verified": user.is_phone_verified,
                "profile_completed": user.profile_completed,
                "created_at": user.created_at,
                "last_login": user.last_login,
            }
        else:
            guest_data = {
                "name": conversation.name,
                "language": conversation.language,
            }

        tenant_data = None
        seller_profile_data = None
        if tenant:
            effective_rate = tenant.effective_usd_rate
            tenant_data = {
                "id": tenant.id,
                "name": tenant.name,
                "public_code": tenant.public_code,
                "address": tenant.address or "",
                "is_active": tenant.is_active,
                "usd_rate": str(effective_rate) if effective_rate is not None else None,
                "auto_usd_rate": tenant.auto_usd_rate,
                "created_at": tenant.created_at,
                "owner_name": tenant.owner.get_full_name() if tenant.owner else "",
                "owner_phone": tenant.owner.phone_number if tenant.owner else "",
            }
            if tenant.seller_profile:
                sp = tenant.seller_profile
                seller_profile_data = {
                    "legal_form": sp.get_legal_form_display(),
                    "official_name": sp.official_name,
                    "tax_identifier": sp.tax_identifier,
                    "status": sp.status,
                    "status_display": sp.get_status_display(),
                }

        from apps.catalog.models import Product
        from apps.sales.models import Sale

        total_convs = (
            Conversation.objects.filter(user=user).count()
            if user
            else (
                Conversation.objects.filter(guest_hash=conversation.guest_hash).count()
                if conversation.guest_hash
                else 1
            )
        )
        total_sales = Sale.objects.filter(tenant=tenant).count() if tenant else 0
        total_products = Product.objects.filter(tenant=tenant).count() if tenant else 0

        return {
            "is_registered": bool(user),
            "user": user_data,
            "guest": guest_data,
            "tenant": tenant_data,
            "seller_profile": seller_profile_data,
            "stats": {
                "total_conversations": total_convs,
                "total_sales": total_sales,
                "total_products": total_products,
            },
        }

    def get(self, request, pk):
        conversation = self._get_conversation(pk)
        data = self._build_profile_data(conversation)
        return Response(CustomerProfileSerializer(data).data)

    @transaction.atomic
    def patch(self, request, pk):
        conversation = self._get_conversation(pk)
        serializer = CustomerProfileUpdateSerializer(data=request.data, context={'profile_user': conversation.user})
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data
        changed_fields = []

        user = conversation.user
        if user:
            user_fields = []
            for field in ("first_name", "last_name", "contact_phone"):
                if field in validated:
                    setattr(user, field, validated[field])
                    user_fields.append(field)
            if user_fields:
                user.save(update_fields=user_fields)
                changed_fields.extend(user_fields)

        tenant = conversation.tenant or (user and getattr(user, "owned_tenants", None) and user.owned_tenants.first())
        if tenant:
            tenant_fields = []
            if "tenant_name" in validated:
                tenant.name = validated["tenant_name"]
                tenant_fields.append('name')
            if "tenant_address" in validated:
                tenant.address = validated["tenant_address"]
                tenant_fields.append('address')
            if tenant_fields:
                tenant.save(update_fields=tenant_fields)
                changed_fields.extend('tenant_' + field for field in tenant_fields)

        if changed_fields:
            from apps.core.models import AuditAction
            from apps.core.services.audit_service import AuditService
            AuditService.log(action=AuditAction.ACCOUNT_IDENTITY_UPDATE, actor=request.user, tenant=tenant,
                target_model='User' if user else 'SupportConversation', target_id=str(user.pk if user else conversation.pk),
                changes={'operation': 'support_contact_update', 'fields': sorted(changed_fields)}, request=request,
                description='Yordam markazida aloqa ma’lumotlari tahrirlandi')

        data = self._build_profile_data(conversation)
        return Response(CustomerProfileSerializer(data).data)
