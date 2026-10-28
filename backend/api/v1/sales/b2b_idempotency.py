"""Optional mobile contract. Legacy B2B clients retain their existing payloads."""
import hashlib
import json
from functools import wraps
from uuid import UUID

from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.accounts.models import Employee
from apps.sales.models import B2BMutationReceipt, Sale
from apps.tenants.models import Tenant

OPERATIONS = ['accept', 'reject', 'receive', 'close_discrepancy']


class B2BReplayConflict(APIException):
    status_code = 409
    default_detail = 'Asl B2B amal yozuvi mos emas. Natijani amallar jurnalidan tekshiring.'
    default_code = 'b2b_replay_conflict'


class _RollbackResponse(Exception):
    def __init__(self, response):
        self.response = response


def _ack(receipt):
    return {
        'operation_id': str(receipt.operation_id), 'kind': receipt.operation,
        'actor_id': receipt.actor_id, 'tenant_id': receipt.tenant_id,
        'sale_id': receipt.sale_id, 'resource_id': receipt.resource_id,
    }


def _replay(receipt, sale, request):
    from api.v1.sales.serializers import B2BIncomingSaleSerializer, SaleOutputSerializer

    if receipt.operation in ('accept', 'reject'):
        result = dict(B2BIncomingSaleSerializer(sale).data)
    else:
        name = 'receipt_id' if receipt.operation == 'receive' else 'closure_id'
        result = {name: receipt.resource_id, 'sale': SaleOutputSerializer(sale, context={'request': request}).data}
    result['b2b_operation'] = _ack(receipt)
    return result


def keyed_b2b_mutation(operation):
    def decorate(post):
        @wraps(post)
        def wrapped(view, request, sale_id):
            raw = request.data.get('operation_id')
            if raw is None:
                return post(view, request, sale_id)
            try:
                key = UUID(str(raw))
            except (ValueError, TypeError, AttributeError):
                raise ValidationError({'operation_id': ['Amal uchun haqiqiy UUID kaliti kerak.']}) from None
            scope = {'b2b_target_tenant': view.tenant} if operation in ('accept', 'reject') else {'tenant': view.tenant}
            sale = get_object_or_404(Sale, pk=sale_id, b2b_target_tenant__isnull=False, **scope)
            if operation == 'close_discrepancy' and (
                view.tenant.owner_id != request.user.pk or not Employee.objects.filter(
                    user=request.user, tenant=view.tenant, is_owner=True, is_active=True,
                    archived_at__isnull=True,
                ).exists()
            ):
                raise PermissionDenied('B2B qaytish tafovutini faqat faol do‘kon egasi yopishi mumkin.')
            payload = {name: value for name, value in request.data.items() if name != 'operation_id'}
            fingerprint = hashlib.sha256(json.dumps(
                {'sale_id': sale_id, 'operation': operation, 'payload': payload},
                sort_keys=True, separators=(',', ':'), cls=DjangoJSONEncoder,
            ).encode()).hexdigest()
            try:
                with transaction.atomic():
                    # Preserve the domain service's global tenant→sale lock order.
                    list(Tenant.objects.select_for_update().filter(
                        pk__in=[sale.tenant_id, sale.b2b_target_tenant_id],
                    ).order_by('pk'))
                    sale = get_object_or_404(Sale.objects.select_for_update(), pk=sale_id, **scope)
                    previous = B2BMutationReceipt.objects.filter(tenant=view.tenant, operation_id=key).first()
                    if previous:
                        if (previous.actor_id != request.user.pk or previous.sale_id != sale_id
                                or previous.operation != operation or previous.fingerprint != fingerprint):
                            raise B2BReplayConflict()
                        return Response(_replay(previous, sale, request))
                    response = post(view, request, sale_id)
                    if not 200 <= response.status_code < 300:
                        raise _RollbackResponse(response)
                    resource_id = response.data.get('receipt_id' if operation == 'receive' else 'closure_id')
                    if operation in ('receive', 'close_discrepancy') and (
                        not isinstance(resource_id, int) or isinstance(resource_id, bool) or resource_id < 1
                    ):
                        raise B2BReplayConflict()
                    receipt = B2BMutationReceipt.objects.create(
                        tenant=view.tenant, operation_id=key, actor=request.user, sale=sale,
                        operation=operation, fingerprint=fingerprint, resource_id=resource_id,
                    )
                    response.data['b2b_operation'] = _ack(receipt)
                    return response
            except _RollbackResponse as failure:
                return failure.response
        return wrapped
    return decorate
