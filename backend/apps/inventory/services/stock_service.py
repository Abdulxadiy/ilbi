from decimal import Decimal

from django.db import transaction

from apps.inventory.models import Stock, StockMovement


class StockServiceError(Exception):
    """
    Raised for invalid Stock/StockMovement operations (e.g.
    insufficient quantity, wrong tenant).
    """


_FIXED_DIRECTION_BY_TYPE = {
    StockMovement.TYPE_KIRIM: StockMovement.DIRECTION_IN,
    StockMovement.TYPE_SOTUV: StockMovement.DIRECTION_OUT,
    StockMovement.TYPE_MIJOZ_QAYTARDI: StockMovement.DIRECTION_IN,
    StockMovement.TYPE_YETKAZIB_BERUVCHIGA_QAYTARISH: StockMovement.DIRECTION_OUT,
    StockMovement.TYPE_ISROFGARCHILIK: StockMovement.DIRECTION_OUT,
    StockMovement.TYPE_SALE_RESTORE: StockMovement.DIRECTION_IN,
}


class StockService:
    @staticmethod
    def _get_or_create_locked_stock(tenant, product_variant):
        """Lazily create the Stock row on first-ever movement (catalog
        never creates it -- see Stock's docstring), and lock it for the
        rest of this transaction so two concurrent movements against
        the same variant can never race each other's balance check."""
        stock, _ = Stock.objects.get_or_create(
            tenant=tenant,
            product_variant=product_variant,
            defaults={"quantity": Decimal("0")},
        )
        # get_or_create() doesn't lock on the "got" path -- re-fetch
        # with select_for_update() to guarantee the lock either way.
        stock = Stock.objects.select_for_update().get(pk=stock.pk)
        return stock

    @classmethod
    @transaction.atomic
    def apply_movement(
        cls,
        *,
        tenant,
        product_variant,
        type: str,
        quantity: Decimal,
        direction: str,
        created_by,
        cost_price: Decimal = None,
        note: str = "",
        sale=None,
        batch_code="", expires_on=None, batch_id=None, batch_manifest=None, return_offset=None,
        supplier: str = "",
    ) -> StockMovement:
        if product_variant.tenant_id != tenant.id:
            raise StockServiceError("product_variant must belong to the same tenant.")
        if quantity <= 0:
            raise StockServiceError("quantity must be positive.")

        from apps.tenants.models import Tenant
        Tenant.objects.select_for_update().get(pk=tenant.pk)
        stock = cls._get_or_create_locked_stock(tenant, product_variant)
        from apps.inventory.services.batch_service import BatchService
        BatchService.ensure_balance(stock)

        if direction == StockMovement.DIRECTION_OUT:
            if stock.quantity < quantity:
                raise StockServiceError(
                    f"Not enough stock: {stock.quantity} available, {quantity} requested."
                )
            stock.quantity -= quantity
        else:
            stock.quantity += quantity

        if type == StockMovement.TYPE_KIRIM or (direction == "in" and cost_price is not None):
            stock.last_cost_price = cost_price
        stock.save(update_fields=["quantity", "last_cost_price", "updated_at"])

        clean_supplier = (supplier or "").strip()
        movement = StockMovement.objects.create(
            tenant=tenant,
            product_variant=product_variant,
            type=type,
            direction=direction,
            quantity=quantity,
            cost_price=cost_price if type == StockMovement.TYPE_KIRIM else None,
            note=note,
            sale=sale,
            created_by=created_by,
            supplier=clean_supplier,
        )

        BatchService.record(
            movement,
            batch_code=batch_code,
            expires_on=expires_on,
            batch_id=batch_id,
            manifest=batch_manifest,
            return_offset=return_offset,
            supplier=clean_supplier,
        )
        return movement

    # -- Public, explicit-verb API -- one method per real-world action,
    # mirroring EmployeeService.hire()/fire() rather than one generic
    # "record_movement(type=...)" entry point. --

    @classmethod
    def intake(
        cls,
        *,
        tenant,
        product_variant,
        quantity,
        cost_price,
        created_by,
        note="",
        sale=None,
        batch_code="",
        expires_on=None,
        batch_manifest=None,
        supplier="",
    ) -> StockMovement:
        """A purchase/restock -- the only movement type that carries a
        cost_price, and the only one gated by `add_stock_intake` rather
        than `adjust_stock` (see api/v1/inventory/views)."""
        if cost_price is None:
            raise StockServiceError("cost_price is required for an intake.")
        return cls.apply_movement(
            tenant=tenant,
            product_variant=product_variant,
            type=StockMovement.TYPE_KIRIM,
            quantity=quantity,
            direction=_FIXED_DIRECTION_BY_TYPE[StockMovement.TYPE_KIRIM],
            created_by=created_by,
            cost_price=cost_price,
            note=note,
            sale=sale,
            batch_code=batch_code,
            expires_on=expires_on,
            batch_manifest=batch_manifest,
            supplier=supplier,
        )

    @classmethod
    @transaction.atomic
    def batch_intake(
        cls,
        *,
        tenant,
        items: list[dict],
        created_by,
        supplier: str = "",
        faktura_number: str = "",
        common_note: str = "",
    ) -> list[StockMovement]:
        """A batch restock of multiple products in a single atomic transaction.

        Each item dict must contain:
          - product_variant: ProductVariant
          - quantity: Decimal
          - cost_price: Decimal
          - note: optional str
        """
        if not items:
            raise StockServiceError("Kamida bitta tovar kiritilishi shart.")
        if len(items) > 100:
            raise StockServiceError("Bitta partiyada ko'pi bilan 100 ta tovar bo'lishi mumkin.")

        clean_supplier = (supplier or "").strip()
        header_parts = []
        if clean_supplier:
            header_parts.append(f"Ta’minotchi: {clean_supplier}")
        if faktura_number and faktura_number.strip():
            header_parts.append(f"Faktura: {faktura_number.strip()}")
        if common_note and common_note.strip():
            header_parts.append(common_note.strip())
        composite_header = " | ".join(header_parts)

        movements = []
        for it in sorted(items, key=lambda row: row["product_variant"].pk):
            item_note = it.get("note", "").strip() if it.get("note") else ""
            final_note = (
                f"{composite_header} | {item_note}"
                if composite_header and item_note
                else composite_header or item_note
            )

            item_supplier = (it.get("supplier") or clean_supplier).strip()
            movement = cls.intake(
                tenant=tenant,
                product_variant=it["product_variant"],
                quantity=it["quantity"],
                cost_price=it["cost_price"],
                created_by=created_by,
                note=final_note,
                batch_code=it.get("batch_code", ""),
                expires_on=it.get("expires_on"),
                supplier=item_supplier,
            )
            movements.append(movement)

        return movements

    @classmethod
    def customer_return(cls, *, tenant, product_variant, quantity, created_by, note="", sale=None, batch_id=None, return_offset=None) -> StockMovement:
        return cls.apply_movement(
            tenant=tenant, product_variant=product_variant, type=StockMovement.TYPE_MIJOZ_QAYTARDI,
            quantity=quantity, direction=_FIXED_DIRECTION_BY_TYPE[StockMovement.TYPE_MIJOZ_QAYTARDI],
            created_by=created_by, note=note, sale=sale, batch_id=batch_id, return_offset=return_offset,
        )

    @classmethod
    def supplier_return(cls, *, tenant, product_variant, quantity, created_by, note="", batch_id=None) -> StockMovement:
        return cls.apply_movement(
            tenant=tenant, product_variant=product_variant,
            type=StockMovement.TYPE_YETKAZIB_BERUVCHIGA_QAYTARISH, quantity=quantity,
            direction=_FIXED_DIRECTION_BY_TYPE[StockMovement.TYPE_YETKAZIB_BERUVCHIGA_QAYTARISH],
            created_by=created_by, note=note, batch_id=batch_id,
        )

    @classmethod
    def write_off(cls, *, tenant, product_variant, quantity, created_by, note="", batch_id=None) -> StockMovement:
        """Spoilage/damage/expiry -- goods that leave the shop without
        being sold or returned anywhere."""
        movement = cls.apply_movement(
            tenant=tenant, product_variant=product_variant, type=StockMovement.TYPE_ISROFGARCHILIK,
            quantity=quantity, direction=_FIXED_DIRECTION_BY_TYPE[StockMovement.TYPE_ISROFGARCHILIK],
            created_by=created_by, note=note, batch_id=batch_id,
        )
        from apps.core.models import AuditAction
        from apps.core.services.audit_service import AuditService
        AuditService.log(
            action=AuditAction.STOCK_ADJUSTMENT,
            actor=created_by,
            tenant=tenant,
            target_model="StockMovement",
            target_id=str(movement.id),
            changes={
                "product_variant_id": product_variant.id,
                "type": StockMovement.TYPE_ISROFGARCHILIK,
                "quantity": str(quantity),
                "note": note,
            },
            description=f"Stock write-off (spoilage): {quantity} for variant {product_variant.id}",
        )
        return movement

    @classmethod
    def adjust(cls, *, tenant, product_variant, quantity, direction, created_by, note="", batch_id=None) -> StockMovement:
        """An inventory-count correction -- the one type without a fixed
        direction; the caller (a stocktake) says which way it goes."""
        if direction not in (StockMovement.DIRECTION_IN, StockMovement.DIRECTION_OUT):
            raise StockServiceError("direction must be 'in' or 'out' for an adjustment.")
        movement = cls.apply_movement(
            tenant=tenant, product_variant=product_variant, type=StockMovement.TYPE_TUZATISH,
            quantity=quantity, direction=direction, created_by=created_by, note=note, batch_id=batch_id,
        )
        from apps.core.models import AuditAction
        from apps.core.services.audit_service import AuditService
        AuditService.log(
            action=AuditAction.STOCK_ADJUSTMENT,
            actor=created_by,
            tenant=tenant,
            target_model="StockMovement",
            target_id=str(movement.id),
            changes={
                "product_variant_id": product_variant.id,
                "type": StockMovement.TYPE_TUZATISH,
                "direction": direction,
                "quantity": str(quantity),
                "note": note,
            },
            description=f"Stock adjustment ({direction}): {quantity} for variant {product_variant.id}",
        )
        return movement
