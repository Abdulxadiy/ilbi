import secrets

from django.db import transaction
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response

from api.permissions import HasEmployeePermission
from api.v1.catalog.serializers import ProductVariantOutputSerializer
from apps.catalog.models import ProductVariant
from apps.core.models import AuditAction
from apps.core.services.audit_service import AuditService
from apps.tenants.models import Tenant

from ._base import CatalogAPIView


class GenerateVariantBarcodeView(CatalogAPIView):
    permission_classes = [HasEmployeePermission]
    required_permission = "catalog.change_product"

    @extend_schema(request=None, responses={200: ProductVariantOutputSerializer})
    @transaction.atomic
    def post(self, request, pk):
        Tenant.objects.select_for_update().get(pk=self.tenant.pk)
        variant = get_object_or_404(
            ProductVariant.objects.select_for_update(of=("self",)).select_related("product__category", "stock"),
            tenant=self.tenant,
            pk=pk,
            is_active=True,
            product__is_active=True,
        )
        force = False
        if isinstance(request.data, dict) and request.data.get("force"):
            force = True
        if request.query_params.get("force") in ("true", "1"):
            force = True

        if not variant.barcode or force:
            old_barcode = variant.barcode
            while True:
                # Internal shop code: 12 digits plus an EAN-compatible check digit.
                base = f"20{secrets.randbelow(10**10):010d}"
                check = (-sum(int(digit) * (1 if i % 2 == 0 else 3) for i, digit in enumerate(base))) % 10
                barcode = f"{base}{check}"
                if not ProductVariant.objects.filter(tenant=self.tenant, barcode=barcode).exclude(pk=variant.pk).exists():
                    break
            variant.barcode = barcode
            variant.save(update_fields=["barcode", "updated_at"])
            AuditService.log(
                action=AuditAction.BARCODE_GENERATE,
                actor=request.user,
                tenant=self.tenant,
                target_model="ProductVariant",
                target_id=str(variant.pk),
                changes={"barcode": {"old": old_barcode, "new": barcode}},
                description="Mahsulot uchun shtrix-kod yaratildi",
                request=request,
            )
        return Response(ProductVariantOutputSerializer(variant, context={"request": request}).data)
