from django.db.models import Q
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.response import Response

from api.pagination import StandardResultsSetPagination
from api.permissions import HasEmployeePermission
from api.schema import optional_pagination
from api.v1.sales.b2b_idempotency import OPERATIONS, keyed_b2b_mutation
from api.v1.sales.serializers import (
    B2BAcceptInputSerializer,
    B2BIncomingSaleSerializer,
    B2BRejectInputSerializer,
    B2BReturnDiscrepancyCloseInputSerializer,
    B2BReturnInputSerializer,
    SaleOutputSerializer,
)
from apps.catalog.models import Category, ProductVariant
from apps.sales.models import Sale
from apps.sales.services import B2BTransferService, B2BTransferServiceError

from ._base import SalesAPIView


class B2BListQuerySerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Sale.STATUS_CHOICES, required=False)
    all_statuses = serializers.BooleanField(required=False, default=False)


class B2BInboxListView(SalesAPIView):
    permission_classes = [HasEmployeePermission]
    permission_map = {"GET": "sales.manage_b2b"}

    @extend_schema(request=None, responses={200: optional_pagination(B2BIncomingSaleSerializer)})
    def get(self, request):
        query = B2BListQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        incoming = (
            Sale.objects.filter(
                b2b_target_tenant=self.tenant,
            )
            .select_related("tenant", "sold_by")
            .prefetch_related("items__product_variant__product")
        )
        if not query.validated_data['all_statuses']:
            incoming = incoming.filter(status__in=[Sale.STATUS_B2B_PENDING, Sale.STATUS_B2B_PARTIALLY_ACCEPTED])
        if query.validated_data.get('status'):
            incoming = incoming.filter(status=query.validated_data['status'])
        incoming = incoming.order_by('-created_at', '-pk')
        search = (request.query_params.get('search') or '').strip()
        if search:
            incoming = incoming.filter(Q(receipt_number__icontains=search) | Q(tenant__name__icontains=search))
        if request.query_params.get('page'):
            paginator = StandardResultsSetPagination()
            rows = paginator.paginate_queryset(incoming, request)
            return paginator.get_paginated_response(B2BIncomingSaleSerializer(rows, many=True).data)
        return Response(B2BIncomingSaleSerializer(incoming, many=True).data)


class B2BCapabilitiesView(SalesAPIView):
    permission_classes = [HasEmployeePermission]
    permission_map = {'GET': 'sales.manage_b2b'}

    @extend_schema(request=None, responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        return Response({'b2b_mutations': 1, 'operations': OPERATIONS})


class B2BMappingListView(SalesAPIView):
    """Only the destination names/units required by a permitted B2B acceptance."""
    permission_classes = [HasEmployeePermission]
    permission_map = {'GET': 'sales.manage_b2b'}

    @extend_schema(request=None, responses={200: OpenApiTypes.OBJECT})
    def get(self, request, kind):
        if kind not in ('categories', 'variants'):
            raise serializers.ValidationError({'kind': ['Tanlov turi noto‘g‘ri.']})
        currency = request.query_params.get('currency', '')
        if currency not in ('UZS', 'USD'):
            raise serializers.ValidationError({'currency': ['UZS yoki USD tanlang.']})
        search = (request.query_params.get('search') or '').strip()
        if kind == 'categories':
            rows = Category.objects.filter(tenant=self.tenant, is_active=True, currency=currency)
            if search:
                rows = rows.filter(name__icontains=search)
        else:
            rows = ProductVariant.objects.filter(
                tenant=self.tenant, is_active=True, product__is_active=True,
                product__category__is_active=True, product__category__currency=currency,
            ).select_related('product')
            if search:
                rows = rows.filter(Q(name__icontains=search) | Q(product__name__icontains=search)
                                   | Q(barcode__icontains=search) | Q(code__icontains=search))
            if request.query_params.get('unit'):
                rows = rows.filter(unit=request.query_params['unit'])
        paginator = StandardResultsSetPagination()
        page = paginator.paginate_queryset(rows.order_by('name', 'pk'), request)
        result = [
            {'id': row.pk, 'name': row.name if kind == 'categories' else f'{row.product.name} · {row.name}',
             'currency': currency, **({'unit': row.unit} if kind != 'categories' else {})}
            for row in page
        ]
        return paginator.get_paginated_response(result)


class B2BOutgoingListView(SalesAPIView):
    permission_classes = [HasEmployeePermission]
    permission_map = {'GET': 'sales.manage_b2b'}

    @extend_schema(request=None, responses={200: optional_pagination(SaleOutputSerializer)})
    def get(self, request):
        query = B2BListQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        rows = Sale.objects.filter(tenant=self.tenant, b2b_target_tenant__isnull=False).select_related(
            'tenant', 'sold_by', 'counterparty', 'b2b_target_tenant',
        ).prefetch_related('items__product_variant__product').order_by('-created_at', '-pk')
        if query.validated_data.get('status'):
            rows = rows.filter(status=query.validated_data['status'])
        search = (request.query_params.get('search') or '').strip()
        if search:
            rows = rows.filter(Q(receipt_number__icontains=search) | Q(b2b_target_tenant__name__icontains=search))
        if request.query_params.get('page'):
            paginator = StandardResultsSetPagination()
            page = paginator.paginate_queryset(rows, request)
            return paginator.get_paginated_response(
                SaleOutputSerializer(page, many=True, context={'request': request}).data,
            )
        return Response(SaleOutputSerializer(rows, many=True, context={'request': request}).data)


class B2BDetailView(SalesAPIView):
    permission_classes = [HasEmployeePermission]
    permission_map = {'GET': 'sales.manage_b2b'}

    @extend_schema(request=None, responses={200: OpenApiTypes.OBJECT})
    def get(self, request, sale_id):
        sale = get_object_or_404(
            Sale.objects.filter(Q(tenant=self.tenant) | Q(b2b_target_tenant=self.tenant)).prefetch_related(
                'items__product_variant__product',
            ), pk=sale_id, b2b_target_tenant__isnull=False,
        )
        incoming = sale.tenant_id != self.tenant.pk
        return Response({
            'direction': 'incoming' if incoming else 'outgoing',
            'sale': B2BIncomingSaleSerializer(sale).data if incoming else SaleOutputSerializer(
                sale, context={'request': request},
            ).data,
        })


class B2BAcceptView(SalesAPIView):
    permission_classes = [HasEmployeePermission]
    permission_map = {"POST": "sales.manage_b2b"}

    @extend_schema(request=B2BAcceptInputSerializer, responses={200: B2BIncomingSaleSerializer})
    @keyed_b2b_mutation("accept")
    def post(self, request, sale_id):
        # Incoming sale belongs to sender tenant, but b2b_target_tenant must match current tenant
        sale = get_object_or_404(Sale, pk=sale_id, b2b_target_tenant=self.tenant)
        serializer = B2BAcceptInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            updated_sale = B2BTransferService.accept_transfer(
                sale=sale,
                accepting_user=request.user,
                tenant=self.tenant,
                items_payload=serializer.validated_data["items"],
            )
        except B2BTransferServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(B2BIncomingSaleSerializer(updated_sale).data, status=status.HTTP_200_OK)


class B2BRejectView(SalesAPIView):
    permission_classes = [HasEmployeePermission]
    permission_map = {"POST": "sales.manage_b2b"}

    @extend_schema(request=B2BRejectInputSerializer, responses={200: B2BIncomingSaleSerializer})
    @keyed_b2b_mutation("reject")
    def post(self, request, sale_id):
        sale = get_object_or_404(Sale, pk=sale_id, b2b_target_tenant=self.tenant)
        serializer = B2BRejectInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            rejected_sale = B2BTransferService.reject_transfer(
                sale=sale,
                rejecting_user=request.user,
                tenant=self.tenant,
                reason=serializer.validated_data["reason"],
            )
        except B2BTransferServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(B2BIncomingSaleSerializer(rejected_sale).data, status=status.HTTP_200_OK)


class B2BReturnReceiveView(SalesAPIView):
    permission_classes = [HasEmployeePermission]
    permission_map = {"POST": "sales.manage_b2b"}

    @extend_schema(request=B2BReturnInputSerializer, responses={200: OpenApiTypes.OBJECT})
    @keyed_b2b_mutation("receive")
    def post(self, request, sale_id):
        sale = get_object_or_404(Sale, pk=sale_id, tenant=self.tenant, b2b_target_tenant__isnull=False)
        serializer = B2BReturnInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            receipt = B2BTransferService.receive_return(
                sale=sale,
                receiving_user=request.user,
                tenant=self.tenant,
                items_payload=serializer.validated_data["items"],
                reason=serializer.validated_data["reason"],
                idempotency_key=serializer.validated_data["idempotency_key"],
            )
        except B2BTransferServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {
                "receipt_id": receipt.id,
                "sale": SaleOutputSerializer(receipt.sale, context={"request": request}).data,
            },
            status=status.HTTP_200_OK,
        )


class B2BReturnDiscrepancyCloseView(SalesAPIView):
    permission_classes = [HasEmployeePermission]
    permission_map = {"POST": "sales.manage_b2b"}

    @extend_schema(request=B2BReturnDiscrepancyCloseInputSerializer, responses={200: OpenApiTypes.OBJECT})
    @keyed_b2b_mutation("close_discrepancy")
    def post(self, request, sale_id):
        sale = get_object_or_404(Sale, pk=sale_id, tenant=self.tenant, b2b_target_tenant__isnull=False)
        serializer = B2BReturnDiscrepancyCloseInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            closure = B2BTransferService.close_return_discrepancy(
                sale=sale,
                closing_user=request.user,
                tenant=self.tenant,
                items_payload=serializer.validated_data["items"],
                reason=serializer.validated_data["reason"],
                idempotency_key=serializer.validated_data["idempotency_key"],
            )
        except B2BTransferServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        closure.sale.refresh_from_db()
        return Response(
            {
                "closure_id": closure.id,
                "sale": SaleOutputSerializer(closure.sale, context={"request": request}).data,
            },
            status=status.HTTP_200_OK,
        )
