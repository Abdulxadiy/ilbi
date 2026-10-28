from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from api.mixins import TenantContextMixin
from api.pagination import StandardResultsSetPagination
from api.permissions import IsOwnerOrPlatformAdmin
from api.query_params import positive_id
from api.schema import optional_pagination
from api.v1.sales.serializers import SaleOutputSerializer
from apps.core.services.history_service import (
    history_details,
    history_event,
    history_sources,
    hydrate_history,
    timeline_queryset,
)
from apps.sales.models import Sale, SaleItem


class HistoryQuerySerializer(serializers.Serializer):
    category = serializers.ChoiceField(
        choices=["all", "sales", "inventory", "catalog", "finance", "team", "settings"], default="all"
    )
    search = serializers.CharField(required=False, allow_blank=True, max_length=200)
    actor = serializers.IntegerField(required=False, min_value=1)
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)

    def validate(self, attrs):
        if attrs.get("date_from") and attrs.get("date_to") and attrs["date_from"] > attrs["date_to"]:
            raise serializers.ValidationError({"date_to": "Tugash sanasi boshlanish sanasidan oldin bo‘lmasin."})
        return attrs


class HistoryBaseView(TenantContextMixin, APIView):
    # History includes prices, cash and staff changes, like the existing audit journal.
    permission_classes = [IsOwnerOrPlatformAdmin]

    def selected_tenant_id(self, request):
        if request.user.role == "platform_admin":
            return positive_id(request.query_params.get("tenant_id"), "tenant_id")
        return self.tenant.pk


class HistoryEventSerializer(serializers.Serializer):
    id = serializers.CharField()
    source = serializers.CharField()
    object_id = serializers.IntegerField()
    created_at = serializers.DateTimeField()
    tenant_id = serializers.IntegerField(allow_null=True)
    tenant_name = serializers.CharField()
    actor_id = serializers.IntegerField(allow_null=True)
    actor_name = serializers.CharField()
    category = serializers.CharField()
    title = serializers.CharField()
    subtitle = serializers.CharField()
    reference = serializers.CharField()
    status = serializers.CharField()
    amount = serializers.CharField(allow_null=True)
    currency = serializers.CharField()
    quantity = serializers.CharField(allow_null=True)
    unit = serializers.CharField()
    sale_id = serializers.IntegerField(allow_null=True)
    direction = serializers.CharField(required=False)
    action = serializers.CharField(required=False)


class HistoryDetailSerializer(serializers.Serializer):
    event = HistoryEventSerializer()
    details = serializers.JSONField()
    sale = SaleOutputSerializer(allow_null=True)


class HistoryListView(HistoryBaseView):
    @extend_schema(
        request=None,
        parameters=[HistoryQuerySerializer, OpenApiParameter("tenant_id", OpenApiTypes.INT)],
        responses={200: optional_pagination(HistoryEventSerializer)},
    )
    def get(self, request):
        query = HistoryQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        sources = history_sources(self.selected_tenant_id(request), query.validated_data)
        paginator = StandardResultsSetPagination()
        rows = paginator.paginate_queryset(timeline_queryset(sources), request)
        return paginator.get_paginated_response(hydrate_history(rows, sources))


class HistoryDetailView(HistoryBaseView):
    @extend_schema(
        request=None,
        parameters=[OpenApiParameter("tenant_id", OpenApiTypes.INT)],
        responses={200: HistoryDetailSerializer},
    )
    def get(self, request, source, pk):
        tenant_id = self.selected_tenant_id(request)
        sources = history_sources(tenant_id)
        if source not in sources:
            raise NotFound()
        obj = get_object_or_404(sources[source][0], pk=pk)
        event = history_event(source, obj, sources[source])
        if source == "audit" and obj.target_model == "SaleItem" and obj.target_id.isdigit():
            event["sale_id"] = (
                SaleItem.objects.filter(pk=obj.target_id, tenant_id=obj.tenant_id)
                .values_list(
                    "sale_id",
                    flat=True,
                )
                .first()
            )
        result = {"event": event, "details": history_details(source, obj), "sale": None}
        if event.get("sale_id"):
            sale = (
                Sale.objects.select_related(
                    "tenant",
                    "sold_by",
                    "counterparty",
                    "b2b_target_tenant",
                )
                .prefetch_related("items__product_variant__product")
                .filter(pk=event["sale_id"], tenant_id=obj.tenant_id)
                .first()
            )
            if sale is not None:
                result["sale"] = SaleOutputSerializer(sale, context={"request": request}).data
            else:
                # Receiving-side B2B audit records may reference another store's sale.
                # Keep the local event readable without exposing the sender's private receipt.
                event["sale_id"] = None
        return Response(result)
