from django.db.models import Prefetch, Q
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import status
from rest_framework.response import Response

from api.mixins import OwnerStaffOnlyAPIView
from api.pagination import StandardResultsSetPagination
from api.permissions import HasEmployeePermission
from api.schema import ShiftStatusSerializer, optional_pagination
from api.v1.cashbox.serializers import (
    CashExpenseSerializer,
    CashIncomeSerializer,
    DailyCashReportListSerializer,
    DailyCashReportSerializer,
    ShiftCloseSerializer,
    ShiftOpenSerializer,
)
from apps.cashbox.models import CashExpense, CashIncome, DailyCashReport
from apps.cashbox.services.cashbox_service import CashboxService, CashboxServiceError
from apps.cashbox.services.mutations import perform_cashbox_mutation


def filter_cashbox_rows(queryset, request, text_field):
    from rest_framework import serializers
    search = (request.query_params.get("search") or "").strip()
    if search:
        condition = Q(**{f"{text_field}__icontains": search})
        if queryset.model == DailyCashReport:
            condition |= Q(closed_by__first_name__icontains=search) | Q(closed_by__last_name__icontains=search)
            if search.isdigit():
                condition |= Q(pk=int(search))
        else:
            condition |= Q(note__icontains=search)
        queryset = queryset.filter(condition)
    for param, lookup in (("date_from", "date__gte"), ("date_to", "date__lte")):
        if request.query_params.get(param):
            value = serializers.DateField().run_validation(request.query_params[param])
            queryset = queryset.filter(**{lookup: value})
    return queryset


def cashbox_page(queryset, request, serializer):
    paginator = StandardResultsSetPagination()
    rows = paginator.paginate_queryset(queryset, request)
    return paginator.get_paginated_response(serializer(rows, many=True).data)


class _BaseCashboxAPIView(OwnerStaffOnlyAPIView):
    permission_classes = [HasEmployeePermission]
    required_permission = 'cashbox.view_cashbox'


class CashboxCapabilitiesView(_BaseCashboxAPIView):
    @extend_schema(request=None, responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        return Response({'cashbox_mutations': 1, 'idempotent_operations': ['open', 'close', 'income', 'expense']})


class CashExpenseListCreateView(_BaseCashboxAPIView):
    """Kassadan xarajatlar ro'yxati va yangi xarajat kiritish."""
    permission_map = {'GET': 'cashbox.view_cashbox', 'POST': 'cashbox.record_expense'}
    @extend_schema(request=None, responses={200: optional_pagination(CashExpenseSerializer)})
    def get(self, request):
        expenses = CashExpense.objects.filter(tenant=self.tenant).select_related("recorded_by").order_by("-date", "-pk")
        expenses = filter_cashbox_rows(expenses, request, "category")
        if request.query_params.get("page"):
            return cashbox_page(expenses, request, CashExpenseSerializer)
        serializer = CashExpenseSerializer(expenses, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @extend_schema(request=CashExpenseSerializer, responses={201: CashExpenseSerializer})
    def post(self, request):
        serializer = CashExpenseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            key = data.pop('idempotency_key', None)
            def action():
                expense = CashboxService.record_expense(
                    tenant=self.tenant, user=request.user, amount=data['amount'],
                    currency=data.get('currency', CashExpense.CURRENCY_UZS), category=data['category'],
                    note=data.get('note', ''), date=data.get('date'),
                )
                return CashExpenseSerializer(expense).data
            result = perform_cashbox_mutation(
                tenant=self.tenant, actor=request.user, key=key, kind='expense', payload=data, action=action,
            )
            return Response(result, status=status.HTTP_201_CREATED)
        except CashboxServiceError as e:
            return Response(
                {"error": {"code": "invalid_expense", "message": str(e)}},
                status=status.HTTP_400_BAD_REQUEST,
            )


class CashIncomeListCreateView(_BaseCashboxAPIView):
    """Kassaga qo'shimcha kirimlar ro'yxati va yangi kirim kiritish."""
    permission_map = {'GET': 'cashbox.view_cashbox', 'POST': 'cashbox.record_income'}
    @extend_schema(request=None, responses={200: optional_pagination(CashIncomeSerializer)})
    def get(self, request):
        incomes = CashIncome.objects.filter(tenant=self.tenant).select_related("recorded_by").order_by("-date", "-pk")
        incomes = filter_cashbox_rows(incomes, request, "source")
        if request.query_params.get("page"):
            return cashbox_page(incomes, request, CashIncomeSerializer)
        serializer = CashIncomeSerializer(incomes, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @extend_schema(request=CashIncomeSerializer, responses={201: CashIncomeSerializer})
    def post(self, request):
        serializer = CashIncomeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            key = data.pop('idempotency_key', None)
            def action():
                income = CashboxService.record_income(
                    tenant=self.tenant, user=request.user, amount=data['amount'],
                    currency=data.get('currency', CashIncome.CURRENCY_UZS), source=data['source'],
                    note=data.get('note', ''), date=data.get('date'),
                )
                return CashIncomeSerializer(income).data
            result = perform_cashbox_mutation(
                tenant=self.tenant, actor=request.user, key=key, kind='income', payload=data, action=action,
            )
            return Response(result, status=status.HTTP_201_CREATED)
        except CashboxServiceError as e:
            return Response(
                {"error": {"code": "invalid_income", "message": str(e)}},
                status=status.HTTP_400_BAD_REQUEST,
            )


class CurrentShiftStatusView(_BaseCashboxAPIView):
    """
    Kassaning joriy smenadagi jonli holati (kutilgan pul, tushumlar, xarajatlar).
    """
    @extend_schema(request=None, responses={200: ShiftStatusSerializer})
    def get(self, request):
        status_data = CashboxService.get_current_shift_status(
            self.tenant, include_entries=request.query_params.get("compact", "").lower() not in ("true", "1"),
        )
        # Format decimals to strings for clean JSON
        formatted = {
            k: f"{v:.2f}" if hasattr(v, "quantize") else v
            for k, v in status_data.items()
        }
        return Response(formatted, status=status.HTTP_200_OK)


class ShiftCloseView(_BaseCashboxAPIView):
    """Smenani yopish va Z-Hisobot yaratish."""
    required_permission = 'cashbox.manage_shift'
    @extend_schema(request=ShiftCloseSerializer, responses={201: DailyCashReportSerializer})
    def post(self, request):
        serializer = ShiftCloseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            key = data.pop('idempotency_key', None)
            def action():
                report = CashboxService.close_shift(
                    tenant=self.tenant, user=request.user, actual_cash_uzs=data['actual_cash_uzs'],
                    actual_cash_usd=data['actual_cash_usd'], discrepancy_reason=data.get('discrepancy_reason', ''),
                    staff_notes=data.get('staff_notes', ''), shift_id=data.get('shift_id'),
                )
                return DailyCashReportSerializer(report).data
            result = perform_cashbox_mutation(
                tenant=self.tenant, actor=request.user, key=key, kind='close', payload=data, action=action,
            )
            return Response(result, status=status.HTTP_201_CREATED)
        except CashboxServiceError as e:
            return Response(
                {"error": {"code": "shift_close_error", "message": str(e)}},
                status=status.HTTP_400_BAD_REQUEST,
            )


class DailyCashReportListView(_BaseCashboxAPIView):
    """
    O'tgan Z-Hisobotlar ro'yxati.
    """
    @extend_schema(request=None, responses={200: optional_pagination(DailyCashReportListSerializer)})
    def get(self, request):
        reports = DailyCashReport.objects.filter(tenant=self.tenant).select_related(
            "tenant", "closed_by",
        ).order_by("-closed_at", "-pk")
        reports = filter_cashbox_rows(reports, request, "staff_notes")
        if request.query_params.get("page"):
            return cashbox_page(reports, request, DailyCashReportListSerializer)
        reports = reports.prefetch_related(
            Prefetch("incomes", queryset=CashIncome.objects.select_related("recorded_by")),
            Prefetch("expenses", queryset=CashExpense.objects.select_related("recorded_by")),
        )
        serializer = DailyCashReportSerializer(reports, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


class DailyCashReportDetailView(_BaseCashboxAPIView):
    """
    Alohida Z-Hisobot tafsilotlari.
    """
    @extend_schema(request=None, responses={200: DailyCashReportSerializer})
    def get(self, request, pk):
        report = get_object_or_404(
            DailyCashReport.objects.select_related("tenant", "closed_by").prefetch_related(
                Prefetch("incomes", queryset=CashIncome.objects.select_related("recorded_by")),
                Prefetch("expenses", queryset=CashExpense.objects.select_related("recorded_by")),
            ), tenant=self.tenant, pk=pk,
        )
        serializer = DailyCashReportSerializer(report)
        return Response(serializer.data, status=status.HTTP_200_OK)


class ShiftOpenView(_BaseCashboxAPIView):
    required_permission = 'cashbox.manage_shift'

    @extend_schema(request=ShiftOpenSerializer, responses={201: ShiftStatusSerializer})
    def post(self, request):
        from api.v1.cashbox.serializers import ShiftOpenSerializer
        serializer = ShiftOpenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            data = dict(serializer.validated_data)
            key = data.pop('idempotency_key', None)
            payload = dict(data)
            data.pop('expected_report_id', None)
            def action():
                CashboxService.open_shift(tenant=self.tenant, user=request.user, **data)
                return CashboxService.get_current_shift_status(self.tenant)
            result = perform_cashbox_mutation(
                tenant=self.tenant, actor=request.user, key=key, kind='open', payload=payload, action=action,
            )
        except CashboxServiceError as exc:
            return Response({'detail': str(exc)}, status=400)
        return Response(result, status=201)
