from datetime import datetime, time

from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from api.mixins import TenantContextMixin
from api.pagination import StandardResultsSetPagination
from api.permissions import IsOwnerOrPlatformAdmin
from api.schema import optional_pagination
from api.v1.audit.serializers import AuditLogSerializer
from apps.core.models import AuditLog


class AuditLogListView(TenantContextMixin, APIView):
    """
    GET /api/v1/audit/logs/
    List audit logs. Accessible only to owner (scoped to their tenant)
    and platform_admin (all tenants, with optional tenant_id filter).
    Staff and unauthenticated users receive 403 Forbidden.
    """
    permission_classes = [IsOwnerOrPlatformAdmin]

    @extend_schema(request=None, responses={200: optional_pagination(AuditLogSerializer)})
    def get(self, request):
        user = request.user

        if user.role == "platform_admin":
            queryset = AuditLog.objects.select_related("actor", "tenant").all()
            tenant_id = request.query_params.get("tenant_id")
            if tenant_id:
                queryset = queryset.filter(tenant_id=tenant_id)
        elif user.role == "owner":
            tenant = self.tenant
            if not tenant:
                return Response(
                    {"detail": "No tenant associated with this owner account."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            queryset = AuditLog.objects.select_related("actor", "tenant").filter(tenant=tenant)
        else:
            return Response(
                {"detail": "You do not have permission to view audit logs."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Filters
        action = request.query_params.get("action")
        if action:
            queryset = queryset.filter(action=action)

        actor_id = request.query_params.get("actor")
        if actor_id:
            queryset = queryset.filter(actor_id=actor_id)

        target_model = request.query_params.get("target_model")
        if target_model:
            queryset = queryset.filter(target_model__iexact=target_model)

        start_date_str = request.query_params.get("start_date")
        if start_date_str:
            parsed_start = parse_datetime(start_date_str)
            if not parsed_start:
                d = parse_date(start_date_str)
                if d:
                    parsed_start = timezone.make_aware(datetime.combine(d, time.min))
            if parsed_start:
                queryset = queryset.filter(created_at__gte=parsed_start)

        end_date_str = request.query_params.get("end_date")
        if end_date_str:
            parsed_end = parse_datetime(end_date_str)
            if not parsed_end:
                d = parse_date(end_date_str)
                if d:
                    parsed_end = timezone.make_aware(datetime.combine(d, time.max))
            if parsed_end:
                queryset = queryset.filter(created_at__lte=parsed_end)

        paginator = StandardResultsSetPagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        serializer = AuditLogSerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)
