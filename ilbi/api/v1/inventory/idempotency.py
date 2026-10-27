"""Optional replay-safe inventory API contract; unkeyed legacy calls are unchanged."""
import hashlib
import json
from functools import wraps
from uuid import UUID

from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.db.models import Q
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.response import Response

from apps.inventory.models import InventoryMutationReceipt, StockMovement, TenantTransfer

PROTOCOL = 'ilbi-inventory-idempotency-v1'
OPERATIONS = [
    'stock.intake', 'stock.batch_intake', 'stock.adjust', 'stock.customer_return',
    'stock.supplier_return', 'stock.write_off', 'transfer.dispatch', 'transfer.receive',
    'transfer.return', 'transfer.close_discrepancy',
]


class InventoryReplayConflict(APIException):
    status_code = 409
    default_detail = 'Asl ombor amali yozuvi mos emas. Natijani amallar jurnalidan tekshiring.'
    default_code = 'inventory_replay_conflict'


class _RollbackResponse(Exception):
    def __init__(self, response):
        self.response = response


def _resources(receipt, tenant, request):
    # Import lazily to keep serializer/model registration independent.
    from api.v1.inventory.serializers import StockMovementOutputSerializer, TenantTransferOutputSerializer

    if receipt.resource_kind in {'movement', 'movement_list'}:
        found = {row.pk: row for row in StockMovement.objects.filter(tenant=tenant, pk__in=receipt.resource_ids)}
        if len(found) != len(receipt.resource_ids):
            raise InventoryReplayConflict()
        rows = [found[pk] for pk in receipt.resource_ids]
        if receipt.resource_kind == 'movement':
            return StockMovementOutputSerializer(rows[0], context={'request': request}).data
        return StockMovementOutputSerializer(rows, many=True, context={'request': request}).data
    resource = TenantTransfer.objects.filter(
        Q(source_tenant=tenant) | Q(destination_tenant=tenant), pk__in=receipt.resource_ids,
    ).first()
    if resource is None or len(receipt.resource_ids) != 1:
        raise InventoryReplayConflict()
    return TenantTransferOutputSerializer(resource).data


def keyed_inventory_mutation(resource_kind, operation=None):
    """Unique receipt row serializes concurrent copies of the same key.

    An unsuccessful view response rolls back the outer transaction, including
    the receipt. Domain services continue enforcing their existing constraints.
    """
    def decorate(post):
        @wraps(post)
        def wrapped(view, request, *args, **kwargs):
            value = request.data.get('idempotency_key')
            if value is None:
                return post(view, request, *args, **kwargs)
            try:
                key = UUID(str(value))
            except (ValueError, TypeError, AttributeError):
                raise ValidationError({'idempotency_key': ['Amal uchun haqiqiy UUID kaliti kerak.']})
            kind = operation or 'stock.' + view.service_method_name
            payload = {name: item for name, item in request.data.items() if name != 'idempotency_key'}
            digest = hashlib.sha256(json.dumps(
                {'operation': kind, 'route': kwargs, 'payload': payload},
                sort_keys=True, cls=DjangoJSONEncoder, separators=(',', ':'),
            ).encode()).hexdigest()
            try:
                with transaction.atomic():
                    receipt, created = InventoryMutationReceipt.objects.get_or_create(
                        tenant=view.tenant, idempotency_key=key,
                        defaults={'actor': request.user, 'operation': kind, 'fingerprint': digest, 'resource_kind': resource_kind},
                    )
                    if not created:
                        receipt = InventoryMutationReceipt.objects.select_for_update().get(pk=receipt.pk)
                        if (receipt.actor_id != request.user.pk or receipt.operation != kind
                                or receipt.fingerprint != digest or receipt.resource_kind != resource_kind):
                            raise InventoryReplayConflict()
                        return Response(_resources(receipt, view.tenant, request), status=receipt.response_status)
                    response = post(view, request, *args, **kwargs)
                    if not 200 <= response.status_code < 300:
                        raise _RollbackResponse(response)
                    rows = response.data if resource_kind == 'movement_list' else [response.data]
                    if not rows or any(not isinstance(row, dict) or not isinstance(row.get('id'), int) or row['id'] < 1 for row in rows):
                        raise InventoryReplayConflict()
                    receipt.resource_ids = [row['id'] for row in rows]
                    receipt.response_status = response.status_code
                    receipt.save(update_fields=['resource_ids', 'response_status', 'updated_at'])
                    return response
            except _RollbackResponse as failure:
                return failure.response
        return wrapped
    return decorate
