from datetime import timedelta

from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.response import Response

from api.permissions import HasEmployeePermission
from api.serializers import SensitiveCostSerializerMixin, SensitiveSupplierSerializerMixin
from apps.inventory.models import StockBatch

from ._base import InventoryAPIView


class StockBatchOutputSerializer(SensitiveCostSerializerMixin, SensitiveSupplierSerializerMixin, serializers.ModelSerializer):
    product_name = serializers.CharField(source="product_variant.product.name", read_only=True)
    variant_name = serializers.CharField(source="product_variant.name", read_only=True)
    unit = serializers.CharField(source="product_variant.unit", read_only=True)
    currency = serializers.CharField(source="product_variant.currency", read_only=True)
    expiry_status = serializers.SerializerMethodField()

    class Meta:
        model = StockBatch
        fields = [
            "id",
            "product_variant",
            "product_name",
            "variant_name",
            "unit",
            "currency",
            "batch_code",
            "expires_on",
            "received_on",
            "quantity",
            "cost_price",
            "supplier",
            "expiry_status",
        ]
        read_only_fields = fields

    def get_expiry_status(self, obj) -> str:
        if obj.expires_on is None:
            return "unknown"
        today = timezone.localdate()
        if obj.expires_on < today:
            return "expired"
        return "soon" if obj.expires_on <= today + timedelta(days=30) else "valid"


class BatchListQuerySerializer(serializers.Serializer):
    product_variant_id = serializers.IntegerField(min_value=1, required=False)
    status = serializers.ChoiceField(choices=["all", "expired", "soon", "unknown", "valid"], default="all")
    include_empty = serializers.BooleanField(default=False)
    search = serializers.CharField(required=False, allow_blank=True, max_length=200)


class StockBatchListView(InventoryAPIView):
    permission_classes = [HasEmployeePermission]
    required_permission = "inventory.view_stock"

    @extend_schema(parameters=[BatchListQuerySerializer], responses={200: StockBatchOutputSerializer(many=True)})
    def get(self, request):
        query = BatchListQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        params = query.validated_data
        batches = StockBatch.objects.filter(tenant=self.tenant).select_related("product_variant__product__category")
        if not params["include_empty"]:
            batches = batches.filter(quantity__gt=0)
        if params.get("product_variant_id"):
            batches = batches.filter(product_variant_id=params["product_variant_id"])
        today = timezone.localdate()
        if params["status"] == "expired":
            batches = batches.filter(expires_on__lt=today)
        elif params["status"] == "soon":
            batches = batches.filter(expires_on__gte=today, expires_on__lte=today + timedelta(days=30))
        elif params["status"] == "unknown":
            batches = batches.filter(expires_on__isnull=True)
        elif params["status"] == "valid":
            batches = batches.filter(expires_on__gt=today + timedelta(days=30))
        if params.get("search"):
            from django.db.models import Q
            from apps.accounts.services.permission_service import PermissionService

            search_term = params["search"].strip()
            search_q = (
                Q(batch_code__icontains=search_term)
                | Q(product_variant__product__name__icontains=search_term)
            )
            if PermissionService.has_permission(
                request.user, "inventory.view_supplier", tenant=self.tenant, employee=self.employee
            ):
                search_q |= Q(supplier__icontains=search_term)

            batches = batches.filter(search_q)
        return Response(
            StockBatchOutputSerializer(
                batches.order_by("expires_on", "pk"), many=True, context={"request": request}
            ).data
        )


class StockSupplierListView(InventoryAPIView):
    permission_classes = [HasEmployeePermission]
    required_permission = "inventory.view_supplier"

    @extend_schema(responses={200: serializers.ListSerializer(child=serializers.CharField())})
    def get(self, request):
        from apps.inventory.models import StockMovement

        batch_suppliers = list(
            StockBatch.objects.filter(tenant=self.tenant)
            .exclude(supplier="")
            .values_list("supplier", flat=True)
            .distinct()
        )
        movement_suppliers = list(
            StockMovement.objects.filter(tenant=self.tenant)
            .exclude(supplier="")
            .values_list("supplier", flat=True)
            .distinct()
        )
        seen = set()
        unique_suppliers = []
        for s in batch_suppliers + movement_suppliers:
            clean = (s or "").strip()
            if clean and clean.lower() not in seen:
                seen.add(clean.lower())
                unique_suppliers.append(clean)
        unique_suppliers.sort(key=str.lower)
        return Response(unique_suppliers)
