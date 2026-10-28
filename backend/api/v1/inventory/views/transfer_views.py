from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError

from api.permissions import HasEmployeePermission
from api.v1.inventory.idempotency import keyed_inventory_mutation
from api.v1.inventory.serializers import (
    TenantTransferCreateSerializer,
    TenantTransferDiscrepancyCloseSerializer,
    TenantTransferOutputSerializer,
    TenantTransferReceiveSerializer,
    TenantTransferReturnSerializer,
)
from apps.inventory.models import TenantTransfer
from apps.inventory.services.transfer_service import TenantTransferError, TenantTransferService

from ._base import InventoryAPIView


class TenantTransferListCreateView(InventoryAPIView):
    permission_classes = [HasEmployeePermission]
    required_permission = "inventory.transfer_stock"

    @extend_schema(request=None, responses={200: TenantTransferOutputSerializer(many=True)})
    def get(self, request):
        transfers = TenantTransfer.objects.filter(
            source_tenant=self.tenant
        ) | TenantTransfer.objects.filter(destination_tenant=self.tenant)
        transfers = transfers.select_related(
            "source_tenant", "destination_tenant", "created_by", "received_by"
        ).prefetch_related(
            "items__source_variant__product", "items__destination_variant__product"
        ).distinct()
        state = request.query_params.get('status')
        if state:
            if state not in dict(TenantTransfer.STATUS_CHOICES):
                raise ValidationError({'status': ['Transfer holati noto‘g‘ri.']})
            transfers = transfers.filter(status=state)
        if request.query_params.get('page'):
            from api.pagination import StandardResultsSetPagination
            pagination = StandardResultsSetPagination()
            rows = pagination.paginate_queryset(transfers, request)
            return pagination.get_paginated_response(TenantTransferOutputSerializer(rows, many=True).data)
        return Response(TenantTransferOutputSerializer(transfers, many=True).data)

    @extend_schema(request=TenantTransferCreateSerializer, responses={201: TenantTransferOutputSerializer})
    @keyed_inventory_mutation('transfer', 'transfer.dispatch')
    def post(self, request):
        serializer = TenantTransferCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        try:
            transfer = TenantTransferService.dispatch(
                source=self.tenant,
                destination_id=values["destination_tenant_id"],
                actor=request.user,
                request_key=values["request_key"],
                items=values["items"],
                note=values.get("note", ""),
            )
        except TenantTransferError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(TenantTransferOutputSerializer(transfer).data, status=status.HTTP_201_CREATED)


class TenantTransferReceiveView(InventoryAPIView):
    permission_classes = [HasEmployeePermission]
    required_permission = "inventory.transfer_stock"

    @extend_schema(request=TenantTransferReceiveSerializer, responses={200: TenantTransferOutputSerializer})
    @keyed_inventory_mutation('transfer', 'transfer.receive')
    def post(self, request, transfer_id):
        serializer = TenantTransferReceiveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            transfer = TenantTransferService.receive(
                transfer_id=transfer_id,
                destination=self.tenant,
                actor=request.user,
                items=serializer.validated_data["items"],
            )
        except TenantTransfer.DoesNotExist:
            return Response({"detail": "Transfer topilmadi."}, status=status.HTTP_404_NOT_FOUND)
        except TenantTransferError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(TenantTransferOutputSerializer(transfer).data)


class TenantTransferReturnView(InventoryAPIView):
    permission_classes = [HasEmployeePermission]
    required_permission = "inventory.transfer_stock"

    @extend_schema(request=TenantTransferReturnSerializer, responses={201: TenantTransferOutputSerializer})
    @keyed_inventory_mutation('transfer', 'transfer.return')
    def post(self, request, transfer_id):
        serializer = TenantTransferReturnSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        try:
            transfer = TenantTransferService.start_return(
                transfer_id=transfer_id,
                source=self.tenant,
                actor=request.user,
                request_key=values["request_key"],
                items=values["items"],
                note=values.get("note", ""),
            )
        except TenantTransfer.DoesNotExist:
            return Response({"detail": "Asl transfer topilmadi."}, status=status.HTTP_404_NOT_FOUND)
        except TenantTransferError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(TenantTransferOutputSerializer(transfer).data, status=status.HTTP_201_CREATED)


class TenantTransferCloseDiscrepancyView(InventoryAPIView):
    permission_classes = [HasEmployeePermission]
    required_permission = "inventory.transfer_stock"

    @extend_schema(request=TenantTransferDiscrepancyCloseSerializer, responses={200: TenantTransferOutputSerializer})
    @keyed_inventory_mutation('transfer', 'transfer.close_discrepancy')
    def post(self, request, transfer_id):
        serializer = TenantTransferDiscrepancyCloseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            transfer = TenantTransferService.close_discrepancy(
                transfer_id=transfer_id, tenant=self.tenant, actor=request.user,
                reason=serializer.validated_data["reason"]
            )
        except TenantTransfer.DoesNotExist:
            return Response({"detail": "Transfer topilmadi."}, status=status.HTTP_404_NOT_FOUND)
        except TenantTransferError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(TenantTransferOutputSerializer(transfer).data)
