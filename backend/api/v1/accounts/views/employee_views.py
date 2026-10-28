from drf_spectacular.utils import extend_schema

from api.schema import optional_pagination

"""Views for hiring and firing employees within a tenant."""

from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.mixins import TenantContextMixin
from api.v1.accounts.serializers import (
    EmployeeFireSerializer,
    EmployeeHireSerializer,
    EmployeeListSerializer,
    EmployeeOutputSerializer,
)
from apps.accounts.models import Employee
from apps.accounts.services.employee_service import EmployeeService, EmployeeServiceError
from apps.tenants.models import Tenant


class EmployeeListPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 100


class EmployeeListView(TenantContextMixin, APIView):
    """GET /api/v1/tenants/{tenant_id}/employees/ -- tenant-scoped team."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={200: optional_pagination(EmployeeListSerializer)})
    def get(self, request, tenant_id):
        if request.user.role == "platform_admin":
            # Admin may inspect teams in suspended tenants, while hire/fire
            # still require an active tenant through resolve_tenant_from_url.
            tenant = get_object_or_404(Tenant, pk=tenant_id)
        elif request.user.role == "owner":
            tenant = self.resolve_tenant_from_url(request, tenant_id)
            if tenant.owner_id != request.user.id or not self.employee.is_owner:
                raise PermissionDenied("Faqat do‘kon egasi xodimlarni ko‘ra oladi.")
        else:
            raise PermissionDenied("Faqat do‘kon egasi yoki platforma administratori ruxsat etilgan.")

        active = request.query_params.get("active", "all")
        if active not in ("all", "true", "false"):
            raise ValidationError({"active": "all, true yoki false bo‘lishi kerak."})

        archived = request.query_params.get("archived", "false")
        if archived not in ("all", "true", "false"):
            raise ValidationError({"archived": "all, true yoki false bo‘lishi kerak."})
        employees = Employee.objects.filter(tenant=tenant).select_related("user", "tenant").prefetch_related(
            "user__employments", "permissions",
        )
        if archived != "all":
            employees = employees.filter(archived_at__isnull=(archived == "false"))
        if active != "all":
            employees = employees.filter(is_active=(active == "true"))
        search = request.query_params.get("search", "").strip()
        if search:
            employees = employees.filter(
                Q(user__first_name__icontains=search)
                | Q(user__last_name__icontains=search)
                | Q(user__username__icontains=search)
                | Q(user__phone_number__icontains=search)
                | Q(position__icontains=search)
            )
        employees = employees.order_by("-is_active", "-hired_at", "-id")
        paginator = EmployeeListPagination()
        page = paginator.paginate_queryset(employees, request, view=self)
        return paginator.get_paginated_response(EmployeeListSerializer(page, many=True, context={"request": request}).data)


class EmployeeHireView(TenantContextMixin, APIView):
    """POST /api/v1/tenants/{tenant_id}/employees/hire/"""
    permission_classes = [IsAuthenticated]

    @extend_schema(request=EmployeeHireSerializer, responses={201: EmployeeOutputSerializer})
    def post(self, request, tenant_id):
        # Tenant authority + active-tenant check are centralized in
        # TenantContextMixin.resolve_tenant_from_url() -- see api/mixins.py
        # for the 8-bosqich design rationale.
        tenant = self.resolve_tenant_from_url(request, tenant_id)

        serializer = EmployeeHireSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            employee = EmployeeService.hire(
                target_user=serializer.validated_data.get('target_user'),
                phone_number=serializer.validated_data.get('phone_number'),
                email=serializer.validated_data.get('email'),
                first_name=serializer.validated_data.get('first_name', ''),
                last_name=serializer.validated_data.get('last_name', ''),
                tenant=tenant,
                hired_by=request.user,
                position=serializer.validated_data.get('position', ''),
                permissions=serializer.validated_data.get('permissions'),
                role="staff",
            )
        except EmployeeServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        invitation = {"sent": False, "reason": "existing_account"}
        # Only a new/unactivated account needs a setup link.
        if employee.user.email and not employee.user.has_usable_password():
            import logging

            from apps.accounts.services.password_reset_service import request_password_reset_for_user
            _logger = logging.getLogger(__name__)
            try:
                sent, reason = request_password_reset_for_user(
                    employee.user.id,
                    purpose="new_employee",
                    extra_context={"position": employee.position, "tenant_name": tenant.name},
                )
                invitation = {"sent": sent, "reason": reason}
            except Exception as exc:
                _logger.warning("Failed to dispatch employee onboarding email for user_id=%s: %s", employee.user.id, type(exc).__name__)
                invitation = {"sent": False, "reason": "email_send_failed"}

        data = EmployeeOutputSerializer(employee).data
        data["onboarding_invitation"] = invitation
        return Response(data, status=status.HTTP_201_CREATED)


class EmployeeFireView(TenantContextMixin, APIView):
    """POST /api/v1/tenants/{tenant_id}/employees/fire/"""
    permission_classes = [IsAuthenticated]

    @extend_schema(request=EmployeeFireSerializer, responses={200: EmployeeOutputSerializer})
    def post(self, request, tenant_id):
        # Same centralized authority + active-tenant check as hire above.
        tenant = self.resolve_tenant_from_url(request, tenant_id)

        serializer = EmployeeFireSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            employee = EmployeeService.fire(
                target_user=serializer.validated_data["target_user"],
                fired_by=request.user,
                tenant=tenant,
            )
        except EmployeeServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(EmployeeOutputSerializer(employee).data)
