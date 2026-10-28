from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema

from api.schema import optional_pagination

"""View for tenant creation and management."""

import logging

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.exceptions import APIException
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

User = get_user_model()

from api.mixins import TenantContextMixin
from api.pagination import StandardResultsSetPagination
from api.permissions import (
    HasEmployeePermission,
    IsActiveOwner,
    IsPlatformAdmin,
    IsTenantMember,
    IsTenantOwnerOrPlatformAdmin,
)
from apps.accounts.models import Employee
from apps.accounts.services.password_reset_service import request_password_reset_for_user
from apps.core.models import AuditAction
from apps.core.services.audit_service import AuditService
from apps.tenants.models import SellerProfile, Tenant
from apps.tenants.settings_revision import settings_revision
from apps.accounts.services.permission_service import PermissionService
from apps.tenants.seller_profile_service import SellerProfileService, SellerProfileServiceError
from apps.tenants.services import TenantService, TenantServiceError

from .serializers import (
    SellerProfileBindingSerializer,
    SellerProfileInputSerializer,
    SellerProfileOutputSerializer,
    SellerProfileReviewQueueSerializer,
    SellerProfileReviewSerializer,
    TenantAdminSerializer,
    TenantCompactSerializer,
    TenantChangeOwnerSerializer,
    TenantCreateForOwnerSerializer,
    TenantCreateSerializer,
    TenantMySerializer,
    TenantOwnerSerializer,
    TenantStaffSerializer,
    TenantSettingsSerializer,
)

logger = logging.getLogger(__name__)


class SettingsPreconditionFailed(APIException):
    status_code = 412
    default_code = "settings_conflict"
    default_detail = "Do‘kon sozlamalari boshqa oynada o‘zgardi. Qayta yuklab, o‘zgarishlarni tekshiring."


def _save_tenant_settings_with_audit(serializer, *, request, tenant):
    """Save a tenant edit and its value-free change summary in one transaction."""
    with transaction.atomic():
        locked = Tenant.objects.select_for_update().get(pk=tenant.pk)
        expected_revision = request.headers.get("If-Match")
        if expected_revision is not None and expected_revision != f'"{settings_revision(locked)}"':
            raise SettingsPreconditionFailed()
        fresh = type(serializer)(locked, data=serializer.initial_data, partial=serializer.partial, context=serializer.context)
        fresh.is_valid(raise_exception=True)
        changed_fields = sorted(field for field, value in fresh.validated_data.items() if getattr(locked, field) != value)
        for field, value in fresh.validated_data.items():
            setattr(locked, field, value)
        locked.save(update_fields=list(fresh.validated_data))
        serializer.instance = locked
        if changed_fields:
            AuditService.log(
                action=AuditAction.TENANT_UPDATE, actor=request.user, tenant=locked,
                target_model="Tenant", target_id=str(locked.pk), changes={"fields": changed_fields},
                description=f"Tenant settings updated: {locked.pk}",
            )


def _dispatch_owner_invitation(tenant: Tenant, purpose: str) -> dict[str, str]:
    """Report a safe delivery outcome after the tenant transaction commits."""
    try:
        ok, reason = request_password_reset_for_user(
            tenant.owner_id,
            purpose=purpose,
            extra_context={"tenant_name": tenant.name},
        )
    except Exception as exc:
        logger.error(
            "Owner invitation failed: tenant_id=%s error=%s",
            tenant.pk, type(exc).__name__,
        )
        return {"status": "failed"}

    if ok:
        return {"status": "sent"}
    if reason == "cooldown":
        return {"status": "cooldown"}
    if reason == "no_email":
        return {"status": "missing_email"}
    logger.warning("Owner invitation failed: tenant_id=%s reason=%s", tenant.pk, reason)
    return {"status": "failed"}


class MyTenantsView(APIView):
    permission_classes = [IsActiveOwner]
    throttle_scope = "tenant_create"

    def get_throttles(self):
        return [ScopedRateThrottle()] if self.request.method == "POST" else []

    @extend_schema(request=None, responses={200: TenantMySerializer(many=True)})
    def get(self, request):
        tenants = Tenant.objects.filter(
            owner=request.user,
            is_active=True,
            pk__in=Employee.objects.filter(
                user=request.user, is_owner=True, is_active=True
            ).values("tenant_id"),
        ).distinct().order_by("name", "id")
        return Response(TenantMySerializer(tenants, many=True).data)

    @extend_schema(request=TenantCreateForOwnerSerializer, responses={201: TenantMySerializer})
    def post(self, request):
        serializer = TenantCreateForOwnerSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        try:
            tenant = TenantService.create_for_existing_owner(
                owner=request.user,
                name=values["name"],
                description=values.get("description", ""),
                address=values.get("address", ""),
                copy_settings_from=(
                    values["copy_settings_from"].pk
                    if values.get("copy_settings_from") else None
                ),
                seller_profile=values.get("seller_profile"),
            )
        except TenantServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(TenantMySerializer(tenant).data, status=status.HTTP_201_CREATED)


class SellerProfileListCreateView(APIView):
    permission_classes = [IsActiveOwner]

    @extend_schema(request=None, responses={200: SellerProfileOutputSerializer(many=True)})
    def get(self, request):
        profiles = request.user.seller_profiles.order_by("official_name", "id")
        return Response(SellerProfileOutputSerializer(profiles, many=True).data)

    @extend_schema(request=SellerProfileInputSerializer, responses={201: SellerProfileOutputSerializer})
    def post(self, request):
        serializer = SellerProfileInputSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        try:
            profile = SellerProfileService.submit(owner=request.user, values=serializer.validated_data)
        except SellerProfileServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(SellerProfileOutputSerializer(profile).data, status=status.HTTP_201_CREATED)


class SellerProfileUpdateView(APIView):
    permission_classes = [IsActiveOwner]

    @extend_schema(request=SellerProfileInputSerializer, responses={200: SellerProfileOutputSerializer})
    def patch(self, request, pk):
        try:
            profile = request.user.seller_profiles.get(pk=pk)
        except SellerProfile.DoesNotExist:
            return Response({"detail": "Sotuvchi profili topilmadi."}, status=status.HTTP_404_NOT_FOUND)
        serializer = SellerProfileInputSerializer(
            data=request.data, partial=True, context={"request": request, "profile": profile}
        )
        serializer.is_valid(raise_exception=True)
        values = dict(serializer.validated_data)
        if "tax_identifier" not in values:
            values["tax_identifier"] = profile.tax_identifier
        for field in ("legal_form", "official_name"):
            values.setdefault(field, getattr(profile, field))
        try:
            profile = SellerProfileService.submit(owner=request.user, values=values, profile=profile)
        except SellerProfileServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(SellerProfileOutputSerializer(profile).data)


class SellerProfileReviewView(APIView):
    permission_classes = [IsPlatformAdmin]

    @extend_schema(request=SellerProfileReviewSerializer, responses={200: SellerProfileOutputSerializer})
    def post(self, request, pk):
        profile = get_object_or_404(SellerProfile, pk=pk)
        serializer = SellerProfileReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            profile = SellerProfileService.review(
                profile_id=profile.id,
                reviewed_by=request.user,
                status=serializer.validated_data["status"],
                reason=serializer.validated_data.get("reason", ""),
                expires_at=serializer.validated_data.get("expires_at"),
            )
        except SellerProfileServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(SellerProfileOutputSerializer(profile).data)


class SellerProfileReviewQueueView(APIView):
    """List seller profiles for platform operators without tenant trade data."""

    permission_classes = [IsPlatformAdmin]

    @extend_schema(request=None, responses={200: optional_pagination(SellerProfileReviewQueueSerializer)})
    def get(self, request):
        selected_status = request.query_params.get("status", SellerProfile.STATUS_PENDING)
        valid_statuses = {value for value, _ in SellerProfile.STATUS_CHOICES}
        if selected_status != "all" and selected_status not in valid_statuses:
            return Response(
                {"detail": "Tekshiruv holati noto‘g‘ri."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        search = request.query_params.get("q", "").strip()
        if len(search) > 100:
            return Response(
                {"detail": "Qidiruv matni 100 belgidan oshmasin."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        profiles = SellerProfile.objects.select_related("owner").annotate(
            tenant_count=Count("tenants", distinct=True),
        )
        if selected_status != "all":
            profiles = profiles.filter(status=selected_status)
        if search:
            filters = Q(official_name__icontains=search) | Q(owner__username__icontains=search)
            if search.isdecimal() and len(search) <= 18:
                filters |= Q(pk=int(search))
            profiles = profiles.filter(filters)
        if selected_status == SellerProfile.STATUS_PENDING:
            profiles = profiles.order_by("submitted_at", "id")
        else:
            profiles = profiles.order_by("-updated_at", "-id")

        paginator = StandardResultsSetPagination()
        page = paginator.paginate_queryset(profiles, request, view=self)
        data = SellerProfileReviewQueueSerializer(page, many=True).data
        return paginator.get_paginated_response(data)


class MyTenantSellerProfileView(APIView):
    permission_classes = [IsActiveOwner]

    @extend_schema(request=SellerProfileBindingSerializer, responses={200: TenantMySerializer})
    def patch(self, request, tenant_id):
        serializer = SellerProfileBindingSerializer(
            data=request.data, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        try:
            tenant = TenantService.bind_seller_profile(
                owner=request.user,
                tenant_id=tenant_id,
                seller_profile=serializer.validated_data.get("seller_profile"),
            )
        except TenantServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(TenantMySerializer(tenant).data)


class TenantListCreateView(generics.ListCreateAPIView):
    """
    GET /api/v1/tenants/ -- list all tenants (platform_admin only).
    POST /api/v1/tenants/ -- create a new tenant with its owner (platform_admin only).
    """
    queryset = Tenant.objects.all().select_related('owner').order_by('-id')
    serializer_class = TenantCreateSerializer
    permission_classes = [IsPlatformAdmin]

    def get_serializer_class(self):
        if self.request.method == 'POST':
            return TenantCreateSerializer
        return TenantCompactSerializer if self.request.query_params.get('compact') == 'true' else TenantAdminSerializer

    def get_queryset(self):
        from api.query_params import positive_id
        qs = super().get_queryset()
        params = self.request.query_params
        selected_id = positive_id(params.get('id'), 'id')
        if selected_id:
            qs = qs.filter(pk=selected_id)
        search = (params.get('search') or '').strip()
        if search:
            condition = Q(name__icontains=search) | Q(description__icontains=search) | Q(owner__phone_number__icontains=search)
            condition |= Q(owner__first_name__icontains=search) | Q(owner__last_name__icontains=search)
            if search.isdigit():
                condition |= Q(pk=int(search))
            qs = qs.filter(condition)
        active = params.get('is_active')
        if active in ('true', 'false'):
            qs = qs.filter(is_active=active == 'true')
        if params.get('compact') == 'true':
            qs = qs.select_related(None).only('id', 'name', 'is_active')
        return qs

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        response.data['summary'] = Tenant.objects.aggregate(
            total_count=Count('pk'), active_count=Count('pk', filter=Q(is_active=True)),
            inactive_count=Count('pk', filter=Q(is_active=False)),
        )
        return response

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            tenant = TenantService.create_with_owner(
                name=serializer.validated_data['name'],
                owner_phone_number=serializer.validated_data.get('owner_phone_number'),
                owner_email=serializer.validated_data.get('owner_email'),
                owner_user=serializer.validated_data.get('owner'),
                created_by=request.user,
                description=serializer.validated_data.get('description', ""),
            )
        except TenantServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        response_data = dict(TenantAdminSerializer(tenant).data)
        response_data["owner_invitation"] = _dispatch_owner_invitation(tenant, "new_owner")
        return Response(response_data, status=status.HTTP_201_CREATED)


class TenantResendOwnerInviteView(APIView):
    """Retry the current owner's setup email without recreating the tenant."""

    permission_classes = [IsPlatformAdmin]

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
    def post(self, request, pk):
        tenant = get_object_or_404(Tenant, pk=pk)
        return Response({"owner_invitation": _dispatch_owner_invitation(tenant, "new_owner")})


class TenantDetailView(TenantContextMixin, generics.RetrieveUpdateDestroyAPIView):
    """
    GET/PATCH/DELETE /api/v1/tenants/<tenant_pk>/ -- view, edit, or delete a single tenant.
    Access and edit rights depend on the requesting user's role.
    DELETE is disabled: tenant records must be deactivated, not deleted.
    """

    queryset = Tenant.objects.all()
    permission_classes = [IsTenantMember]

    def get_serializer_class(self):
        role = getattr(self.request.user, "role", None)
        if role == "platform_admin":
            return TenantAdminSerializer
        elif role == "owner":
            return TenantOwnerSerializer
        return TenantStaffSerializer

    def update(self, request, *args, **kwargs):
        if request.user.role == "staff":
            return Response(
                {"detail": "Staff cannot edit tenant information."},
                status=status.HTTP_403_FORBIDDEN,
            )
        partial = kwargs.pop("partial", False)
        tenant = self.get_object()
        serializer = self.get_serializer(tenant, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        _save_tenant_settings_with_audit(serializer, request=request, tenant=tenant)
        return Response(serializer.data)

    def destroy(self, request, *args, **kwargs):
        return Response(
            {"detail": "Do‘konni butunlay o‘chirib bo‘lmaydi. Kerak bo‘lsa faoliyatini to‘xtating."},
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )


class TenantChangeOwnerView(APIView):
    """POST /api/v1/tenants/<tenant_pk>/change-owner/ -- platform_admin only."""

    permission_classes = [IsPlatformAdmin]

    @extend_schema(request=TenantChangeOwnerSerializer, responses={200: TenantAdminSerializer})
    def post(self, request, pk):
        tenant = get_object_or_404(Tenant, pk=pk)
        serializer = TenantChangeOwnerSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        new_owner = serializer.validated_data.get('new_owner_id')
        new_phone = serializer.validated_data.get('new_owner_phone_number')
        new_email = serializer.validated_data.get('new_owner_email')

        try:
            with transaction.atomic():
                if new_phone:
                    normalized_phone = User.objects.normalize_phone_number(new_phone)
                    defaults = {"role": "owner", "profile_completed": False}
                    if new_email:
                        defaults["email"] = new_email
                    new_owner, created = User.objects.get_or_create(
                        phone_number=normalized_phone, defaults=defaults
                    )
                    if created:
                        new_owner.set_unusable_password()
                        new_owner.save(update_fields=["password"])
                if new_email and new_owner.email and new_owner.email.casefold() != new_email.casefold():
                    raise TenantServiceError("Bu hisobga boshqa email biriktirilgan. Mavjud egani tekshiring.")
                if new_email and not new_owner.email:
                    new_owner.email = new_email
                    new_owner.save(update_fields=["email"])
                TenantService.change_owner(
                    tenant=tenant,
                    new_owner=new_owner,
                    changed_by=request.user,
                )
        except TenantServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        response_data = dict(TenantAdminSerializer(tenant).data)
        response_data["owner_invitation"] = _dispatch_owner_invitation(tenant, "transfer_owner")
        return Response(response_data)


class TenantDeactivateView(TenantContextMixin, APIView):
    """POST /api/v1/tenants/<tenant_pk>/deactivate/ -- platform_admin (any) oe owner (own)"""

    permission_classes = [IsTenantOwnerOrPlatformAdmin]

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
    def post(self, request, pk):
        tenant = get_object_or_404(Tenant, pk=pk)
        self.check_object_permissions(request, tenant)
        tenant.is_active = False
        tenant.save(update_fields=["is_active"])
        return Response({"id": tenant.id, "is_active": tenant.is_active})


class TenantActivateView(TenantContextMixin, APIView):
    """POST /api/v1/tenants/{id}/activate/ — platform_admin (any) or owner (own)."""

    permission_classes = [IsTenantOwnerOrPlatformAdmin]

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
    def post(self, request, pk):
        tenant = get_object_or_404(Tenant, pk=pk)
        self.check_object_permissions(request, tenant)
        tenant.is_active = True
        tenant.save(update_fields=["is_active"])
        return Response({"id": tenant.id, "is_active": tenant.is_active})


class CurrentTenantView(TenantContextMixin, APIView):
    """
    GET /api/v1/tenants/current/ -- retrieve current tenant settings.
    PATCH /api/v1/tenants/current/ -- update settings with tenants.manage_settings.
    """
    permission_classes = [IsAuthenticated]

    def _can_manage(self, request, tenant):
        return PermissionService.has_permission(
            request.user, "tenants.manage_settings", tenant=tenant, employee=self.employee,
        )

    def _get_tenant(self, request):
        user = request.user
        if user.role == "platform_admin":
            tenant_id = request.query_params.get("tenant_id")
            return get_object_or_404(Tenant, pk=tenant_id) if tenant_id else None
        return self.tenant

    @extend_schema(request=None, responses={200: TenantOwnerSerializer})
    def get(self, request):
        tenant = self._get_tenant(request)
        if not tenant:
            return Response({"detail": "Do'kon topilmadi."}, status=status.HTTP_404_NOT_FOUND)
        if request.user.role == "platform_admin":
            return Response(TenantAdminSerializer(tenant).data)
        elif request.user.role == "owner":
            return Response(TenantOwnerSerializer(tenant).data)
        if self._can_manage(request, tenant):
            return Response(TenantSettingsSerializer(tenant).data)
        return Response(TenantStaffSerializer(tenant).data)

    @extend_schema(request=TenantOwnerSerializer, responses={200: TenantOwnerSerializer})
    def patch(self, request):
        tenant = self._get_tenant(request)
        if not tenant:
            return Response({"detail": "Do'kon topilmadi."}, status=status.HTTP_404_NOT_FOUND)
        if not self._can_manage(request, tenant):
            return Response({"detail": "Do‘kon sozlamalarini boshqarish ruxsati kerak."}, status=status.HTTP_403_FORBIDDEN)

        serializer_class = TenantAdminSerializer if request.user.role == "platform_admin" else TenantSettingsSerializer
        serializer = serializer_class(tenant, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        _save_tenant_settings_with_audit(serializer, request=request, tenant=tenant)
        return Response(serializer.data)


class TenantTransferTargetsView(TenantContextMixin, APIView):
    permission_classes = [HasEmployeePermission]
    required_permission = "inventory.transfer_stock"

    @extend_schema(request=None, responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        profile = self.tenant.seller_profile
        if profile is None or profile.status != SellerProfile.STATUS_APPROVED:
            return Response([])
        tenants = Tenant.objects.filter(
            owner=self.tenant.owner,
            seller_profile=profile,
            is_active=True,
        ).exclude(pk=self.tenant.pk).order_by("name", "id")
        if profile.expires_at is None or profile.expires_at <= timezone.now():
            return Response([])
        return Response([
            {"id": tenant.id, "name": tenant.name, "public_code": tenant.public_code, "address": tenant.address}
            for tenant in tenants
        ])


class TenantTestTelegramView(TenantContextMixin, APIView):
    """
    POST /api/v1/tenants/current/test-telegram/ -- send test message to configured Telegram destinations.
    """
    permission_classes = [HasEmployeePermission]
    required_permission = "tenants.manage_settings"

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
    def post(self, request):
        from apps.tg_bot.models import TelegramContact
        from apps.tg_bot.services import send_telegram_message

        user = request.user
        if user.role == "platform_admin":
            tenant_id = request.data.get("tenant_id") or request.query_params.get("tenant_id")
            tenant = Tenant.objects.filter(pk=tenant_id).first() if tenant_id else None
        else:
            tenant = self.tenant

        if not tenant:
            return Response({"detail": "Do'kon topilmadi."}, status=status.HTTP_404_NOT_FOUND)

        dest_chat_ids = set()
        custom_group_id = request.data.get("telegram_group_id")
        group_id = custom_group_id if custom_group_id is not None else tenant.telegram_group_id
        if group_id and group_id.strip():
            dest_chat_ids.add(group_id.strip())

        contact = TelegramContact.objects.filter(phone_number=tenant.owner.phone_number).first()
        if contact and contact.chat_id:
            dest_chat_ids.add(contact.chat_id)

        if not dest_chat_ids:
            return Response({
                "success": False,
                "detail": "Hech qanday Telegram manzil topilmadi. Guruh ID sini kiriting yoki Telegram bot (@ilbi_bot) ga shaxsiy raqamingizni ulang."
            }, status=status.HTTP_400_BAD_REQUEST)

        effective_rate = tenant.effective_usd_rate
        rate_text = f"{effective_rate:,.2f} UZS" if effective_rate is not None else "Kurs mavjud emas"
        test_msg = (
            "🔔 *ILBI Test Bildirishnomasi*\n\n"
            f"🏢 *Do'kon:* {tenant.name}\n"
            f"💵 *Ichki dollar kursi:* `{rate_text}`\n"
            "✅ *Aloqa holati:* Telegram kanali/guruhi muvaffaqiyatli ulandi va sozlandi!"
        )

        sent_count = 0
        for chat_id in dest_chat_ids:
            ok = send_telegram_message(chat_id, test_msg)
            if ok:
                sent_count += 1

        if sent_count > 0:
            return Response({
                "success": True,
                "detail": f"Test xabari {sent_count} ta Telegram manzilga muvaffaqiyatli yuborildi."
            })
        else:
            return Response({
                "success": False,
                "detail": "Telegram bot xabarni yubora olmadi. Botni guruhga admin qilib qo'shganingizni va ID to'g'riligini tekshiring."
            }, status=status.HTTP_400_BAD_REQUEST)


class TenantSendReportNowView(TenantContextMixin, APIView):
    """
    POST /api/v1/tenants/current/send-report-now/ -- trigger daily report immediately.
    """
    permission_classes = [HasEmployeePermission]
    required_permission = "tenants.manage_settings"

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
    def post(self, request):
        from apps.cashbox.tasks import send_daily_report_for_tenant_task

        user = request.user
        if user.role == "platform_admin":
            tenant_id = request.data.get("tenant_id") or request.query_params.get("tenant_id")
            tenant = Tenant.objects.filter(pk=tenant_id).first() if tenant_id else None
        else:
            tenant = self.tenant

        if not tenant:
            return Response({"detail": "Do'kon topilmadi."}, status=status.HTTP_404_NOT_FOUND)

        success = send_daily_report_for_tenant_task(tenant.id)
        if success:
            return Response({"success": True, "detail": "Kunlik hisobot Telegramga yuborildi."})
        return Response({
            "success": False,
            "detail": "Hisobot yuborilmadi. Sozlamalarda hisobot yoqilganini va Telegram manzil kiritilganini tekshiring."
        }, status=status.HTTP_400_BAD_REQUEST)


class TenantSendLowStockReportNowView(TenantContextMixin, APIView):
    """
    POST /api/v1/tenants/current/send-low-stock-report-now/ -- trigger deficit report immediately.
    """
    permission_classes = [HasEmployeePermission]
    required_permission = "tenants.manage_settings"

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
    def post(self, request):
        from apps.inventory.tasks import send_low_stock_report_for_tenant_task

        user = request.user
        if user.role == "platform_admin":
            tenant_id = request.data.get("tenant_id") or request.query_params.get("tenant_id")
            tenant = Tenant.objects.filter(pk=tenant_id).first() if tenant_id else None
        else:
            tenant = self.tenant

        if not tenant:
            return Response({"detail": "Do'kon topilmadi."}, status=status.HTTP_404_NOT_FOUND)

        res = send_low_stock_report_for_tenant_task(tenant.id)
        if res.get("success"):
            count = res.get("count", 0)
            return Response({
                "success": True,
                "count": count,
                "detail": f"Kamchilik tovarlar hisoboti ({count} ta tovar) muvaffaqiyatli jo'natildi."
            })
        return Response({
            "success": False,
            "detail": res.get("detail", "Hisobot yuborilmadi. Sozlamalarni tekshiring.")
        }, status=status.HTTP_400_BAD_REQUEST)
