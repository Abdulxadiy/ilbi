import hashlib
import json
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from apps.catalog.models import Category, Product, ProductVariant
from apps.catalog.services import ProductService
from apps.core.models import AuditAction
from apps.core.services.audit_service import AuditService
from apps.inventory.models import Stock, StockMovement, TenantTransfer, TenantTransferItem
from apps.tenants.models import SellerProfile, Tenant


class TenantTransferError(Exception):
    pass


class TenantTransferService:
    @staticmethod
    def _active_member(user, tenant):
        from apps.accounts.models import Employee
        return Employee.objects.filter(user=user, tenant=tenant, is_active=True).first()

    @classmethod
    def _validate_shared_seller(cls, source, destination):
        profile = source.seller_profile
        if profile is None or destination.seller_profile_id != profile.id:
            raise TenantTransferError("Ichki transfer uchun ikki do‘kon bir xil sotuvchi profiliga bog‘langan bo‘lishi kerak.")
        if profile.owner_id != source.owner_id or profile.owner_id != destination.owner_id:
            raise TenantTransferError("Sotuvchi profilining egasi do‘konlarning egasi bilan mos emas.")
        if profile.status != SellerProfile.STATUS_APPROVED:
            raise TenantTransferError("Ichki transfer uchun sotuvchi profili tasdiqlangan bo‘lishi kerak.")
        if profile.expires_at is None or profile.expires_at <= timezone.now():
            raise TenantTransferError("Sotuvchi profili muddati tugagan yoki tekshiruv muddati belgilanmagan.")
        return profile

    @staticmethod
    def _target_variant(source_variant, destination, *, target_variant_id=None, category_id=None):
        if target_variant_id:
            variant = ProductVariant.objects.filter(
                pk=target_variant_id, tenant=destination, is_active=True,
            ).select_related("product").first()
            if variant is None:
                raise TenantTransferError("Manzil do‘kondagi tanlangan mahsulot varianti topilmadi.")
            if variant.unit != source_variant.unit or variant.currency != source_variant.currency:
                raise TenantTransferError("Manzil mahsuloti birligi va valyutasi manba mahsulotiga mos bo‘lishi kerak.")
            return variant

        same_product = Product.objects.filter(
            tenant=destination, is_active=True, name__iexact=source_variant.product.name,
        ).first()
        if same_product is not None:
            same_variant = ProductVariant.objects.filter(
                tenant=destination, product=same_product, is_active=True,
                name__iexact=source_variant.name,
                unit=source_variant.unit, product__category__currency=source_variant.currency,
            ).first()
            if same_variant is not None:
                return same_variant

        if not category_id:
            raise TenantTransferError(
                f"{source_variant.product.name} / {source_variant.name} manzil katalogida yo‘q. Qabul qiluvchi kategoriya tanlashi kerak."
            )
        category = Category.objects.filter(pk=category_id, tenant=destination, is_active=True).first()
        if category is None:
            raise TenantTransferError("Manzil do‘kon uchun tanlangan kategoriya topilmadi.")
        if category.currency != source_variant.currency:
            raise TenantTransferError("Manzil kategoriyasi valyutasi manba mahsulotiga mos bo‘lishi kerak.")
        barcode = source_variant.barcode
        if barcode and ProductVariant.objects.filter(tenant=destination, barcode=barcode).exists():
            barcode = None
        product = Product.objects.create(
            tenant=destination,
            name=source_variant.product.name,
            category=category,
        )
        return ProductService.add_variant(
            product=product,
            name=source_variant.name,
            unit=source_variant.unit,
            barcode=barcode,
            price_partner=Decimal("0"),
            price_min=Decimal("0"),
            price_recommended=Decimal("0"),
        )

    @staticmethod
    def _apply(tenant, variant, quantity, direction, movement_type, actor, note, cost_price=None, batch_manifest=None):
        from apps.inventory.services.stock_service import StockService, StockServiceError
        try:
            return StockService.apply_movement(tenant=tenant, product_variant=variant, quantity=Decimal(quantity),
                direction=direction, type=movement_type, created_by=actor, note=note, cost_price=cost_price,
                batch_manifest=batch_manifest)
        except StockServiceError as exc:
            raise TenantTransferError(str(exc)) from exc

    @staticmethod
    def _audit(transfer, actor, action, changes, description):
        tenants = {transfer.source_tenant_id: transfer.source_tenant,
                   transfer.destination_tenant_id: transfer.destination_tenant}
        for tenant in tenants.values():
            AuditService.log(
                action=action,
                actor=actor,
                tenant=tenant,
                target_model="TenantTransfer",
                target_id=str(transfer.id),
                changes=changes,
                description=description,
            )

    @classmethod
    @transaction.atomic
    def dispatch(cls, *, source, destination_id, actor, request_key, items, note=""):
        locked = {row.pk: row for row in Tenant.objects.select_for_update().filter(
            pk__in=[source.pk, destination_id], is_active=True,
        ).order_by('pk')}
        source = locked.get(source.pk)
        destination = locked.get(destination_id)
        if source is None:
            raise TenantTransferError("Manba do‘kon faol emas.")
        if destination is None or destination.id == source.id:
            raise TenantTransferError("Faol boshqa manzil do‘konni tanlang.")
        profile = cls._validate_shared_seller(source, destination)
        if cls._active_member(actor, source) is None:
            raise TenantTransferError("Jo‘natuvchi do‘konda faol xodimlik talab qilinadi.")
        is_owner_flow = actor.id == source.owner_id and actor.id == destination.owner_id
        if is_owner_flow and (
            cls._active_member(actor, source) is None or cls._active_member(actor, destination) is None
        ):
            raise TenantTransferError("Owner ikkala do‘konda ham faol bo‘lishi kerak.")

        canonical = json.dumps({
            "source": source.id,
            "destination": destination.id,
            "items": sorted([
                {"variant": int(item["source_variant_id"]), "quantity": str(item["quantity"]),
                 "target_variant": item.get("destination_variant_id"), "category": item.get("destination_category_id")}
                for item in items
            ], key=lambda item: item["variant"]),
            "note": note.strip(),
        }, sort_keys=True)
        fingerprint = hashlib.sha256(canonical.encode()).hexdigest()
        existing = TenantTransfer.objects.select_for_update().filter(request_key=request_key).first()
        if existing:
            if existing.created_by_id != actor.id or existing.request_fingerprint != fingerprint:
                raise TenantTransferError("Idempotency kaliti boshqa so‘rovda ishlatilgan.")
            return existing
        if not items or len(items) > 100:
            raise TenantTransferError("Transferda 1 dan 100 tagacha mahsulot bo‘lishi kerak.")
        variant_ids = [int(item["source_variant_id"]) for item in items]
        if len(variant_ids) != len(set(variant_ids)):
            raise TenantTransferError("Bir mahsulot varianti bir transferda faqat bir marta kiritiladi.")
        variants = {
            item.id: item for item in ProductVariant.objects.filter(
                tenant=source, is_active=True, id__in=variant_ids,
            ).select_related("product", "product__category")
        }
        if len(variants) != len(variant_ids):
            raise TenantTransferError("Manba do‘konga tegishli bo‘lmagan yoki faol bo‘lmagan variant tanlandi.")
        normalized = []
        for item in items:
            quantity = Decimal(str(item["quantity"]))
            if quantity <= 0:
                raise TenantTransferError("Yuboriladigan miqdor noldan katta bo‘lishi kerak.")
            source_variant = variants[int(item["source_variant_id"])]
            target = None
            if is_owner_flow:
                target = cls._target_variant(
                    source_variant, destination,
                    target_variant_id=item.get("destination_variant_id"),
                    category_id=item.get("destination_category_id"),
                )
            normalized.append((source_variant, quantity, target, item.get("destination_category_id")))

        transfer, created = TenantTransfer.objects.get_or_create(
            request_key=request_key,
            defaults={
                "request_fingerprint": fingerprint,
                "source_tenant": source,
                "destination_tenant": destination,
                "seller_profile": profile,
                "created_by": actor,
                "status": TenantTransfer.STATUS_DELIVERED_OWNER if is_owner_flow else TenantTransfer.STATUS_PENDING,
                "received_by": actor if is_owner_flow else None,
                "received_at": timezone.now() if is_owner_flow else None,
                "note": note.strip(),
            },
        )
        if not created:
            if transfer.created_by_id != actor.id or transfer.request_fingerprint != fingerprint:
                raise TenantTransferError("Idempotency kaliti boshqa so‘rovda ishlatilgan.")
            return transfer
        lines = []
        for source_variant, quantity, target_variant, category_id in normalized:
            line = TenantTransferItem.objects.create(
                transfer=transfer,
                source_variant=source_variant,
                destination_variant=target_variant,
                destination_category_id=category_id if target_variant is None else None,
                quantity_sent=quantity,
                unit=source_variant.unit, currency=source_variant.currency,
                quantity_received=quantity if is_owner_flow else Decimal("0"),
            )
            lines.append(line)

        stock_pairs = [(source, line.source_variant) for line in lines]
        if is_owner_flow:
            stock_pairs.extend((destination, line.destination_variant) for line in lines)
        cls._lock_stocks(stock_pairs)
        for line in lines:
            line.cost_price = Stock.objects.get(tenant=source, product_variant=line.source_variant).last_cost_price
            line.save(update_fields=['cost_price'])

        from apps.inventory.services.batch_service import BatchService
        for line in sorted(lines, key=lambda item: (source.id, item.source_variant_id)):
            outgoing = cls._apply(
                source, line.source_variant, line.quantity_sent,
                StockMovement.DIRECTION_OUT, StockMovement.TYPE_TENANT_TRANSFER_OUT,
                actor, f"Ichki transfer #{transfer.id} → {destination.name}",
            )
            line.batch_manifest = BatchService.manifest(outgoing)
            line.save(update_fields=["batch_manifest"])
        if is_owner_flow:
            for line in sorted(lines, key=lambda item: (destination.id, item.source_variant_id)):
                cls._apply(
                    destination, line.destination_variant, line.quantity_sent,
                    StockMovement.DIRECTION_IN, StockMovement.TYPE_TENANT_TRANSFER_IN,
                    actor, f"Ichki transfer #{transfer.id} ← {source.name}",
                    cost_price=line.cost_price, batch_manifest=line.batch_manifest or None,
                )
        cls._audit(
            transfer, actor, AuditAction.TENANT_TRANSFER_DISPATCH,
            {"source_tenant": source.id, "destination_tenant": destination.id,
             "status": transfer.status, "lines": len(lines), "owner_flow": is_owner_flow},
            f"Tenant transfer {transfer.id} dispatched.",
        )
        return transfer

    @staticmethod
    def _lock_stocks(pairs):
        unique = {(tenant.id, variant.id): (tenant, variant) for tenant, variant in pairs}
        stock_ids = []
        for key in sorted(unique):
            tenant, variant = unique[key]
            stock, _ = Stock.objects.get_or_create(
                tenant=tenant, product_variant=variant, defaults={"quantity": Decimal("0")},
            )
            stock_ids.append(stock.id)
        list(
            Stock.objects.select_for_update().filter(pk__in=stock_ids)
            .order_by("tenant_id", "product_variant_id")
        )

    @staticmethod
    def _lock_tenants(transfer_id):
        transfer = TenantTransfer.objects.get(pk=transfer_id)
        list(Tenant.objects.select_for_update().filter(
            pk__in=[transfer.source_tenant_id, transfer.destination_tenant_id],
        ).order_by('pk'))

    @classmethod
    @transaction.atomic
    def receive(cls, *, transfer_id, destination, actor, items):
        from apps.inventory.services.batch_service import BatchService
        cls._lock_tenants(transfer_id)
        transfer = TenantTransfer.objects.select_for_update().select_related(
            "source_tenant", "destination_tenant", "seller_profile"
        ).get(pk=transfer_id)
        if transfer.destination_tenant_id != destination.id:
            raise TenantTransferError("Bu transfer boshqa do‘konga yuborilgan.")
        if cls._active_member(actor, destination) is None:
            raise TenantTransferError("Qabul qiluvchi do‘konda faol xodimlik talab qilinadi.")
        if transfer.status != TenantTransfer.STATUS_PENDING:
            raise TenantTransferError("Faqat kutilayotgan transferni qabul qilish mumkin.")
        cls._validate_shared_seller(transfer.source_tenant, transfer.destination_tenant)
        line_map = {line.id: line for line in transfer.items.select_for_update().select_related("source_variant", "source_variant__product")}
        provided = {int(value["item_id"]): value for value in items}
        if not provided or set(provided) != set(line_map):
            raise TenantTransferError("Har bir transfer qatori uchun qabul miqdorini yuboring.")
        any_discrepancy = False
        accepted = []
        for line_id, line in line_map.items():
            if (line.unit and line.unit != line.source_variant.unit) or (line.currency and line.currency != line.source_variant.currency):
                raise TenantTransferError("Jo‘natilgan mahsulot birligi yoki valyutasi keyin o‘zgargan; avval katalogni moslang.")
            data = provided.get(line_id, {"received_quantity": "0", "discrepancy_reason": ""})
            quantity = Decimal(str(data["received_quantity"]))
            if quantity < 0 or quantity > line.quantity_sent:
                raise TenantTransferError(f"{line.source_variant} uchun qabul miqdori yuborilgan miqdor chegarasidan tashqarida.")
            reason = str(data.get("discrepancy_reason", "")).strip()
            if quantity != line.quantity_sent and not reason:
                raise TenantTransferError("Kamomad yoki ortiqcha farq bo‘yicha sabab kiritilishi shart.")
            target = None
            if quantity > 0:
                if transfer.kind == TenantTransfer.KIND_RETURN:
                    target = line.destination_variant
                    if target is None or target.tenant_id != destination.id:
                        raise TenantTransferError("Qaytish transferining manzil varianti noto‘g‘ri.")
                else:
                    target = cls._target_variant(
                        line.source_variant, destination,
                        target_variant_id=data.get("destination_variant_id") or line.destination_variant_id,
                        category_id=data.get("destination_category_id") or line.destination_category_id,
                    )
            any_discrepancy |= quantity != line.quantity_sent
            accepted.append((line, quantity, reason, target))
        for line, quantity, reason, target in sorted(accepted, key=lambda row: (destination.id, row[3].id if row[3] else 0)):
            if quantity:
                cls._apply(
                    destination, target, quantity,
                    StockMovement.DIRECTION_IN,
                    StockMovement.TYPE_TENANT_TRANSFER_RETURN_IN if transfer.kind == TenantTransfer.KIND_RETURN else StockMovement.TYPE_TENANT_TRANSFER_IN,
                    actor, f"Ichki transfer #{transfer.id} qabul qilindi",
                    cost_price=line.cost_price, batch_manifest=BatchService.slice_manifest(line.batch_manifest, quantity) or None,
                )
            line.destination_variant = target
            line.quantity_received = quantity
            line.discrepancy_reason = reason
            line.save(update_fields=["destination_variant", "quantity_received", "discrepancy_reason"])
            if transfer.kind == TenantTransfer.KIND_RETURN and line.original_item_id:
                original_line = TenantTransferItem.objects.select_for_update().get(pk=line.original_item_id)
                original_line.quantity_return_in_transit -= line.quantity_sent
                original_line.quantity_returned += quantity
                original_line.save(update_fields=["quantity_return_in_transit", "quantity_returned"])
        transfer.received_by = actor
        transfer.received_at = timezone.now()
        transfer.status = TenantTransfer.STATUS_DISCREPANCY if any_discrepancy else TenantTransfer.STATUS_DELIVERED
        transfer.save(update_fields=["received_by", "received_at", "status", "updated_at"])
        cls._audit(
            transfer, actor,
            AuditAction.TENANT_TRANSFER_DISCREPANCY if any_discrepancy else AuditAction.TENANT_TRANSFER_RECEIVE,
            {"status": transfer.status, "received_by": actor.id,
             "lines": [{"item_id": line.id, "quantity_received": str(qty), "reason": reason} for line, qty, reason, _ in accepted]},
            f"Tenant transfer {transfer.id} received with status {transfer.status}.",
        )
        return transfer

    @classmethod
    @transaction.atomic
    def start_return(cls, *, transfer_id, source, actor, request_key, items, note=""):
        cls._lock_tenants(transfer_id)
        original = TenantTransfer.objects.select_for_update().select_related(
            "source_tenant", "destination_tenant", "seller_profile"
        ).get(pk=transfer_id)
        if original.destination_tenant_id != source.id or original.kind != TenantTransfer.KIND_INTERNAL:
            raise TenantTransferError("Qaytish transferi faqat asl qabul qiluvchi do‘kondan boshlanadi.")
        if original.status not in {
            TenantTransfer.STATUS_DELIVERED, TenantTransfer.STATUS_DISCREPANCY, TenantTransfer.STATUS_CLOSED,
            TenantTransfer.STATUS_DELIVERED_OWNER,
        }:
            raise TenantTransferError("Asl transfer qabul qilinishidan oldin qaytarish boshlanmaydi.")
        destination = original.source_tenant
        profile = cls._validate_shared_seller(source, destination)
        if cls._active_member(actor, source) is None:
            raise TenantTransferError("Qaytarayotgan do‘konda faol xodimlik talab qilinadi.")
        owner_flow = actor.id == source.owner_id == destination.owner_id
        if owner_flow and cls._active_member(actor, destination) is None:
            raise TenantTransferError("Owner ikkala do‘konda ham faol bo‘lishi kerak.")
        if not items:
            raise TenantTransferError("Qaytariladigan mahsulotlarni kiriting.")
        original_lines = {
            line.id: line for line in original.items.select_for_update(of=("self",)).select_related("destination_variant", "source_variant")
        }
        normalized = []
        for payload in items:
            line = original_lines.get(int(payload["original_item_id"]))
            if line is None or line.destination_variant_id is None:
                raise TenantTransferError("Qaytarish uchun asl qabul qilingan qator topilmadi.")
            quantity = Decimal(str(payload["quantity"]))
            available = line.quantity_received - line.quantity_returned - line.quantity_return_in_transit
            if quantity <= 0 or quantity > available:
                raise TenantTransferError(f"Qaytariladigan miqdor mavjud qoldiqdan oshdi (ko‘pi bilan {available}).")
            normalized.append((line, quantity))
        request_fingerprint = hashlib.sha256(json.dumps({
            "original": original.id, "source": source.id,
            "items": sorted([{"id": line.id, "quantity": str(quantity)} for line, quantity in normalized], key=lambda x: x["id"]),
            "note": note.strip(),
        }, sort_keys=True).encode()).hexdigest()
        existing = TenantTransfer.objects.filter(request_key=request_key).first()
        if existing:
            if existing.created_by_id != actor.id or existing.request_fingerprint != request_fingerprint:
                raise TenantTransferError("Idempotency kaliti boshqa so‘rovda ishlatilgan.")
            return existing
        transfer, created = TenantTransfer.objects.get_or_create(
            request_key=request_key,
            defaults={
                "request_fingerprint": request_fingerprint,
                "source_tenant": source,
                "destination_tenant": destination,
                "seller_profile": profile,
                "kind": TenantTransfer.KIND_RETURN,
                "status": TenantTransfer.STATUS_DELIVERED_OWNER if owner_flow else TenantTransfer.STATUS_PENDING,
                "created_by": actor,
                "received_by": actor if owner_flow else None,
                "received_at": timezone.now() if owner_flow else None,
                "return_of": original,
                "note": note.strip(),
            },
        )
        if not created:
            if transfer.created_by_id != actor.id or transfer.request_fingerprint != request_fingerprint:
                raise TenantTransferError("Idempotency kaliti boshqa so‘rovda ishlatilgan.")
            return transfer
        return_lines = []
        for original_line, quantity in normalized:
            return_line = TenantTransferItem.objects.create(
                transfer=transfer,
                source_variant=original_line.destination_variant,
                destination_variant=original_line.source_variant,
                quantity_sent=quantity,
                quantity_received=quantity if owner_flow else Decimal("0"),
                original_item=original_line, cost_price=original_line.cost_price,
                unit=original_line.unit, currency=original_line.currency,
            )
            original_line.quantity_return_in_transit += quantity
            if owner_flow:
                original_line.quantity_return_in_transit -= quantity
                original_line.quantity_returned += quantity
            original_line.save(update_fields=["quantity_return_in_transit", "quantity_returned"])
            return_lines.append(return_line)
        pairs = [(source, line.source_variant) for line in return_lines]
        if owner_flow:
            pairs.extend((destination, line.destination_variant) for line in return_lines)
        cls._lock_stocks(pairs)
        from apps.inventory.services.batch_service import BatchService
        for line in sorted(return_lines, key=lambda row: row.source_variant_id):
            outgoing = cls._apply(
                source, line.source_variant, line.quantity_sent,
                StockMovement.DIRECTION_OUT, StockMovement.TYPE_TENANT_TRANSFER_RETURN_OUT,
                actor, f"Qaytish transferi #{transfer.id} → {destination.name}",
            )
            line.batch_manifest = BatchService.manifest(outgoing)
            line.save(update_fields=["batch_manifest"])
        if owner_flow:
            for line in sorted(return_lines, key=lambda row: row.destination_variant_id):
                cls._apply(
                    destination, line.destination_variant, line.quantity_sent,
                    StockMovement.DIRECTION_IN, StockMovement.TYPE_TENANT_TRANSFER_RETURN_IN,
                    actor, f"Qaytish transferi #{transfer.id} ← {source.name}",
                    cost_price=line.cost_price, batch_manifest=line.batch_manifest or None,
                )
        cls._audit(
            transfer, actor, AuditAction.TENANT_TRANSFER_RETURN,
            {"return_of": original.id, "status": transfer.status, "lines": len(return_lines)},
            f"Physical return transfer {transfer.id} started.",
        )
        return transfer

    @classmethod
    @transaction.atomic
    def close_discrepancy(cls, *, transfer_id, tenant, actor, reason):
        reason = str(reason or "").strip()
        if not reason:
            raise TenantTransferError("Tafovutni yopish sababi kiritilishi shart.")
        transfer = TenantTransfer.objects.select_for_update().get(pk=transfer_id)
        if transfer.status != TenantTransfer.STATUS_DISCREPANCY:
            raise TenantTransferError("Faqat tafovuti bor transfer yopiladi.")
        if tenant.id != transfer.source_tenant_id or actor.id != transfer.source_tenant.owner_id or cls._active_member(actor, transfer.source_tenant) is None:
            raise TenantTransferError("Tafovutni faqat manba do‘kon egasi yopishi mumkin.")
        transfer.status = TenantTransfer.STATUS_CLOSED
        transfer.discrepancy_closed_by = actor
        transfer.discrepancy_closed_at = timezone.now()
        transfer.discrepancy_resolution = reason
        transfer.save(update_fields=[
            "status", "discrepancy_closed_by", "discrepancy_closed_at", "discrepancy_resolution", "updated_at",
        ])
        cls._audit(
            transfer, actor, AuditAction.TENANT_TRANSFER_DISCREPANCY,
            {"status": transfer.status, "resolution": reason},
            f"Transfer discrepancy {transfer.id} closed by source owner.",
        )
        return transfer
