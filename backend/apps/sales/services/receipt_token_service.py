import secrets

from django.db import transaction

from apps.core.models import AuditAction
from apps.core.services.audit_service import AuditService
from apps.sales.models import Sale


class ReceiptTokenService:
    @staticmethod
    @transaction.atomic
    def rotate(*, sale_id, tenant, actor):
        sale = Sale.objects.select_for_update().get(pk=sale_id, tenant=tenant)
        sale.public_token = secrets.token_urlsafe(32)
        sale.save(update_fields=['public_token', 'updated_at'])
        AuditService.log(
            action=AuditAction.RECEIPT_TOKEN_ROTATE,
            actor=actor,
            tenant=tenant,
            target_model='Sale',
            target_id=str(sale.id),
            description=f'Public receipt link rotated for sale {sale.id}',
        )
        return sale.public_token
