import hashlib
import json
import logging
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.accounts.models import Employee
from apps.catalog.models import Category, Product, ProductVariant
from apps.catalog.services import ProductService
from apps.core.models import AuditAction
from apps.core.services.audit_service import AuditService
from apps.inventory.services import StockService
from apps.sales.models import (
    B2BReturnDiscrepancyClosure,
    B2BReturnDiscrepancyClosureItem,
    B2BReturnReceipt,
    B2BReturnReceiptItem,
    Counterparty,
    DebtPayment,
    Notification,
    Sale,
    SaleItem,
)
from apps.sales.taxes import cumulative_item_amount

logger = logging.getLogger(__name__)


class B2BTransferServiceError(Exception):
    pass


class B2BTransferService:
    @staticmethod
    def _lock_tenants(sale):
        from apps.tenants.models import Tenant
        list(Tenant.objects.select_for_update().filter(pk__in=[sale.tenant_id, sale.b2b_target_tenant_id]).order_by('pk'))

    @staticmethod
    def _pending_quantity(item):
        return (
            item.quantity
            - item.voided_quantity
            - item.b2b_accepted_quantity
            - item.b2b_rejected_quantity
            - item.b2b_return_pending_quantity
            - item.b2b_discrepancy_closed_quantity
        )

    @staticmethod
    def _refund_amount(item, quantity):
        # Round the cumulative refunded quantity, so splitting a return never
        # refunds more (or less) than a single request for the same quantity.
        previous = item.voided_quantity + item.b2b_rejected_quantity + item.b2b_discrepancy_closed_quantity
        before = cumulative_item_amount(item, previous)
        after = cumulative_item_amount(item, previous + quantity)
        return max(Decimal("0"), min(after - before, item.total_price - before))

    @classmethod
    def _refresh_item_status(cls, item):
        pending = cls._pending_quantity(item)
        if item.b2b_return_pending_quantity > 0:
            item.status = SaleItem.STATUS_B2B_RETURN_PENDING
        elif pending > 0:
            item.status = (
                SaleItem.STATUS_B2B_PARTIALLY_ACCEPTED if item.b2b_accepted_quantity > 0 else SaleItem.STATUS_ACTIVE
            )
        elif item.b2b_accepted_quantity == item.quantity:
            item.status = SaleItem.STATUS_B2B_ACCEPTED
        elif item.b2b_accepted_quantity > 0:
            item.status = SaleItem.STATUS_B2B_PARTIALLY_ACCEPTED
        else:
            item.status = SaleItem.STATUS_B2B_REJECTED

    @classmethod
    def _refresh_sale_status(cls, sale, items, *, now=None):
        if any(item.b2b_return_pending_quantity > 0 for item in items):
            sale.status = Sale.STATUS_B2B_RETURN_PENDING
            sale.b2b_resolved_at = None
        else:
            pending = sum((cls._pending_quantity(item) for item in items), Decimal("0"))
            accepted = sum((item.b2b_accepted_quantity for item in items), Decimal("0"))
            if pending > 0:
                sale.status = Sale.STATUS_B2B_PARTIALLY_ACCEPTED if accepted > 0 else Sale.STATUS_B2B_PENDING
                sale.b2b_resolved_at = None
            elif accepted == sum((item.quantity for item in items), Decimal("0")):
                sale.status = Sale.STATUS_B2B_ACCEPTED
                sale.b2b_resolved_at = now or timezone.now()
            elif accepted > 0:
                sale.status = Sale.STATUS_B2B_PARTIALLY_ACCEPTED
                sale.b2b_resolved_at = now or timezone.now()
            else:
                sale.status = Sale.STATUS_B2B_REJECTED
                sale.b2b_resolved_at = now or timezone.now()
        sale.save(update_fields=["status", "b2b_resolved_at", "b2b_reject_reason", "updated_at"])

    @staticmethod
    def _find_local_variant(*, source_variant, tenant, currency):
        """Reuse a destination variant only when an exact product code is unambiguous."""
        if source_variant.barcode:
            matches = list(
                ProductVariant.objects.filter(
                    tenant=tenant,
                    is_active=True,
                    barcode=source_variant.barcode,
                    unit=source_variant.unit,
                    product__category__currency=currency,
                ).select_related("product__category")[:2]
            )
            if len(matches) == 1:
                return matches[0]
        return None

    @classmethod
    @transaction.atomic
    def accept_transfer(
        cls,
        *,
        sale: Sale,
        accepting_user,
        tenant,
        items_payload: list[dict],
    ) -> Sale:
        """
        B tenant owner accepts items.
        items_payload: [
            {
                'sale_item_id': int,
                'accepted_quantity': Decimal,
                'target_category_id': int (optional),
                'target_variant_id': int (optional),
            }, ...
        ]
        """
        cls._lock_tenants(sale)
        sale = Sale.objects.select_for_update().get(pk=sale.pk)
        if sale.status not in (Sale.STATUS_B2B_PENDING, Sale.STATUS_B2B_PARTIALLY_ACCEPTED):
            raise B2BTransferServiceError("Faqat kutilayotgan B2B transferni qabul qilish mumkin.")

        if tenant.id != sale.b2b_target_tenant_id:
            raise B2BTransferServiceError("Faqat qabul qiluvchi do'kon foydalanuvchisi qabul qila oladi.")
        if not Employee.objects.filter(user=accepting_user, tenant=tenant, is_active=True).exists():
            raise B2BTransferServiceError("Qabul qiluvchi do‘konda faol xodimlik talab qilinadi.")

        if sale.b2b_expires_at and timezone.now() > sale.b2b_expires_at:
            raise B2BTransferServiceError("Ushbu transfer muddati tugagan (7 kun o'tgan).")

        b_tenant = sale.b2b_target_tenant
        items_by_id = {
            it.id: it for it in sale.items.select_for_update().select_related("product_variant__product").order_by("id")
        }
        if not items_payload:
            raise B2BTransferServiceError("Qabul qilinadigan kamida bitta mahsulotni ko‘rsating.")

        seen_item_ids = set()
        changed_items = []

        for payload in items_payload:
            item_id = payload["sale_item_id"]
            if item_id in seen_item_ids:
                raise B2BTransferServiceError("Bir mahsulot qabul so‘rovida takroran ko‘rsatilgan.")
            seen_item_ids.add(item_id)
            if item_id not in items_by_id:
                raise B2BTransferServiceError(f"SaleItem {item_id} ushbu chekka tegishli emas.")

            item = items_by_id[item_id]
            accepted_qty = Decimal(str(payload["accepted_quantity"]))
            max_qty = cls._pending_quantity(item)

            if accepted_qty < 0 or accepted_qty > max_qty:
                raise B2BTransferServiceError(
                    f"{item.product_variant.name} uchun qabul miqdori noto'g'ri (0 dan {max_qty} gacha bo'lishi kerak)."
                )

            if accepted_qty > 0:
                target_variant = None
                target_variant_id = payload.get("target_variant_id")
                target_category_id = payload.get("target_category_id")

                if item.b2b_target_variant_id:
                    if target_variant_id and int(target_variant_id) != item.b2b_target_variant_id:
                        raise B2BTransferServiceError("Qisman qabul boshlangan tovar boshqa variantga o‘tkazilmaydi.")
                    target_variant = item.b2b_target_variant
                elif target_variant_id:
                    target_variant = ProductVariant.objects.filter(
                        pk=target_variant_id, tenant=b_tenant, is_active=True
                    ).first()
                    if not target_variant:
                        raise B2BTransferServiceError("Tanlangan mavjud variant topilmadi.")
                    if target_variant.currency != sale.currency:
                        raise B2BTransferServiceError("Mavjud variantning valyutasi transfer valyutasiga mos kelmaydi.")
                else:
                    target_variant = cls._find_local_variant(
                        source_variant=item.product_variant,
                        tenant=b_tenant,
                        currency=sale.currency,
                    )

                if target_variant is None and target_category_id:
                    category = Category.objects.filter(pk=target_category_id, tenant=b_tenant, is_active=True).first()
                    if not category:
                        raise B2BTransferServiceError("Tanlangan kategoriya topilmadi.")
                    if category.currency != sale.currency:
                        raise B2BTransferServiceError(
                            "Tanlangan kategoriya valyutasi transfer valyutasiga mos kelmaydi."
                        )

                    # Create Product & ProductVariant in B
                    orig_variant = item.product_variant
                    orig_product = orig_variant.product

                    new_product = Product.objects.create(
                        tenant=b_tenant,
                        name=orig_product.name,
                        category=category,
                    )
                    target_variant = ProductService.add_variant(
                        product=new_product,
                        name=orig_variant.name,
                        unit=orig_variant.unit,
                        price_partner=Decimal("0.00"),
                        price_min=Decimal("0.00"),
                        price_recommended=Decimal("0.00"),
                    )
                elif target_variant is None:
                    raise B2BTransferServiceError(
                        f"{item.product_variant.name} uchun kategoriya yoki mavjud variant tanlanishi shart."
                    )

                if target_variant.tenant_id != b_tenant.id:
                    raise B2BTransferServiceError("Tanlangan variant qabul qiluvchi do‘konga tegishli emas.")

                if target_variant.currency != sale.currency or target_variant.unit != item.product_variant.unit:
                    raise B2BTransferServiceError("Tanlangan variantning valyutasi va o‘lchov birligi jo‘natilgan tovarga mos bo‘lishi kerak.")

                from apps.inventory.services.batch_service import BatchService
                # Preserve the actual charged unit value, including any added VAT.
                StockService.intake(
                    tenant=b_tenant,
                    product_variant=target_variant,
                    quantity=accepted_qty,
                    cost_price=(item.total_price / item.quantity).quantize(Decimal("0.01")),
                    batch_manifest=BatchService.sale_manifest(sale, item.product_variant, accepted_qty, item.b2b_accepted_quantity) or None,
                    created_by=accepting_user,
                    note=f"B2B qabul qilindi: {sale.receipt_number} ({sale.tenant.name} dan)",
                )

                item.b2b_accepted_quantity += accepted_qty
                item.b2b_target_variant = target_variant
                changed_items.append(item)

        for item in changed_items:
            cls._refresh_item_status(item)
            item.save(update_fields=["b2b_accepted_quantity", "b2b_target_variant", "status", "updated_at"])

        cls._refresh_sale_status(sale, list(items_by_id.values()))

        # Notify A's owner
        Notification.objects.create(
            tenant=sale.tenant,
            recipient=sale.tenant.owner,
            type=(
                Notification.TYPE_B2B_ACCEPTED
                if sale.status == Sale.STATUS_B2B_ACCEPTED
                else Notification.TYPE_B2B_PARTIALLY_ACCEPTED
            ),
            title="B2B tovarlar qabul qilindi",
            message=(
                f"{b_tenant.name} {sale.receipt_number} raqamli transferni qabul qildi "
                f"(holati: {sale.get_status_display()})."
            ),
            link=f"/sales/{sale.id}/",
        )

        return sale

    @classmethod
    @transaction.atomic
    def reject_transfer(cls, *, sale: Sale, rejecting_user, tenant, reason: str) -> Sale:
        if not reason or not reason.strip():
            raise B2BTransferServiceError("Rad etish sababi kiritilishi shart.")

        cls._lock_tenants(sale)
        sale = Sale.objects.select_for_update().get(pk=sale.pk)
        if sale.status not in (Sale.STATUS_B2B_PENDING, Sale.STATUS_B2B_PARTIALLY_ACCEPTED):
            raise B2BTransferServiceError("Faqat hal qilinmagan B2B transferni rad etish mumkin.")

        if tenant.id != sale.b2b_target_tenant_id:
            raise B2BTransferServiceError("Faqat qabul qiluvchi do'kon rad eta oladi.")
        if not Employee.objects.filter(user=rejecting_user, tenant=tenant, is_active=True).exists():
            raise B2BTransferServiceError("Qabul qiluvchi do‘konda faol xodimlik talab qilinadi.")

        items = list(sale.items.select_for_update().order_by("id"))
        rejected = []
        for item in items:
            quantity = cls._pending_quantity(item)
            if quantity > 0:
                item.b2b_return_pending_quantity += quantity
                cls._refresh_item_status(item)
                item.save(update_fields=["b2b_return_pending_quantity", "status", "updated_at"])
                rejected.append({"sale_item_id": item.id, "quantity": str(quantity)})
        if not rejected:
            raise B2BTransferServiceError("Qaytarishga yuboriladigan kutilayotgan miqdor qolmagan.")

        sale.b2b_reject_reason = reason.strip()
        cls._refresh_sale_status(sale, items)
        AuditService.log(
            action=AuditAction.B2B_RETURN_PENDING,
            actor=rejecting_user,
            tenant=tenant,
            target_model="Sale",
            target_id=str(sale.id),
            changes={"items": rejected, "reason": reason.strip()},
            description=f"B2B return pending created for {sale.receipt_number}",
        )

        # Notify A
        Notification.objects.create(
            tenant=sale.tenant,
            recipient=sale.tenant.owner,
            type=Notification.TYPE_B2B_REJECTED,
            title="B2B tovarlarini qaytarish kutilmoqda",
            message=(
                f"{sale.b2b_target_tenant.name} {sale.receipt_number} raqamli transferni rad etdi. "
                "Qaytgan tovarni amalda qabul qilgach tasdiqlang. "
                f"Sababi: {reason.strip()}"
            ),
            link=f"/sales/{sale.id}/",
        )
        return sale

    @classmethod
    def expire_due_transfers(cls, *, now=None, tenant=None) -> int:
        now = now or timezone.now()
        query = Sale.objects.filter(
            status__in=[Sale.STATUS_B2B_PENDING, Sale.STATUS_B2B_PARTIALLY_ACCEPTED],
            b2b_expires_at__lte=now,
        )
        if tenant is not None:
            query = query.filter(tenant=tenant)
        sale_ids = list(query.order_by("id").values_list("id", flat=True))
        expired_count = 0
        for sale_id in sale_ids:
            try:
                if cls._expire_one(sale_id=sale_id, now=now):
                    expired_count += 1
            except Exception:
                logger.exception("B2B expiry failed for sale_id=%s", sale_id)
        return expired_count

    @classmethod
    @transaction.atomic
    def _expire_one(cls, *, sale_id, now):
        sale = Sale.objects.select_for_update(skip_locked=True).filter(pk=sale_id).first()
        if (
            sale is None
            or sale.status not in (Sale.STATUS_B2B_PENDING, Sale.STATUS_B2B_PARTIALLY_ACCEPTED)
            or not sale.b2b_expires_at
            or sale.b2b_expires_at > now
        ):
            return False

        items = list(sale.items.select_for_update().order_by("id"))
        expired = []
        for item in items:
            quantity = cls._pending_quantity(item)
            if quantity > 0:
                item.b2b_return_pending_quantity += quantity
                cls._refresh_item_status(item)
                item.save(update_fields=["b2b_return_pending_quantity", "status", "updated_at"])
                expired.append({"sale_item_id": item.id, "quantity": str(quantity)})
        if not expired:
            return False

        sale.b2b_reject_reason = "Qabul qilish muddati tugadi; jismoniy qaytish kutilmoqda."
        cls._refresh_sale_status(sale, items, now=now)
        AuditService.log(
            action=AuditAction.B2B_RETURN_PENDING,
            actor=None,
            tenant=sale.tenant,
            target_model="Sale",
            target_id=str(sale.id),
            changes={"items": expired, "reason": "acceptance_expired"},
            description=f"B2B return pending created after expiry for {sale.receipt_number}",
        )
        for notification_tenant, recipient, title, message in [
            (
                sale.tenant,
                sale.tenant.owner,
                "B2B qaytishi kutilmoqda",
                f"{sale.receipt_number} muddati tugadi. Tovarni qaytib olgach qabulni tasdiqlang.",
            ),
            (
                sale.b2b_target_tenant,
                sale.b2b_target_tenant.owner,
                "B2B qabul muddati tugadi",
                f"{sale.receipt_number} bo‘yicha qabul muddati tugadi; qaytarilishi lozim.",
            ),
        ]:
            Notification.objects.create(
                tenant=notification_tenant,
                recipient=recipient,
                type=Notification.TYPE_B2B_REJECTED,
                title=title,
                message=message,
                link=f"/sales/{sale.id}/",
            )
        return True

    @classmethod
    def auto_expire_transfers(cls, tenant=None) -> int:
        """Compatibility wrapper; expiry is handled in one transaction per transfer."""
        return cls.expire_due_transfers(tenant=tenant)

    @classmethod
    @transaction.atomic
    def receive_return(
        cls,
        *,
        sale: Sale,
        receiving_user,
        tenant,
        items_payload: list[dict],
        reason: str,
        idempotency_key: str,
    ) -> B2BReturnReceipt:
        if not reason or not reason.strip():
            raise B2BTransferServiceError("Qaytgan tovarni qabul qilish sababi kiritilishi shart.")
        idempotency_key = (idempotency_key or "").strip()
        if not idempotency_key or len(idempotency_key) > 64:
            raise B2BTransferServiceError("Idempotency kaliti 1–64 belgidan iborat bo‘lishi kerak.")
        if not items_payload:
            raise B2BTransferServiceError("Qabul qilingan kamida bitta qaytgan tovarni kiriting.")

        cls._lock_tenants(sale)
        sale = (
            Sale.objects.select_for_update(of=("self",)).select_related("tenant", "b2b_target_tenant").get(pk=sale.pk)
        )
        if sale.tenant_id != tenant.id or sale.b2b_target_tenant_id is None:
            raise B2BTransferServiceError("Qaytgan tovarni faqat jo‘natuvchi do‘kon qabul qiladi.")
        if not Employee.objects.filter(user=receiving_user, tenant=tenant, is_active=True).exists():
            raise B2BTransferServiceError("Jo‘natuvchi do‘konda faol xodimlik talab qilinadi.")

        canonical = {
            "sale_id": sale.id,
            "reason": reason.strip(),
            "items": sorted(
                (
                    {"sale_item_id": int(item["sale_item_id"]), "quantity": str(Decimal(str(item["quantity"])))}
                    for item in items_payload
                ),
                key=lambda item: item["sale_item_id"],
            ),
        }
        payload_hash = hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        existing = B2BReturnReceipt.objects.filter(tenant=tenant, idempotency_key=idempotency_key).first()
        if existing:
            if existing.payload_hash != payload_hash:
                raise B2BTransferServiceError("Bu idempotency kaliti boshqa qaytarish uchun ishlatilgan.")
            return existing
        if sale.status != Sale.STATUS_B2B_RETURN_PENDING:
            raise B2BTransferServiceError("Jismoniy qaytish kutilayotgan B2B transfer bo‘lishi kerak.")

        items = list(sale.items.select_for_update().select_related("product_variant").order_by("id"))
        items_by_id = {item.id: item for item in items}
        requested = []
        seen = set()
        for payload in canonical["items"]:
            item_id = payload["sale_item_id"]
            if item_id in seen:
                raise B2BTransferServiceError("Bir mahsulot qaytarish so‘rovida takroran ko‘rsatilgan.")
            seen.add(item_id)
            item = items_by_id.get(item_id)
            if item is None:
                raise B2BTransferServiceError("Tovar qatori ushbu B2B savdosiga tegishli emas.")
            quantity = Decimal(payload["quantity"])
            if quantity <= 0 or quantity > item.b2b_return_pending_quantity:
                raise B2BTransferServiceError(
                    f"{item.product_variant.name} uchun qabul miqdori 0 dan "
                    f"{item.b2b_return_pending_quantity} gacha bo‘lishi kerak."
                )
            requested.append((item, quantity))

        try:
            with transaction.atomic():
                receipt = B2BReturnReceipt.objects.create(
                    tenant=tenant,
                    sale=sale,
                    received_by=receiving_user,
                    idempotency_key=idempotency_key,
                    payload_hash=payload_hash,
                    reason=reason.strip(),
                )
        except IntegrityError:
            existing = B2BReturnReceipt.objects.filter(tenant=tenant, idempotency_key=idempotency_key).first()
            if existing and existing.payload_hash == payload_hash:
                return existing
            if existing:
                raise B2BTransferServiceError("Bu idempotency kaliti boshqa qaytarish uchun ishlatilgan.") from None
            raise
        counterparty = None
        if sale.counterparty_id:
            counterparty = Counterparty.objects.select_for_update().get(pk=sale.counterparty_id)

        receipt_lines = []
        for item, quantity in sorted(requested, key=lambda entry: entry[0].product_variant_id):
            amount = min(cls._refund_amount(item, quantity), max(Decimal("0"), sale.net_amount))
            StockService.customer_return(
                tenant=tenant,
                product_variant=item.product_variant,
                quantity=quantity,
                created_by=receiving_user,
                note=f"B2B jismoniy qaytish qabul qilindi: {sale.receipt_number}; {reason.strip()}",
                return_offset=item.b2b_accepted_quantity + item.b2b_rejected_quantity + item.b2b_discrepancy_closed_quantity + item.voided_quantity,
                sale=sale,
            )
            item.b2b_return_pending_quantity -= quantity
            item.b2b_rejected_quantity += quantity
            cls._refresh_item_status(item)
            item.save(update_fields=["b2b_return_pending_quantity", "b2b_rejected_quantity", "status", "updated_at"])
            receipt_lines.append(
                B2BReturnReceiptItem.objects.create(
                    tenant=tenant,
                    receipt=receipt,
                    sale_item=item,
                    quantity=quantity,
                    amount=amount,
                )
            )
            sale.refunded_amount += amount

        if sale.payment_type != Sale.PAYMENT_DEBT:
            from apps.sales.services.void_service import VoidService, VoidServiceError
            refund_total = sum((line.amount for line in receipt_lines), Decimal("0"))
            try:
                VoidService._record_refund(sale, receiving_user, refund_total, reason)
            except VoidServiceError as exc:
                raise B2BTransferServiceError(str(exc)) from exc
        sale_items = list(items_by_id.values())
        cls._refresh_sale_status(sale, sale_items)
        sale.save(update_fields=["status", "b2b_resolved_at", "refunded_amount", "updated_at"])
        if counterparty is not None and receipt_lines and sale.payment_type == Sale.PAYMENT_DEBT:
            refund_total = sum((line.amount for line in receipt_lines), Decimal("0.00"))
            field = "debt_balance_usd" if sale.currency == Sale.CURRENCY_USD else "debt_balance_uzs"
            setattr(counterparty, field, getattr(counterparty, field) - refund_total)
            DebtPayment.objects.create(
                tenant=tenant,
                counterparty=counterparty,
                amount=refund_total,
                currency=sale.currency,
                recorded_by=receiving_user,
                is_correction=True,
                note=f"B2B qaytish krediti: {sale.receipt_number}; {reason.strip()}",
            )
            counterparty.save(update_fields=[field, "updated_at"])
            from apps.sales.services.debt_service import DebtService

            DebtService.check_threshold_and_notify(counterparty)

        AuditService.log(
            action=AuditAction.B2B_RETURN_RECEIVE,
            actor=receiving_user,
            tenant=tenant,
            target_model="B2BReturnReceipt",
            target_id=str(receipt.id),
            changes={
                "sale_id": sale.id,
                "items": [
                    {"sale_item_id": line.sale_item_id, "quantity": str(line.quantity), "amount": str(line.amount)}
                    for line in receipt_lines
                ],
                "reason": reason.strip(),
            },
            description=f"B2B return received for {sale.receipt_number}",
        )
        Notification.objects.create(
            tenant=tenant,
            recipient=tenant.owner,
            type=Notification.TYPE_B2B_ACCEPTED,
            title="B2B qaytgan tovar qabul qilindi",
            message=f"{sale.receipt_number} bo‘yicha qaytgan tovar qabul qilindi.",
            link=f"/sales/{sale.id}/",
        )
        Notification.objects.create(
            tenant=sale.b2b_target_tenant,
            recipient=sale.b2b_target_tenant.owner,
            type=Notification.TYPE_B2B_REJECTED,
            title="B2B qaytish qabul qilindi",
            message=f"{sale.receipt_number} bo‘yicha jo‘natuvchi tovar qaytishini tasdiqladi.",
            link="/sales/b2b/inbox/",
        )
        return receipt

    @classmethod
    @transaction.atomic
    def close_return_discrepancy(
        cls,
        *,
        sale: Sale,
        closing_user,
        tenant,
        items_payload: list[dict],
        reason: str,
        idempotency_key: str,
    ) -> B2BReturnDiscrepancyClosure:
        """Close physically missing return quantities and reverse their B2B value."""
        reason = (reason or "").strip()
        if not reason:
            raise B2BTransferServiceError("Tafovutni yopish sababi kiritilishi shart.")
        idempotency_key = (idempotency_key or "").strip()
        if not idempotency_key or len(idempotency_key) > 64:
            raise B2BTransferServiceError("Idempotency kaliti 1–64 belgidan iborat bo‘lishi kerak.")
        if not items_payload:
            raise B2BTransferServiceError("Yopiladigan kamida bitta tafovut miqdorini kiriting.")

        cls._lock_tenants(sale)
        sale = (
            Sale.objects.select_for_update(of=("self",)).select_related("tenant", "b2b_target_tenant").get(pk=sale.pk)
        )
        if sale.tenant_id != tenant.id or sale.b2b_target_tenant_id is None:
            raise B2BTransferServiceError("Tafovutni faqat jo‘natuvchi do‘kon yopishi mumkin.")
        if tenant.owner_id != closing_user.id:
            raise B2BTransferServiceError("B2B qaytish tafovutini faqat do‘kon egasi yopishi mumkin.")
        if not Employee.objects.filter(
            user=closing_user, tenant=tenant, is_active=True, is_owner=True
        ).exists():
            raise B2BTransferServiceError("Do‘kon egasining faol a’zoligi talab qilinadi.")

        canonical_items = sorted(
            (
                {"sale_item_id": int(item["sale_item_id"]), "quantity": str(Decimal(str(item["quantity"]))) }
                for item in items_payload
            ),
            key=lambda item: item["sale_item_id"],
        )
        canonical = {"sale_id": sale.id, "reason": reason, "items": canonical_items}
        payload_hash = hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        existing = B2BReturnDiscrepancyClosure.objects.filter(tenant=tenant, idempotency_key=idempotency_key).first()
        if existing:
            if existing.payload_hash != payload_hash:
                raise B2BTransferServiceError("Bu idempotency kaliti boshqa tafovutni yopishda ishlatilgan.")
            return existing
        if sale.status != Sale.STATUS_B2B_RETURN_PENDING:
            raise B2BTransferServiceError("Qaytishi kutilayotgan B2B transfer bo‘lishi kerak.")

        sale_items = list(sale.items.select_for_update().select_related("product_variant").order_by("id"))
        items_by_id = {item.id: item for item in sale_items}
        seen_item_ids = set()
        requested = []
        for payload in canonical_items:
            item_id = payload["sale_item_id"]
            if item_id in seen_item_ids:
                raise B2BTransferServiceError("Bir mahsulot tafovut so‘rovida takroran ko‘rsatilgan.")
            seen_item_ids.add(item_id)
            item = items_by_id.get(item_id)
            if item is None:
                raise B2BTransferServiceError("Tovar qatori ushbu B2B savdosiga tegishli emas.")
            quantity = Decimal(payload["quantity"])
            if quantity <= 0 or quantity > item.b2b_return_pending_quantity:
                raise B2BTransferServiceError(
                    f"{item.product_variant.name} uchun yopiladigan miqdor 0 dan "
                    f"{item.b2b_return_pending_quantity} gacha bo‘lishi kerak."
                )
            requested.append((item, quantity))

        try:
            with transaction.atomic():
                closure = B2BReturnDiscrepancyClosure.objects.create(
                    tenant=tenant,
                    sale=sale,
                    closed_by=closing_user,
                    idempotency_key=idempotency_key,
                    payload_hash=payload_hash,
                    reason=reason,
                )
        except IntegrityError:
            existing = B2BReturnDiscrepancyClosure.objects.filter(
                tenant=tenant, idempotency_key=idempotency_key
            ).first()
            if existing and existing.payload_hash == payload_hash:
                return existing
            if existing:
                raise B2BTransferServiceError("Bu idempotency kaliti boshqa tafovutni yopishda ishlatilgan.") from None
            raise

        counterparty = None
        if sale.counterparty_id:
            counterparty = Counterparty.objects.select_for_update().get(pk=sale.counterparty_id)
        closure_lines = []
        amount_total = Decimal("0.00")
        for item, quantity in sorted(requested, key=lambda entry: entry[0].product_variant_id):
            amount = min(cls._refund_amount(item, quantity), max(Decimal("0"), sale.net_amount - amount_total))
            item.b2b_return_pending_quantity -= quantity
            item.b2b_discrepancy_closed_quantity += quantity
            cls._refresh_item_status(item)
            item.save(
                update_fields=[
                    "b2b_return_pending_quantity",
                    "b2b_discrepancy_closed_quantity",
                    "status",
                    "updated_at",
                ]
            )
            closure_lines.append(
                B2BReturnDiscrepancyClosureItem.objects.create(
                    tenant=tenant,
                    closure=closure,
                    sale_item=item,
                    quantity=quantity,
                    amount=amount,
                )
            )
            amount_total += amount

        cls._refresh_sale_status(sale, sale_items)
        if sale.payment_type != Sale.PAYMENT_DEBT and amount_total:
            from apps.sales.services.void_service import VoidService, VoidServiceError
            try:
                VoidService._record_refund(sale, closing_user, amount_total, reason)
            except VoidServiceError as exc:
                raise B2BTransferServiceError(str(exc)) from exc
        sale.refunded_amount += amount_total
        sale.save(update_fields=["status", "b2b_resolved_at", "refunded_amount", "updated_at"])
        if counterparty is not None and amount_total and sale.payment_type == Sale.PAYMENT_DEBT:
            field = "debt_balance_usd" if sale.currency == Sale.CURRENCY_USD else "debt_balance_uzs"
            setattr(counterparty, field, getattr(counterparty, field) - amount_total)
            DebtPayment.objects.create(
                tenant=tenant,
                counterparty=counterparty,
                amount=amount_total,
                currency=sale.currency,
                recorded_by=closing_user,
                is_correction=True,
                note=f"B2B qaytish tafovuti krediti: {sale.receipt_number}; {reason}",
            )
            counterparty.save(update_fields=[field, "updated_at"])
            from apps.sales.services.debt_service import DebtService

            DebtService.check_threshold_and_notify(counterparty)

        AuditService.log(
            action=AuditAction.B2B_RETURN_DISCREPANCY_CLOSE,
            actor=closing_user,
            tenant=tenant,
            target_model="B2BReturnDiscrepancyClosure",
            target_id=str(closure.id),
            changes={
                "sale_id": sale.id,
                "reason": reason,
                "items": [
                    {"sale_item_id": line.sale_item_id, "quantity": str(line.quantity), "amount": str(line.amount)}
                    for line in closure_lines
                ],
                "financial_adjustment": str(amount_total),
                "currency": sale.currency,
                "stock_changed": False,
            },
            description=f"B2B return discrepancy closed for {sale.receipt_number}",
        )
        Notification.objects.create(
            tenant=tenant,
            recipient=tenant.owner,
            type=Notification.TYPE_B2B_REJECTED,
            title="B2B qaytish tafovuti yopildi",
            message=(
                f"{sale.receipt_number} bo‘yicha {amount_total} {sale.currency} moliyaviy tuzatish qilindi. "
                "Ombor qoldig‘i o‘zgartirilmadi."
            ),
            link=f"/sales/{sale.id}/",
        )
        Notification.objects.create(
            tenant=sale.b2b_target_tenant,
            recipient=sale.b2b_target_tenant.owner,
            type=Notification.TYPE_B2B_REJECTED,
            title="B2B qaytish tafovuti yopildi",
            message=(
                f"{sale.receipt_number} bo‘yicha qaytmagan miqdor logistika va moliya hisobida yopildi. "
                "Tegishli summa hamkor hisobidan tuzatildi."
            ),
            link="/sales/b2b/inbox/",
        )
        return closure
