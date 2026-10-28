from django.db import IntegrityError
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from api.permissions import HasEmployeePermission
from apps.core.spreadsheets import MONEY_FORMAT, XLSX_MIME, excel_response
from apps.sales.models import CounterpartyImportJob
from apps.sales.services.counterparty_service import CounterpartyServiceError
from apps.sales.services.import_service import IMPORT_PROTOCOL, TEMPLATE_HEADERS, CounterpartyImportService

from ._base import SalesAPIView


class CounterpartyImportFileSerializer(serializers.Serializer):
    file = serializers.FileField()


def import_operation(job):
    return {
        "protocol": IMPORT_PROTOCOL,
        "job_id": job.pk,
        "actor_id": job.created_by_id,
        "tenant_id": job.tenant_id,
    }


class CounterpartyImportJobSerializer(serializers.ModelSerializer):
    operation_context = serializers.SerializerMethodField()

    def get_operation_context(self, obj) -> dict:
        return import_operation(obj)

    class Meta:
        model = CounterpartyImportJob
        fields = ["id", "rows", "expires_at", "completed_at", "result", "operation_context"]
        read_only_fields = fields


class CounterpartyImportTemplateView(SalesAPIView):
    permission_classes = [HasEmployeePermission]
    required_permission = "sales.manage_counterparty"

    @extend_schema(responses={(200, XLSX_MIME): OpenApiTypes.BINARY})
    def get(self, request):
        return excel_response(
            TEMPLATE_HEADERS,
            [],
            "ilbi-mijozlar-shablon.xlsx",
            "Mijozlar",
            formats={"telefon": "@", "nasiya_uzs": MONEY_FORMAT, "nasiya_usd": MONEY_FORMAT},
            widths={"mijoz": 36, "telefon": 26, "izoh": 60},
            report={
                "tenant": self.tenant.name,
                "sheet_title": "Qo‘llanma",
                "scope": "Mijozlar va nasiya import shabloni",
                "notes": [
                    ("Boshlash", "Mijozlar varag‘ida sarlavhalarni o‘zgartirmang. Ma’lumotlarni 2-qatordan kiriting."),
                    ("Majburiy ustunlar", "mijoz, telefon"),
                    ("mijoz", "Mijozning to‘liq ismi yoki tashkilot nomi (150 belgigacha)."),
                    ("telefon", "Matn shaklida kiriting. Masalan: +998901234567. 7–15 ta raqam."),
                    (
                        "nasiya_uzs / nasiya_usd",
                        "Boshlang‘ich qarz: manfiy bo‘lmagan son, 2 xonagacha kasr. Bo‘sh bo‘lsa: 0.",
                    ),
                    ("izoh", "Ixtiyoriy eslatma, 5000 belgigacha."),
                    (
                        "Hisobga olish",
                        "Nasiya hisob tuzatishi sifatida tarixga yoziladi. Kassa va savdo tushumiga ta’sir qilmaydi.",
                    ),
                    ("Ruxsat", "Nasiya summasi kiritilsa qarz to‘lovlarini qayd etish ruxsati ham kerak."),
                    (
                        "Takrorlar",
                        "Fayldagi yoki do‘kondagi takror telefonlar qabul qilinmaydi. "
                        "Mavjud mijozlar o‘zgartirilmaydi.",
                    ),
                    ("Chegaralar", "Ko‘pi bilan 1000 qator, 8 MB. Formulalar o‘rniga qiymatlarni kiriting."),
                    (
                        "Saqlash",
                        "Avval faylni tekshiring, so‘ng tasdiqlang. Xatoli qator bo‘lsa butun import saqlanmaydi.",
                    ),
                ],
            },
        )


class CounterpartyImportPreviewView(SalesAPIView):
    permission_classes = [HasEmployeePermission]
    required_permission = "sales.manage_counterparty"
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(request=CounterpartyImportFileSerializer, responses={201: CounterpartyImportJobSerializer})
    def post(self, request):
        serializer = CounterpartyImportFileSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        job = CounterpartyImportService.preview(
            upload=serializer.validated_data["file"], tenant=self.tenant, user=request.user
        )
        return Response(CounterpartyImportJobSerializer(job).data, status=201)


class CounterpartyImportCommitView(SalesAPIView):
    permission_classes = [HasEmployeePermission]
    required_permission = "sales.manage_counterparty"

    @extend_schema(request=None, responses={200: OpenApiTypes.OBJECT})
    def post(self, request, job_id):
        job = get_object_or_404(CounterpartyImportJob, pk=job_id, tenant=self.tenant, created_by=request.user)
        try:
            result = CounterpartyImportService.commit(
                job_id=job_id, tenant=self.tenant, user=request.user, request=request
            )
        except (CounterpartyServiceError, IntegrityError) as exc:
            return Response(
                {
                    "detail": str(exc)
                    if isinstance(exc, CounterpartyServiceError)
                    else "Takror ma’lumot. Faylni qayta tekshiring."
                },
                status=400,
            )
        return Response({**result, "import_operation": import_operation(job)})
