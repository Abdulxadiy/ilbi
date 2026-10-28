from django.db.models import Prefetch, Q
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response

from api.permissions import HasEmployeePermission
from api.query_params import positive_id
from api.schema import optional_pagination
from api.v1.inventory.serializers import StockOutputSerializer
from apps.accounts.services.permission_service import PermissionService
from apps.catalog.models import ProductVariant
from apps.inventory.models import Stock, StockBatch, StockMovement

from ._base import InventoryAPIView


def filtered_stock_queryset(tenant, params, request=None):
    stock = Stock.objects.filter(tenant=tenant).select_related(
        "product_variant", "product_variant__product", "product_variant__product__category"
    ).prefetch_related(
        Prefetch(
            "product_variant__stock_batches",
            queryset=StockBatch.objects.exclude(supplier="").order_by("-received_on", "-pk"),
            to_attr="_cached_supplier_batches",
        ),
        Prefetch(
            "product_variant__stock_movements",
            queryset=StockMovement.objects.filter(direction="in").exclude(supplier="").order_by("-created_at", "-pk"),
            to_attr="_cached_supplier_movements",
        ),
    )
    search = (params.get("search") or "").strip()
    if search:
        can_view_supplier = False
        if request is not None:
            cache = getattr(request, "_supplier_permission_cache", None)
            if cache is None:
                cache = request._supplier_permission_cache = {}
            employee = getattr(request, "employee", None)
            key = (request.user.pk, getattr(tenant, "pk", None), getattr(employee, "pk", None))
            if key not in cache:
                cache[key] = PermissionService.has_permission(
                    request.user, "inventory.view_supplier", tenant=tenant, employee=employee
                )
            can_view_supplier = cache[key]

        q_filter = (
            Q(product_variant__product__name__icontains=search)
            | Q(product_variant__name__icontains=search)
            | Q(product_variant__sku__icontains=search)
            | Q(product_variant__code__icontains=search)
            | Q(product_variant__barcode__icontains=search)
        )
        if can_view_supplier:
            q_filter |= (
                Q(product_variant__stock_batches__supplier__icontains=search)
                | Q(product_variant__stock_movements__supplier__icontains=search)
            )
            stock = stock.filter(q_filter).distinct()
        else:
            stock = stock.filter(q_filter)
    category = positive_id(params.get("category"), "category")
    if category:
        stock = stock.filter(product_variant__product__category_id=category)
    orderings = {
        "name_asc": "product_variant__product__name",
        "name_desc": "-product_variant__product__name",
        "qty_asc": "quantity", "qty_desc": "-quantity",
        "price_asc": "last_cost_price", "price_desc": "-last_cost_price",
    }
    return stock.order_by(orderings.get(params.get("sort"), "id"), "pk")


class StockListView(InventoryAPIView):
    """GET /api/v1/inventory/stock/ -- current balance for every variant
    that has ever had a movement. A variant with no Stock row yet simply
    doesn't appear here -- that absence IS "0 dona"."""

    permission_classes = [HasEmployeePermission]
    required_permission = "inventory.view_stock"

    @extend_schema(request=None, responses={200: optional_pagination(StockOutputSerializer)})
    def get(self, request):
        stock = filtered_stock_queryset(self.tenant, request.query_params, request=request)
        if request.query_params.get("page"):
            from api.pagination import StandardResultsSetPagination
            paginator = StandardResultsSetPagination()
            page_data = paginator.paginate_queryset(stock, request)
            return paginator.get_paginated_response(
                StockOutputSerializer(page_data, many=True, context={"request": request}).data
            )

        return Response(StockOutputSerializer(stock, many=True, context={"request": request}).data)


class StockDetailView(InventoryAPIView):
    """GET /api/v1/inventory/stock/{product_variant_id}/ -- current
    balance for one variant in the active tenant."""

    permission_classes = [HasEmployeePermission]
    required_permission = "inventory.view_stock"

    @extend_schema(request=None, responses={200: StockOutputSerializer})
    def get(self, request, product_variant_id):
        variant = get_object_or_404(ProductVariant, pk=product_variant_id, tenant=self.tenant)
        stock = Stock.objects.filter(tenant=self.tenant, product_variant=variant).first()
        if stock is None:
            return Response({
                "product_variant": variant.id,
                "quantity": "0.000",
                "last_cost_price": None,
            })
        return Response(StockOutputSerializer(stock, context={"request": request}).data)


class DeficitStockListView(InventoryAPIView):
    """
    GET /api/v1/inventory/deficits/
    Returns list of products whose 30-day sales >= 10 and current stock <= 5.
    """

    permission_classes = [HasEmployeePermission]
    required_permission = "inventory.view_stock"

    @extend_schema(request=None, responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        from apps.inventory.services import DeficitService

        search = request.query_params.get("search")
        deficits = DeficitService.get_deficit_variants(self.tenant, search_query=search)
        return Response(deficits)
