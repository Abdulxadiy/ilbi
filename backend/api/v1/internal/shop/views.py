from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import IsInternalService
from api.v1.internal.shop.serializers import (
    ShopProductVariantSerializer,
)
from apps.catalog.models import ProductVariant
from apps.tenants.models import Tenant


class ShopTenantProductsView(APIView):
    """
    Shop mikroservisi uchun: bitta do'konning barcha faol tovar variantlari va narxlarini olish.
    """
    authentication_classes = []
    permission_classes = [IsInternalService]

    @extend_schema(request=None, responses={200: ShopProductVariantSerializer(many=True)})
    def get(self, request, tenant_id):
        tenant = get_object_or_404(Tenant, pk=tenant_id, is_active=True)
        variants = (
            ProductVariant.objects.filter(
                tenant=tenant,
                is_active=True,
                product__is_active=True,
            )
            .select_related("product", "product__category", "stock")
            .prefetch_related("product__gallery_images")
        )

        in_stock_only = request.query_params.get("in_stock", "false").lower() in ("true", "1")
        if in_stock_only:
            variants = variants.filter(stock__quantity__gt=0)

        serializer = ShopProductVariantSerializer(variants, many=True, context={"request": request})
        return Response(serializer.data, status=status.HTTP_200_OK)


class ShopTenantProductDetailView(APIView):
    """
    Shop mikroservisi uchun: bitta tovar variantining jonli narxi va ombordagi qoldig'i.
    """
    authentication_classes = []
    permission_classes = [IsInternalService]

    @extend_schema(request=None, responses={200: ShopProductVariantSerializer})
    def get(self, request, tenant_id, variant_id):
        tenant = get_object_or_404(Tenant, pk=tenant_id, is_active=True)
        variant = get_object_or_404(
            ProductVariant.objects.select_related(
                "product", "product__category", "stock"
            ).prefetch_related("product__gallery_images"),
            pk=variant_id,
            tenant=tenant,
            is_active=True,
            product__is_active=True,
        )
        serializer = ShopProductVariantSerializer(variant, context={"request": request})
        return Response(serializer.data, status=status.HTTP_200_OK)
