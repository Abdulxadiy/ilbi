"""Explicit quote/commit contract for owner-approved refunds and corrections."""

from decimal import Decimal

from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.response import Response

from api.permissions import HasEmployeePermission
from api.v1.sales.serializers import DebtPaymentOutputSerializer
from apps.sales.models import Counterparty, DebtPayment
from apps.sales.services.debt_adjustment_service import DebtAdjustmentService
from apps.sales.services.debt_service import DebtServiceError
from apps.tenants.models import Tenant

from ._base import SalesAPIView


class AdjustmentQuoteSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=["credit_refund", "correction"])
    amount = serializers.DecimalField(max_digits=14, decimal_places=2)
    currency = serializers.ChoiceField(choices=["UZS", "USD"])
    payment_type = serializers.ChoiceField(choices=DebtPayment._meta.get_field("payment_type").choices)
    branch_id = serializers.IntegerField(required=False, min_value=1)
    note = serializers.CharField(max_length=2000)

    def validate(self, attrs):
        if attrs["amount"] == Decimal("0"):
            raise serializers.ValidationError({"amount": "Tuzatish summasi noldan farqli bo‘lishi kerak."})
        if attrs["kind"] == "credit_refund" and attrs["amount"] < 0:
            raise serializers.ValidationError({"amount": "Qaytarish summasi musbat bo‘lsin."})
        if attrs["kind"] == "credit_refund" and attrs["payment_type"] == "none":
            raise serializers.ValidationError({"payment_type": "Haq naqd yoki kartaga qaytariladi."})
        return attrs


class AdjustmentCommitSerializer(AdjustmentQuoteSerializer):
    idempotency_key = serializers.CharField(max_length=64)
    expected_quote = serializers.RegexField(regex=r"^[a-f0-9]{64}$", write_only=True)


class DebtAdjustmentQuoteView(SalesAPIView):
    permission_classes = [HasEmployeePermission]
    required_permission = "sales.correct_debt_payment"

    @extend_schema(request=AdjustmentQuoteSerializer, responses={200: OpenApiTypes.OBJECT})
    def post(self, request, counterparty_id):
        serializer = AdjustmentQuoteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        cp = get_object_or_404(Counterparty, pk=counterparty_id, tenant=self.tenant)
        data = dict(serializer.validated_data)
        branch_id = data.pop("branch_id", None)
        branch = get_object_or_404(Tenant, pk=branch_id, owner_id=self.tenant.owner_id) if branch_id else self.tenant
        try:
            result = DebtAdjustmentService.quote(counterparty=cp, actor=request.user, branch=branch, **data)
        except DebtServiceError as exc:
            return Response({"detail": str(exc)}, status=400)
        response = Response(result)
        response["Cache-Control"] = "no-store"
        return response


class DebtAdjustmentCommitView(SalesAPIView):
    permission_classes = [HasEmployeePermission]
    required_permission = "sales.correct_debt_payment"

    @extend_schema(request=AdjustmentCommitSerializer, responses={201: OpenApiTypes.OBJECT})
    def post(self, request, counterparty_id):
        serializer = AdjustmentCommitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        cp = get_object_or_404(Counterparty, pk=counterparty_id, tenant=self.tenant)
        data = dict(serializer.validated_data)
        branch_id = data.pop("branch_id", None)
        branch = get_object_or_404(Tenant, pk=branch_id, owner_id=self.tenant.owner_id) if branch_id else self.tenant
        try:
            payment = DebtAdjustmentService.commit(counterparty=cp, actor=request.user, branch=branch, **data)
        except DebtServiceError as exc:
            return Response({"detail": str(exc)}, status=400)
        result = dict(DebtPaymentOutputSerializer(payment).data)
        result["adjustment_operation"] = payment._adjustment_operation
        return Response(result, status=201)
