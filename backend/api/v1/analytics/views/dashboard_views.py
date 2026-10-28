from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from api.mixins import TenantContextMixin
from api.permissions import HasEmployeePermission
from apps.analytics.services.analytics_service import AnalyticsService, AnalyticsServiceError


class DashboardView(TenantContextMixin, APIView):
    """
    Savdo Analitikasi va Boshqaruv Paneli (Dashboard).
    Do'kon egasi yoki 'analytics.view_dashboard' ruxsatiga ega xodimlar ko'rishi mumkin.
    Platforma administratori uchun do'konning ichki tijorat va moliyaviy ma'lumotlari
    maxfiylik siyosatiga muvofiq qat'iy cheklangan (403 Forbidden).
    """
    required_permission = "analytics.view_dashboard"
    permission_classes = [HasEmployeePermission]

    @extend_schema(request=None, responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        user = request.user
        if user.role == "platform_admin":
            raise PermissionDenied(
                "Do'konning tijorat sirlari va moliyaviy hisobotlari platforma administratori uchun yopiq."
            )

        tenant = self.tenant
        if not tenant or not tenant.is_active:
            raise PermissionDenied("Do'kon faol emas yoki mavjud emas.")

        requested_tenant_id = request.query_params.get("tenant_id")
        if requested_tenant_id and str(tenant.id) != str(requested_tenant_id):
            raise PermissionDenied("Siz faqat o'zingizning do'koningiz analitikasini ko'ra olasiz.")

        if not tenant or not tenant.is_active:
            raise PermissionDenied("Do'kon faol emas.")

        period = request.query_params.get("period", "today")
        start_date = request.query_params.get("start_date")
        end_date = request.query_params.get("end_date")

        try:
            summary = AnalyticsService.get_dashboard_summary(
                tenant=tenant,
                period=period,
                start_date_str=start_date,
                end_date_str=end_date,
            )
            return Response(summary, status=status.HTTP_200_OK)
        except AnalyticsServiceError as exc:
            return Response(
                {
                    "error": {
                        "code": "invalid_parameters",
                        "message": str(exc),
                    }
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
