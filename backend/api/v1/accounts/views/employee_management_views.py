"""Tenant-scoped profile, invitation, account status, and archive endpoints."""

from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from api.mixins import TenantContextMixin
from api.permissions import IsOwnerOrPlatformAdmin
from api.v1.accounts.serializers import (
    EmployeeActionReasonSerializer,
    EmployeeBlockSerializer,
    EmployeeEditSerializer,
    EmployeeListSerializer,
)
from apps.accounts.models import Employee
from apps.accounts.services.employee_management_service import EmployeeManagementService
from apps.permissions.constants import OWNER_ONLY_PERMISSIONS
from apps.permissions.models import Permission
from apps.tenants.models import Tenant


def _employee(view, request, tenant_id, employee_id):
    if request.user.role == "platform_admin":
        tenant = get_object_or_404(Tenant, pk=tenant_id)
    else:
        tenant = view.resolve_tenant_from_url(request, tenant_id)
        if tenant.owner_id != request.user.pk or not view.employee.is_owner:
            raise PermissionDenied("Faqat do‘kon egasi ruxsat etilgan.")
    return get_object_or_404(
        Employee.objects.select_related("user", "tenant").prefetch_related("user__employments"),
        pk=employee_id, tenant=tenant,
    )


class EmployeeDetailView(TenantContextMixin, APIView):
    permission_classes = [IsOwnerOrPlatformAdmin]

    @extend_schema(request=EmployeeEditSerializer, responses={200: EmployeeListSerializer})
    def patch(self, request, tenant_id, employee_id):
        employee = _employee(self, request, tenant_id, employee_id)
        serializer = EmployeeEditSerializer(data=request.data, context={"employee": employee})
        serializer.is_valid(raise_exception=True)
        employee = EmployeeManagementService.update(
            employee=employee, actor=request.user, values=serializer.validated_data, request=request,
        )
        return Response(EmployeeListSerializer(employee, context={"request": request}).data)

    @extend_schema(request=EmployeeActionReasonSerializer, responses={200: EmployeeListSerializer})
    def delete(self, request, tenant_id, employee_id):
        employee = _employee(self, request, tenant_id, employee_id)
        serializer = EmployeeActionReasonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        employee = EmployeeManagementService.archive(
            employee=employee, actor=request.user, reason=serializer.validated_data["reason"], request=request,
        )
        return Response(EmployeeListSerializer(employee, context={"request": request}).data)


class EmployeeAccountStatusView(TenantContextMixin, APIView):
    permission_classes = [IsOwnerOrPlatformAdmin]

    @extend_schema(request=EmployeeBlockSerializer, responses={200: EmployeeListSerializer})
    def post(self, request, tenant_id, employee_id):
        employee = _employee(self, request, tenant_id, employee_id)
        serializer = EmployeeBlockSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        employee = EmployeeManagementService.set_blocked(
            employee=employee, actor=request.user, request=request, **serializer.validated_data,
        )
        return Response(EmployeeListSerializer(employee, context={"request": request}).data)


class EmployeeRestoreView(TenantContextMixin, APIView):
    permission_classes = [IsOwnerOrPlatformAdmin]

    @extend_schema(request=EmployeeActionReasonSerializer, responses={200: EmployeeListSerializer})
    def post(self, request, tenant_id, employee_id):
        employee = _employee(self, request, tenant_id, employee_id)
        serializer = EmployeeActionReasonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        employee = EmployeeManagementService.restore(
            employee=employee, actor=request.user, reason=serializer.validated_data["reason"], request=request,
        )
        return Response(EmployeeListSerializer(employee, context={"request": request}).data)


class EmployeeResendInvitationView(TenantContextMixin, APIView):
    permission_classes = [IsOwnerOrPlatformAdmin]

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
    def post(self, request, tenant_id, employee_id):
        employee = _employee(self, request, tenant_id, employee_id)
        result = EmployeeManagementService.resend_invitation(
            employee=employee, actor=request.user, request=request,
        )
        messages = {
            "sent": "Emailga havola yuborildi.",
            "cooldown": "Qayta yuborishdan oldin kamida 60 soniya kuting.",
            "no_email": "Avval hisobga email manzilini kiriting.",
            "inactive_user": "Bloklangan yoki faol bo‘lmagan hisobga havola yuborilmaydi.",
            "email_send_failed": "Email yuborilmadi. Pochta xizmatini tekshirib, qayta urinib ko‘ring.",
        }
        response_status = status.HTTP_200_OK if result["sent"] else (
            status.HTTP_429_TOO_MANY_REQUESTS if result["reason"] == "cooldown" else status.HTTP_502_BAD_GATEWAY
        )
        return Response(
            {**result, "detail": messages.get(result["reason"], "Havolani yuborib bo‘lmadi.")},
            status=response_status,
        )


class EmployeePermissionChoicesView(TenantContextMixin, APIView):
    permission_classes = [IsOwnerOrPlatformAdmin]

    @extend_schema(request=None, responses={200: OpenApiTypes.OBJECT})
    def get(self, request, tenant_id):
        if request.user.role == 'platform_admin':
            get_object_or_404(Tenant, pk=tenant_id)
        else:
            tenant = self.resolve_tenant_from_url(request, tenant_id)
            if tenant.owner_id != request.user.pk or not self.employee.is_owner:
                raise PermissionDenied('Faqat do‘kon egasi ruxsat etilgan.')
        return Response([
            {"id": permission.pk, "category": permission.category,
             "codename": permission.codename, "name": permission.name}
            for permission in Permission.objects.order_by('category', 'codename')
            if permission.full_code not in OWNER_ONLY_PERMISSIONS
        ])
