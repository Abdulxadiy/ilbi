from django.db.models import Count, F, Q, Sum
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response

from api.permissions import HasEmployeePermission
from api.schema import optional_pagination
from api.v1.sales.serializers import (
    CounterpartyCreateSerializer,
    CounterpartyOutputSerializer,
    CounterpartyUpdateSerializer,
    DebtPaymentCorrectionSerializer,
    DebtPaymentCreateSerializer,
    DebtPaymentOutputSerializer,
    DebtPaymentQuoteSerializer,
    SaleOutputSerializer,
)
from apps.sales.models import Counterparty, DebtPayment, Sale
from apps.sales.services import (
    CounterpartyService,
    CounterpartyServiceError,
    DebtService,
    DebtServiceError,
)
from apps.sales.services.counterparty_queries import filtered_counterparties

from ._base import SalesAPIView


class CounterpartyListCreateView(SalesAPIView):
    permission_classes = [HasEmployeePermission]
    permission_map = {
        'GET': ('sales.manage_counterparty', 'sales.record_debt_payment'),
        'POST': 'sales.manage_counterparty',
    }

    @extend_schema(request=None, responses={200: optional_pagination(CounterpartyOutputSerializer)})
    def get(self, request):
        from django.db.models import Prefetch
        payments_prefetch = Prefetch(
            'payments', queryset=DebtPayment.objects.select_related(
                'recorded_by', 'branch', 'tenant',
            ).order_by('-paid_at', '-pk')[:1],
            to_attr='prefetched_payments',
        )
        qs = filtered_counterparties(self.tenant, request.query_params).select_related(
            'target_tenant',
        ).prefetch_related(payments_prefetch)
        if request.query_params.get('page'):
            from api.pagination import StandardResultsSetPagination
            paginator = StandardResultsSetPagination()
            page_data = paginator.paginate_queryset(qs, request)
            response = paginator.get_paginated_response(CounterpartyOutputSerializer(page_data, many=True).data)
            # Store-wide KPIs stay independent of the current list page/filter.
            summary = Counterparty.objects.filter(tenant=self.tenant, is_active=True).aggregate(
                total_count=Count('pk'),
                debtors_count=Count('pk', filter=Q(debt_balance_uzs__gt=0) | Q(debt_balance_usd__gt=0)),
                credit_count=Count('pk', filter=Q(debt_balance_uzs__lt=0) | Q(debt_balance_usd__lt=0)),
                settled_count=Count('pk', filter=Q(debt_balance_uzs=0, debt_balance_usd=0)),
                total_debt_uzs=Sum('debt_balance_uzs', filter=Q(debt_balance_uzs__gt=0)),
                total_debt_usd=Sum('debt_balance_usd', filter=Q(debt_balance_usd__gt=0)),
                total_credit_uzs=Sum('debt_balance_uzs', filter=Q(debt_balance_uzs__lt=0)),
            )
            summary['total_credit_uzs'] = -(summary['total_credit_uzs'] or 0)
            response.data['summary'] = summary
            return response
        return Response(CounterpartyOutputSerializer(qs, many=True).data)

    @extend_schema(request=CounterpartyCreateSerializer, responses={201: CounterpartyOutputSerializer})
    def post(self, request):
        serializer = CounterpartyCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            cp = CounterpartyService.create(tenant=self.tenant, **serializer.validated_data)
        except CounterpartyServiceError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(CounterpartyOutputSerializer(cp).data, status=status.HTTP_201_CREATED)


class CounterpartyDetailView(SalesAPIView):
    permission_classes = [HasEmployeePermission]
    permission_map = {
        'GET': ('sales.manage_counterparty', 'sales.record_debt_payment'),
        'PATCH': 'sales.manage_counterparty',
        'DELETE': 'sales.manage_counterparty',
    }

    @extend_schema(request=None, responses={200: CounterpartyOutputSerializer})
    def get(self, request, pk):
        from django.db.models import Prefetch
        payments_prefetch = Prefetch(
            'payments',
            queryset=DebtPayment.objects.select_related(
                'recorded_by', 'branch', 'tenant',
            ).order_by('-paid_at', '-pk')[:1],
            to_attr='prefetched_payments'
        )
        cp = get_object_or_404(
            Counterparty.objects.prefetch_related(payments_prefetch),
            pk=pk,
            tenant=self.tenant
        )
        return Response(CounterpartyOutputSerializer(cp).data)

    @extend_schema(request=CounterpartyUpdateSerializer, responses={200: CounterpartyOutputSerializer})
    def patch(self, request, pk):
        cp = get_object_or_404(Counterparty, pk=pk, tenant=self.tenant)
        serializer = CounterpartyUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        try:
            cp = CounterpartyService.update(cp, **serializer.validated_data)
        except CounterpartyServiceError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(CounterpartyOutputSerializer(cp).data)

    @extend_schema(request=None, responses={200: OpenApiTypes.OBJECT})
    def delete(self, request, pk):
        cp = get_object_or_404(Counterparty, pk=pk, tenant=self.tenant)
        try:
            CounterpartyService.archive(cp)
        except CounterpartyServiceError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response({'detail': 'Kontragent arxivlandi.'}, status=status.HTTP_200_OK)


class DebtPaymentListCreateView(SalesAPIView):
    permission_classes = [HasEmployeePermission]
    permission_map = {
        'GET': ('sales.manage_counterparty', 'sales.record_debt_payment'),
        'POST': 'sales.record_debt_payment',
    }

    @extend_schema(request=None, responses={200: DebtPaymentOutputSerializer(many=True)})
    def get(self, request, counterparty_id):
        cp = get_object_or_404(Counterparty, pk=counterparty_id, tenant=self.tenant)
        payments = DebtPayment.objects.filter(counterparty=cp).select_related(
            'recorded_by', 'branch', 'tenant',
        ).order_by('-paid_at', '-pk')
        if request.query_params.get('page'):
            from api.pagination import StandardResultsSetPagination
            paginator = StandardResultsSetPagination()
            rows = paginator.paginate_queryset(payments, request)
            return paginator.get_paginated_response(DebtPaymentOutputSerializer(rows, many=True).data)
        return Response(DebtPaymentOutputSerializer(payments, many=True).data)

    @extend_schema(request=DebtPaymentCreateSerializer, responses={201: DebtPaymentOutputSerializer})
    def post(self, request, counterparty_id):
        cp = get_object_or_404(Counterparty, pk=counterparty_id, tenant=self.tenant)
        serializer = DebtPaymentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        branch_id = data.get('branch_id')
        branch = None
        if branch_id:
            from apps.tenants.models import Tenant
            if request.user.role == 'platform_admin':
                branch = get_object_or_404(Tenant, pk=branch_id)
            else:
                owner_id = self.tenant.owner_id if self.tenant else request.user.id
                branch = get_object_or_404(Tenant, pk=branch_id, owner_id=owner_id)
        else:
            branch = self.tenant

        try:
            payment = DebtService.record_payment(
                counterparty=cp,
                amount=data['amount'],
                currency=data['currency'],
                recorded_by=request.user,
                branch=branch,
                payment_type=data["payment_type"], idempotency_key=data.get("idempotency_key"),
                expected_quote=data.get('expected_quote'),
                is_correction=False,
                note=data.get('note', ''),
            )
        except DebtServiceError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        result = dict(DebtPaymentOutputSerializer(payment).data)
        if hasattr(payment, '_payment_operation'):
            result['payment_operation'] = payment._payment_operation
        return Response(result, status=status.HTTP_201_CREATED)


class DebtPaymentQuoteView(SalesAPIView):
    permission_classes = [HasEmployeePermission]
    required_permission = "sales.record_debt_payment"

    @extend_schema(request=None, parameters=[DebtPaymentQuoteSerializer], responses={200: OpenApiTypes.OBJECT})
    def get(self, request, counterparty_id):
        cp = get_object_or_404(Counterparty, pk=counterparty_id, tenant=self.tenant)
        serializer = DebtPaymentQuoteSerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        branch = self.tenant
        if data.get("branch_id"):
            from apps.tenants.models import Tenant

            branch = get_object_or_404(Tenant, pk=data["branch_id"], owner_id=self.tenant.owner_id)
        try:
            result = DebtService.payment_quote(
                counterparty=cp,
                amount=data["amount"],
                currency=data["currency"],
                recorded_by=request.user,
                branch=branch,
                payment_type=data["payment_type"],
            )
        except DebtServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        response = Response(result)
        response["Cache-Control"] = "no-store"
        return response


class DebtPaymentCorrectionView(SalesAPIView):
    permission_classes = [HasEmployeePermission]
    permission_map = {'POST': 'sales.correct_debt_payment'}

    @extend_schema(request=DebtPaymentCorrectionSerializer, responses={201: DebtPaymentOutputSerializer})
    def post(self, request, counterparty_id):
        cp = get_object_or_404(Counterparty, pk=counterparty_id, tenant=self.tenant)
        serializer = DebtPaymentCorrectionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        branch_id = data.get('branch_id')
        branch = None
        if branch_id:
            from apps.tenants.models import Tenant
            if request.user.role == 'platform_admin':
                branch = get_object_or_404(Tenant, pk=branch_id)
            else:
                owner_id = self.tenant.owner_id if self.tenant else request.user.id
                branch = get_object_or_404(Tenant, pk=branch_id, owner_id=owner_id)
        else:
            branch = self.tenant

        try:
            payment = DebtService.record_payment(
                counterparty=cp,
                amount=data['amount'],
                currency=data['currency'],
                recorded_by=request.user,
                branch=branch,
                payment_type=data["payment_type"], idempotency_key=data.get("idempotency_key"),
                is_correction=True,
                note=data['note'],
            )
        except DebtServiceError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(DebtPaymentOutputSerializer(payment).data, status=status.HTTP_201_CREATED)


class CounterpartySalesListView(SalesAPIView):
    permission_classes = [HasEmployeePermission]
    permission_map = {
        'GET': ('sales.manage_counterparty', 'sales.record_debt_payment'),
    }

    @extend_schema(request=None, responses={200: OpenApiTypes.OBJECT})
    def get(self, request, counterparty_id):
        cp = get_object_or_404(Counterparty, pk=counterparty_id, tenant=self.tenant)
        qs = Sale.objects.filter(
            tenant=self.tenant,
            counterparty=cp,
        ).select_related(
            'tenant', 'sold_by', 'counterparty', 'b2b_target_tenant'
        ).prefetch_related(
            'items__product_variant__product'
        ).order_by('-created_at')

        payment_type = request.query_params.get('payment_type')
        if payment_type:
            qs = qs.filter(payment_type=payment_type)

        search = request.query_params.get('search')
        if search:
            search = search.strip()
            qs = qs.filter(
                Q(receipt_number__icontains=search)
                | Q(items__product_variant__product__name__icontains=search)
                | Q(items__product_variant__name__icontains=search)
            ).distinct()

        summary = Sale.objects.filter(tenant=self.tenant, counterparty=cp).aggregate(
            total_sales_count=Count('pk'), debt_sales_count=Count('pk', filter=Q(payment_type=Sale.PAYMENT_DEBT)),
            total_spent_uzs=Sum(F('total_amount') - F('refunded_amount'), filter=Q(currency='UZS')),
            total_spent_usd=Sum(F('total_amount') - F('refunded_amount'), filter=Q(currency='USD')),
        )
        summary['payments_count'] = cp.payments.count()
        if request.query_params.get('page'):
            from api.pagination import StandardResultsSetPagination
            paginator = StandardResultsSetPagination()
            rows = paginator.paginate_queryset(qs, request)
            response = paginator.get_paginated_response(
                SaleOutputSerializer(rows, many=True, context={'request': request}).data,
            )
            response.data['summary'] = summary
            return response
        return Response({
            'counterparty': CounterpartyOutputSerializer(cp).data, **summary, 'summary': summary,
            'sales': SaleOutputSerializer(qs, many=True, context={'request': request}).data,
        })
