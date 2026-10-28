from django.db import IntegrityError
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from api.permissions import HasEmployeePermission, IsOwner
from apps.catalog.models.import_model import CatalogImportJob
from apps.catalog.services import CategoryServiceError, ProductServiceError
from apps.catalog.services.import_service import TEMPLATE_HEADERS, CatalogImportService
from apps.core.spreadsheets import MONEY_FORMAT, QUANTITY_FORMAT, XLSX_MIME, excel_response
from apps.inventory.services import StockServiceError

from ._base import CatalogAPIView


class ImportFileSerializer(serializers.Serializer):
    file = serializers.FileField()


class ImportJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = CatalogImportJob
        fields = ["id", "rows", "expires_at", "completed_at", "result"]
        read_only_fields = fields


class CatalogImportTemplateView(CatalogAPIView):
    permission_classes = [IsOwner, HasEmployeePermission]
    required_permission = "catalog.add_product"

    @extend_schema(responses={(200, XLSX_MIME): OpenApiTypes.BINARY})
    def get(self, request):
        return excel_response(
            TEMPLATE_HEADERS,
            [],
            "ilbi-import-template.xlsx",
            "Katalog",
            formats={
                "shtrix_kod": "@",
                "miqdor": QUANTITY_FORMAT,
                "partiya": "@",
                "yaroqlilik_sanasi": "@",
                **{key: MONEY_FORMAT for key in ["hamkor_narxi", "minimal_narx", "sotuv_narxi", "tannarx"]},
            },
            widths={"mahsulot": 64, "kategoriya": 28, "variant": 32, "shtrix_kod": 25, "yaroqlilik_sanasi": 24},
            report={
                "tenant": self.tenant.name,
                "sheet_title": "Qo‘llanma",
                "scope": "Katalog import shabloni",
                "notes": [
                    (
                        "Boshlash",
                        "Katalog varag‘idagi 1-qator sarlavhalarini o‘zgartirmang. Ma’lumotlarni 2-qatordan kiriting.",
                    ),
                    ("Majburiy ustunlar", "mahsulot, kategoriya, sotuv_narxi"),
                    (
                        "mahsulot / kategoriya",
                        "Mahsulot va kategoriya nomi. Kategoriya mavjud bo‘lmasa, tegishli ruxsat bilan yaratiladi.",
                    ),
                    ("variant", "Variant nomi. Bo‘sh bo‘lsa: Standart."),
                    ("birlik", "dona, kg, litr yoki metr. Bo‘sh bo‘lsa: dona."),
                    ("shtrix_kod", "Matn sifatida kiriting: boshidagi nollar saqlanadi. Masalan: 0012345678905."),
                    (
                        "Narxlar",
                        "hamkor_narxi, minimal_narx, sotuv_narxi, tannarx — manfiy bo‘lmagan sonlar. "
                        "Valyuta belgisini yozmang.",
                    ),
                    ("valyuta", "UZS yoki USD. Bo‘sh bo‘lsa: UZS. Mavjud kategoriya valyutasiga mos bo‘lsin."),
                    ("miqdor", "Boshlang‘ich kirim miqdori, 3 xonagacha kasr. Bo‘sh bo‘lsa: 0."),
                    ("partiya", "Ixtiyoriy partiya kodi. Kirim miqdori berilganida ishlatiladi."),
                    ("yaroqlilik_sanasi", "Ixtiyoriy sana: YYYY-MM-DD, masalan 2027-12-31."),
                    ("Chegaralar", "Ko‘pi bilan 1000 qator va 8 MB. Formulalar o‘rniga qiymatlarni kiriting."),
                    ("Saqlash", "Avval oldindan ko‘rish natijasini tekshiring, so‘ng importni tasdiqlang."),
                ],
            },
        )


class CatalogImportPreviewView(CatalogAPIView):
    permission_classes = [HasEmployeePermission]
    required_permission = "catalog.add_product"
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(request=ImportFileSerializer, responses={201: ImportJobSerializer})
    def post(self, request):
        serializer = ImportFileSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        job = CatalogImportService.preview(
            upload=serializer.validated_data["file"], tenant=self.tenant, user=request.user
        )
        return Response(ImportJobSerializer(job).data, status=201)


class CatalogImportCommitView(CatalogAPIView):
    permission_classes = [HasEmployeePermission]
    required_permission = "catalog.add_product"

    @extend_schema(request=None, responses={200: OpenApiTypes.OBJECT})
    def post(self, request, job_id):
        get_object_or_404(CatalogImportJob, pk=job_id, tenant=self.tenant, created_by=request.user)
        try:
            result = CatalogImportService.commit(job_id=job_id, tenant=self.tenant, user=request.user, request=request)
        except (ProductServiceError, CategoryServiceError, StockServiceError, IntegrityError) as exc:
            return Response(
                {
                    "detail": "Import saqlanmadi. Faylni qayta tekshiring.",
                    "reason": str(exc) if not isinstance(exc, IntegrityError) else "Takror ma’lumot.",
                },
                status=400,
            )
        return Response(result)
