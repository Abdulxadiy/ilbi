from datetime import timedelta

from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response

from api.permissions import HasEmployeePermission
from api.query_params import positive_id
from api.schema import optional_pagination
from api.v1.inventory.idempotency import keyed_inventory_mutation
from api.v1.inventory.serializers import (
    AdjustCreateSerializer,
    BatchIntakeCreateSerializer,
    IntakeCreateSerializer,
    SimpleMovementCreateSerializer,
    StockMovementOutputSerializer,
)
from apps.catalog.models import ProductVariant
from apps.inventory.models import StockMovement
from apps.inventory.services import StockService, StockServiceError

from ._base import InventoryAPIView


class StockMovementListView(InventoryAPIView):
    """GET /api/v1/inventory/movements/?product_variant_id=X -- full
    audit history. `product_variant_id` is optional."""

    permission_classes = [HasEmployeePermission]
    required_permission = "inventory.view_stock"

    @extend_schema(request=None, responses={200: optional_pagination(StockMovementOutputSerializer)})
    def get(self, request):
        movements = StockMovement.objects.filter(tenant=self.tenant).select_related(
            "created_by", "product_variant", "product_variant__product", "product_variant__product__category"
        )
        variant_id = positive_id(request.query_params.get("product_variant_id"), "product_variant_id")
        if variant_id:
            get_object_or_404(ProductVariant, pk=variant_id, tenant=self.tenant)
            movements = movements.filter(product_variant_id=variant_id)

        search = (request.query_params.get("search") or "").strip()
        if search:
            movements = movements.filter(
                Q(product_variant__product__name__icontains=search)
                | Q(product_variant__name__icontains=search)
                | Q(note__icontains=search)
            )
        movement_type = request.query_params.get("type")
        if movement_type and movement_type != "all":
            movements = movements.filter(type=movement_type)
        date_filter = request.query_params.get("date")
        today = timezone.localdate()
        if date_filter == "today":
            movements = movements.filter(created_at__date=today)
        elif date_filter == "yesterday":
            movements = movements.filter(created_at__date=today - timedelta(days=1))
        elif date_filter == "week":
            movements = movements.filter(created_at__gte=timezone.now() - timedelta(days=7))
        elif date_filter == "month":
            movements = movements.filter(created_at__date__gte=today.replace(day=1), created_at__date__lte=today)
        movements = movements.order_by("-created_at", "-pk")
        if request.query_params.get("page"):
            from api.pagination import StandardResultsSetPagination
            paginator = StandardResultsSetPagination()
            page_data = paginator.paginate_queryset(movements, request)
            return paginator.get_paginated_response(
                StockMovementOutputSerializer(page_data, many=True, context={"request": request}).data
            )

        return Response(StockMovementOutputSerializer(movements, many=True, context={"request": request}).data)


class _BaseMovementCreateView(InventoryAPIView):
    serializer_class = None
    service_method_name = None

    @extend_schema(responses={201: StockMovementOutputSerializer})
    @keyed_inventory_mutation('movement')
    def post(self, request):
        serializer = self.serializer_class(
            data=request.data,
            context={"tenant": self.tenant, "request": request},
        )
        serializer.is_valid(raise_exception=True)
        val_data = dict(serializer.validated_data)
        val_data.pop('idempotency_key', None)

        service_method = getattr(StockService, self.service_method_name)
        try:
            movement = service_method(
                tenant=self.tenant, created_by=request.user, **val_data
            )
        except StockServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            StockMovementOutputSerializer(movement, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class StockIntakeCreateView(_BaseMovementCreateView):
    permission_classes = [HasEmployeePermission]
    required_permission = "inventory.add_stock_intake"
    serializer_class = IntakeCreateSerializer
    service_method_name = "intake"


class StockBatchIntakeCreateView(InventoryAPIView):
    permission_classes = [HasEmployeePermission]
    required_permission = "inventory.add_stock_intake"

    @extend_schema(request=BatchIntakeCreateSerializer, responses={201: StockMovementOutputSerializer(many=True)})
    @keyed_inventory_mutation('movement_list', 'stock.batch_intake')
    def post(self, request):
        serializer = BatchIntakeCreateSerializer(
            data=request.data,
            context={"tenant": self.tenant, "request": request},
        )
        serializer.is_valid(raise_exception=True)
        val_data = dict(serializer.validated_data)

        try:
            movements = StockService.batch_intake(
                tenant=self.tenant,
                created_by=request.user,
                items=val_data["items"],
                supplier=val_data.get("supplier", ""),
                faktura_number=val_data.get("faktura_number", ""),
                common_note=val_data.get("note", ""),
            )
        except StockServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            StockMovementOutputSerializer(movements, many=True, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class CustomerReturnCreateView(_BaseMovementCreateView):
    permission_classes = [HasEmployeePermission]
    required_permission = "inventory.adjust_stock"
    serializer_class = SimpleMovementCreateSerializer
    service_method_name = "customer_return"


class SupplierReturnCreateView(_BaseMovementCreateView):
    permission_classes = [HasEmployeePermission]
    required_permission = "inventory.adjust_stock"
    serializer_class = SimpleMovementCreateSerializer
    service_method_name = "supplier_return"


class WriteOffCreateView(_BaseMovementCreateView):
    permission_classes = [HasEmployeePermission]
    required_permission = "inventory.adjust_stock"
    serializer_class = SimpleMovementCreateSerializer
    service_method_name = "write_off"


class StockAdjustCreateView(_BaseMovementCreateView):
    permission_classes = [HasEmployeePermission]
    required_permission = "inventory.adjust_stock"
    serializer_class = AdjustCreateSerializer
    service_method_name = "adjust"
