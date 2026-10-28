from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from apps.core import event_clock as timezone

from apps.inventory.services import StockService
from apps.sales.models import Sale, SaleItem, SaleVoidLog, SaleVoidRequest
from apps.sales.models.sale_model import SaleRefund
from apps.cashbox.services.cashbox_service import CashboxService, CashboxServiceError
from apps.tenants.models import Tenant
from apps.sales.services.debt_service import DebtService
from apps.sales.taxes import cumulative_item_amount


class VoidServiceError(Exception):
    pass


class VoidService:
    @staticmethod
    def _request(sale, user, reason, key, sale_item=None, quantity=None):
        if key is None:
            return None, None
        if not isinstance(key, str) or not key.strip() or len(key.strip()) > 64:
            raise VoidServiceError("Bekor qilishning qayta so‘rash kaliti noto‘g‘ri.")
        key = key.strip()
        payload = {
            "kind": "item" if sale_item is not None else "sale",
            "sale_id": sale.pk,
            "sale_item_id": sale_item.pk if sale_item is not None else None,
            "reason": (reason or "").strip(),
            "quantity": str(quantity.normalize()) if quantity is not None else None,
        }
        previous = SaleVoidRequest.objects.filter(tenant_id=sale.tenant_id, idempotency_key=key).first()
        if previous and (previous.actor_id != user.pk or previous.payload != payload):
            raise VoidServiceError("Qayta so‘rash kaliti boshqa bekor qilish amali uchun ishlatilgan.")
        return {"idempotency_key": key, "payload": payload}, previous

    @staticmethod
    def _attach_receipt(obj, record):
        if record is not None:
            obj._void_operation = {
                "idempotency_key": record.idempotency_key,
                "actor_id": record.actor_id,
                "tenant_id": record.tenant_id,
                "kind": record.kind,
                "sale_id": record.sale_id,
                "sale_item_id": record.sale_item_id,
                "reason": record.payload["reason"],
                "quantity": record.payload["quantity"],
                "result": record.result,
            }
        return obj

    @classmethod
    def _save_receipt(cls, *, obj, sale, user, request, refund_amount, sale_item=None):
        if request is None:
            return obj
        record = SaleVoidRequest.objects.create(
            tenant_id=sale.tenant_id,
            actor=user,
            sale=sale,
            sale_item=sale_item,
            idempotency_key=request["idempotency_key"],
            kind=request["payload"]["kind"],
            payload=request["payload"],
            result={
                "sale_status": sale.status,
                "refunded_amount": str(refund_amount),
                "sale_refunded_amount": str(sale.refunded_amount),
                "sale_net_amount": str(sale.net_amount),
                "currency": sale.currency,
                "voided_quantity": str(sale_item.voided_quantity) if sale_item is not None else None,
            },
        )
        return cls._attach_receipt(obj, record)

    @staticmethod
    def _validate_void_eligibility(sale, user, reason: str):
        if not reason or not reason.strip():
            raise VoidServiceError("Bekor qilish sababi kiritilishi shart.")

        if timezone.now() - sale.created_at > timedelta(days=7):
            raise VoidServiceError("Sotuv qilinganiga 1 haftadan (7 kundan) oshgan, bekor qilib bo'lmaydi.")

        if sale.status == Sale.STATUS_B2B_ACCEPTED:
            raise VoidServiceError("Qabul qilingan B2B transferni bekor qilib bo'lmaydi.")

        if sale.b2b_target_tenant_id:
            raise VoidServiceError(
                "B2B transferni oddiy bekor qilish bilan yopib bo‘lmaydi; qaytish oqimidan foydalaning."
            )

        if sale.status == Sale.STATUS_VOIDED:
            raise VoidServiceError("Ushbu sotuv allaqachon bekor qilingan.")

    @staticmethod
    def _record_refund(sale, user, amount, reason):
        shift = None
        if sale.payment_type != Sale.PAYMENT_DEBT:
            try:
                shift = CashboxService.lock_open_shift(sale.tenant)
            except CashboxServiceError as exc:
                raise VoidServiceError(str(exc)) from exc
        SaleRefund.objects.create(tenant=sale.tenant, sale=sale, shift=shift, amount=amount,
                                  currency=sale.currency, payment_type=sale.payment_type,
                                  recorded_by=user, reason=reason)

    @classmethod
    @transaction.atomic
    def void_sale(cls, *, sale: Sale, user, reason: str, idempotency_key: str = None) -> Sale:
        Tenant.objects.select_for_update().get(pk=sale.tenant_id)
        sale = Sale.objects.select_for_update().get(pk=sale.pk)
        request, previous = cls._request(sale, user, reason, idempotency_key)
        if previous is not None:
            return cls._attach_receipt(sale, previous)
        cls._validate_void_eligibility(sale, user, reason)

        reason = reason.strip()
        refund_amount = sale.net_amount
        cls._record_refund(sale, user, refund_amount, reason)
        items = list(sale.items.select_for_update().order_by("product_variant_id"))

        for item in items:
            remaining_qty = item.quantity - item.voided_quantity
            if remaining_qty > 0:
                StockService.customer_return(
                    tenant=sale.tenant,
                    product_variant=item.product_variant,
                    quantity=remaining_qty,
                    created_by=user,
                    note=f"Sotuv bekor qilindi ({sale.receipt_number}): {reason}",
                    sale=sale,
                )
                SaleVoidLog.objects.create(
                    tenant=sale.tenant,
                    sale_item=item,
                    quantity=remaining_qty,
                    reason=reason,
                    voided_by=user,
                )
                item.voided_quantity = item.quantity
                item.status = SaleItem.STATUS_VOIDED
                item.save(update_fields=["voided_quantity", "status"])

        sale.status = Sale.STATUS_VOIDED
        sale.voided_at = timezone.now()
        sale.voided_by = user
        sale.void_reason = reason
        sale.refunded_amount += refund_amount
        sale.save(update_fields=["status", "voided_at", "voided_by", "void_reason", "refunded_amount"])

        # Adjust counterparty debt if sale was on debt
        if sale.payment_type == Sale.PAYMENT_DEBT and sale.counterparty_id:
            from apps.sales.models import Counterparty

            cp = Counterparty.objects.select_for_update().get(pk=sale.counterparty_id)
            if sale.currency == "UZS":
                cp.debt_balance_uzs -= refund_amount
            else:
                cp.debt_balance_usd -= refund_amount
            cp.save(update_fields=["debt_balance_uzs", "debt_balance_usd"])
            DebtService.check_threshold_and_notify(cp)

        from apps.core.models import AuditAction
        from apps.core.services.audit_service import AuditService

        AuditService.log(
            action=AuditAction.VOID_SALE,
            actor=user,
            tenant=sale.tenant,
            target_model="Sale",
            target_id=str(sale.id),
            changes={
                "status": {"old": "completed", "new": Sale.STATUS_VOIDED},
                "total_amount": str(sale.total_amount),
                "reason": reason,
            },
            description=f"Sale {sale.receipt_number} voided: {reason}",
        )

        return cls._save_receipt(obj=sale, sale=sale, user=user, request=request, refund_amount=refund_amount)

    @classmethod
    @transaction.atomic
    def void_sale_item(cls, *, sale_item: SaleItem, user, quantity: Decimal, reason: str, idempotency_key: str = None) -> SaleItem:
        if not reason or not reason.strip():
            raise VoidServiceError("Bekor qilish sababi kiritilishi shart.")

        Tenant.objects.select_for_update().get(pk=sale_item.tenant_id)
        sale = Sale.objects.select_for_update().get(pk=sale_item.sale_id)
        sale_item = SaleItem.objects.select_for_update().get(pk=sale_item.pk)
        request, previous = cls._request(sale, user, reason, idempotency_key, sale_item, quantity)
        if previous is not None:
            return cls._attach_receipt(sale_item, previous)
        cls._validate_void_eligibility(sale, user, reason)
        available_qty = sale_item.quantity - sale_item.voided_quantity

        if quantity <= 0:
            raise VoidServiceError("Bekor qilinadigan miqdor 0 dan katta bo'lishi shart.")
        if quantity > available_qty:
            raise VoidServiceError(
                f"Qaytariladigan miqdor mavjud qoldiqdan ({available_qty}) katta bo'lishi mumkin emas."
            )

        reason = reason.strip()
        StockService.customer_return(
            tenant=sale.tenant,
            product_variant=sale_item.product_variant,
            quantity=quantity,
            created_by=user,
            note=f"Qisman qaytarish ({sale.receipt_number}): {reason}",
            sale=sale,
        )

        SaleVoidLog.objects.create(
            tenant=sale.tenant,
            sale_item=sale_item,
            quantity=quantity,
            reason=reason,
            voided_by=user,
        )

        sale_item.voided_quantity += quantity
        if sale_item.voided_quantity == sale_item.quantity:
            sale_item.status = SaleItem.STATUS_VOIDED
        else:
            sale_item.status = SaleItem.STATUS_PARTIALLY_VOIDED
        sale_item.save(update_fields=["voided_quantity", "status"])

        # Adjust counterparty debt
        refund_amount = cumulative_item_amount(sale_item, sale_item.voided_quantity) - cumulative_item_amount(
            sale_item, sale_item.voided_quantity - quantity,
        )
        refund_amount = min(refund_amount, sale.net_amount)
        cls._record_refund(sale, user, refund_amount, reason)
        if sale.payment_type == Sale.PAYMENT_DEBT and sale.counterparty_id:
            from apps.sales.models import Counterparty

            cp = Counterparty.objects.select_for_update().get(pk=sale.counterparty_id)
            if sale.currency == "UZS":
                cp.debt_balance_uzs -= refund_amount
            else:
                cp.debt_balance_usd -= refund_amount
            cp.save(update_fields=["debt_balance_uzs", "debt_balance_usd"])
            DebtService.check_threshold_and_notify(cp)

        # Adjust sale total amount
        sale.refunded_amount += refund_amount

        # Check all items status in sale
        all_items = list(sale.items.all())
        all_voided = all(it.voided_quantity == it.quantity for it in all_items)
        if all_voided:
            sale.status = Sale.STATUS_VOIDED
            sale.voided_at = timezone.now()
            sale.voided_by = user
            sale.void_reason = reason
        else:
            sale.status = Sale.STATUS_PARTIALLY_VOIDED

        sale.save(update_fields=["status", "voided_at", "voided_by", "void_reason", "refunded_amount"])

        from apps.core.models import AuditAction
        from apps.core.services.audit_service import AuditService

        AuditService.log(
            action=AuditAction.VOID_SALE,
            actor=user,
            tenant=sale.tenant,
            target_model="SaleItem",
            target_id=str(sale_item.id),
            changes={
                "sale_id": str(sale.id),
                "quantity": str(quantity),
                "reason": reason,
            },
            description=f"Sale item {sale_item.id} from {sale.receipt_number} voided ({quantity} qty): {reason}",
        )

        return cls._save_receipt(obj=sale_item, sale=sale, user=user, request=request, refund_amount=refund_amount, sale_item=sale_item)
