from django.db.models import Q, Count
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from api.permissions import HasEmployeePermission, IsActiveOwner
from api.schema import optional_pagination
from api.v1.sales.serializers import (
    PublicReceiptSerializer,
    SaleCreateInputSerializer,
    SaleItemOutputSerializer,
    SaleItemVoidSerializer,
    SaleListQuerySerializer,
    SaleOutputSerializer,
    SaleVoidSerializer,
)
from apps.inventory.services import StockServiceError
from apps.sales.models import Counterparty, Sale, SaleItem
from apps.sales.services import SaleService, SaleServiceError, VoidService, VoidServiceError
from apps.sales.services.receipt_token_service import ReceiptTokenService

from ._base import SalesAPIView


class PublicReceiptRateThrottle(AnonRateThrottle):
    rate = '60/minute'


class SaleListCreateView(SalesAPIView):
    permission_classes = [HasEmployeePermission]
    permission_map = {
        'GET': 'sales.view_sale',
        'POST': 'sales.add_sale',
    }

    def get_queryset(self, request):
        query = SaleListQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        params = query.validated_data
        qs = Sale.objects.filter(tenant=self.tenant).select_related(
            'tenant', 'sold_by', 'counterparty', 'b2b_target_tenant'
        ).prefetch_related('items__product_variant__product')

        status_param = params.get('status')
        if status_param:
            qs = qs.filter(status=status_param)

        currency_param = params.get('currency')
        if currency_param:
            qs = qs.filter(currency=currency_param)

        cp_param = params.get('counterparty_id')
        if cp_param:
            qs = qs.filter(counterparty_id=cp_param)

        payment_type = params.get('payment_type')
        if payment_type:
            qs = qs.filter(payment_type=payment_type)

        if params.get("b2b_only") is not None:
            qs = qs.filter(b2b_target_tenant__isnull=not params["b2b_only"])
        search = request.query_params.get('search')
        if search:
            search = search.strip()
            qs = qs.filter(
                Q(receipt_number__icontains=search)
                | Q(b2b_target_tenant__name__icontains=search)
                | Q(counterparty__name__icontains=search)
                | Q(counterparty__phone_number__icontains=search)
                | Q(sold_by__first_name__icontains=search)
                | Q(sold_by__last_name__icontains=search)
                | Q(sold_by__username__icontains=search)
            )

        date_from = params.get('date_from')
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)

        date_to = params.get('date_to')
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)

        return qs

    @extend_schema(request=None, responses={200: optional_pagination(SaleOutputSerializer)}, parameters=[SaleListQuerySerializer])
    def get(self, request):
        qs = self.get_queryset(request)
        if request.query_params.get('page'):
            from api.pagination import StandardResultsSetPagination
            paginator = StandardResultsSetPagination()
            page_data = paginator.paginate_queryset(qs, request)
            response = paginator.get_paginated_response(SaleOutputSerializer(page_data, many=True, context={"request": request}).data)
            if request.query_params.get('b2b_only', '').lower() in ('true', '1'):
                response.data['summary'] = Sale.objects.filter(tenant=self.tenant, b2b_target_tenant__isnull=False).aggregate(
                    total_count=Count('pk'), return_pending_count=Count('pk', filter=Q(status=Sale.STATUS_B2B_RETURN_PENDING)),
                )
            return response

        return Response(SaleOutputSerializer(qs, many=True, context={"request": request}).data)

    @extend_schema(request=SaleCreateInputSerializer, responses={201: SaleOutputSerializer(many=True)})
    def post(self, request):
        serializer = SaleCreateInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        counterparty = None
        cp_id = data.get('counterparty_id')
        if cp_id:
            counterparty = get_object_or_404(Counterparty, pk=cp_id, tenant=self.tenant)

        try:
            sales = SaleService.create_sale(
                tenant=self.tenant,
                user=request.user,
                items_data=data['items'],
                payment_type=data.get('payment_type', 'cash'),
                counterparty=counterparty,
                is_partner_sale=data.get('is_partner_sale', False),
                idempotency_key=data.get('idempotency_key'),
                expected_tax_settings=data.get('expected_tax_settings'),
                **({'debt_due_date': data['debt_due_date']} if 'debt_due_date' in data else {}),
            )
        except (SaleServiceError, StockServiceError) as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        sale_ids = [s.id for s in sales]
        sales_qs = (
            Sale.objects.filter(id__in=sale_ids)
            .select_related('tenant', 'sold_by', 'counterparty', 'b2b_target_tenant')
            .prefetch_related('items__product_variant__product')
        )
        return Response(SaleOutputSerializer(sales_qs, many=True, context={"request": request}).data, status=status.HTTP_201_CREATED)


class SaleDetailView(SalesAPIView):
    permission_classes = [HasEmployeePermission]
    permission_map = {'GET': 'sales.view_sale'}

    @extend_schema(request=None, responses={200: SaleOutputSerializer})
    def get(self, request, pk):
        sale = get_object_or_404(
            Sale.objects.select_related(
                'tenant', 'sold_by', 'counterparty', 'b2b_target_tenant'
            ).prefetch_related('items__product_variant__product'),
            pk=pk,
            tenant=self.tenant,
        )
        return Response(SaleOutputSerializer(sale, context={"request": request}).data)


class SaleReceiptTokenRotateView(SalesAPIView):
    permission_classes = [IsActiveOwner]

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
    def post(self, request, pk):
        sale = get_object_or_404(Sale, pk=pk, tenant=self.tenant)
        token = ReceiptTokenService.rotate(sale_id=sale.id, tenant=self.tenant, actor=request.user)
        return Response({"public_token": token}, status=status.HTTP_200_OK)


class SaleCapabilitiesView(SalesAPIView):
    permission_classes = [HasEmployeePermission]
    required_permission = 'sales.view_sale'

    @extend_schema(request=None, responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        return Response({"sale_void_idempotency": 1, "partial_void_quantity_scale": 3})


class SaleVoidView(SalesAPIView):
    permission_classes = [HasEmployeePermission]
    permission_map = {'POST': 'sales.void_sale'}

    @extend_schema(request=SaleVoidSerializer, responses={200: SaleOutputSerializer})
    def post(self, request, pk):
        sale = get_object_or_404(Sale, pk=pk, tenant=self.tenant)
        serializer = SaleVoidSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            voided_sale = VoidService.void_sale(
                sale=sale,
                user=request.user,
                reason=serializer.validated_data['reason'],
                idempotency_key=serializer.validated_data.get('idempotency_key'),
            )
        except VoidServiceError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        payload = dict(SaleOutputSerializer(voided_sale, context={"request": request}).data)
        if hasattr(voided_sale, '_void_operation'):
            payload['void_operation'] = voided_sale._void_operation
        return Response(payload, status=status.HTTP_200_OK)


class SaleItemVoidView(SalesAPIView):
    permission_classes = [HasEmployeePermission]
    permission_map = {'POST': 'sales.void_sale'}

    @extend_schema(request=SaleItemVoidSerializer, responses={200: SaleItemOutputSerializer})
    def post(self, request, pk):
        sale_item = get_object_or_404(SaleItem, pk=pk, tenant=self.tenant)
        serializer = SaleItemVoidSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            item = VoidService.void_sale_item(
                sale_item=sale_item,
                user=request.user,
                quantity=serializer.validated_data['quantity'],
                reason=serializer.validated_data['reason'],
                idempotency_key=serializer.validated_data.get('idempotency_key'),
            )
        except VoidServiceError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        payload = dict(SaleItemOutputSerializer(item, context={"request": request}).data)
        if hasattr(item, '_void_operation'):
            payload['void_operation'] = item._void_operation
        return Response(payload, status=status.HTTP_200_OK)


class PublicReceiptDetailView(APIView):
    """
    Publicly accessible endpoint for customers/borrowers scanning the QR code
    on their thermal paper receipt. No authentication required.
    Strictly returns customer-facing receipt details without revealing
    confidential cost_price or internal profit margins.
    """
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [PublicReceiptRateThrottle]

    @extend_schema(request=None, responses={200: PublicReceiptSerializer})
    def get(self, request, token):
        token = (token or "").strip()
        if not token:
            return Response({"detail": "Chek havolasi noto‘g‘ri."}, status=status.HTTP_400_BAD_REQUEST)

        sale = (
            Sale.objects.select_related("tenant", "sold_by", "counterparty")
            .prefetch_related("items__product_variant__product")
            .filter(public_token=token)
            .first()
        )

        if not sale:
            return Response({"detail": "Chek topilmadi."}, status=status.HTTP_404_NOT_FOUND)

        serializer = PublicReceiptSerializer(sale)
        return Response(serializer.data, status=status.HTTP_200_OK)

