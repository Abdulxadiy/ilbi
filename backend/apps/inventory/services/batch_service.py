from datetime import date
from decimal import Decimal

from django.db.models import F, Sum
from apps.core import event_clock as timezone

from apps.inventory.models import BatchAllocation, StockBatch, StockMovement


class BatchService:
    """Called under the existing tenant/stock transaction, never a separate balance."""

    @staticmethod
    def ensure_balance(stock):
        total = StockBatch.objects.filter(
            tenant_id=stock.tenant_id, product_variant_id=stock.product_variant_id
        ).aggregate(s=Sum("quantity"))["s"] or Decimal("0")
        if total < stock.quantity:
            StockBatch.objects.create(
                tenant_id=stock.tenant_id,
                product_variant_id=stock.product_variant_id,
                batch_code="",
                quantity=stock.quantity - total,
                cost_price=stock.last_cost_price,
            )
        elif total > stock.quantity:
            from apps.inventory.services.stock_service import StockServiceError

            raise StockServiceError("Partiyalar yig‘indisi ombor qoldig‘iga mos emas.")

    @staticmethod
    def manifest(movement):
        return [
            {
                "batch_code": a.batch.batch_code,
                "expires_on": a.batch.expires_on.isoformat() if a.batch.expires_on else None,
                "quantity": str(a.quantity),
                "cost_price": str(a.batch.cost_price) if a.batch.cost_price is not None else None,
                "supplier": a.batch.supplier or "",
            }
            for a in movement.batch_allocations.select_related("batch").order_by("pk")
        ]

    @staticmethod
    def slice_manifest(manifest, quantity, offset=Decimal("0")):
        result = []
        left = Decimal(quantity)
        skip = Decimal(offset)
        for source in manifest:
            size = Decimal(source["quantity"])
            omitted = min(skip, size)
            skip -= omitted
            amount = min(left, size - omitted)
            if amount > 0:
                result.append({**source, "quantity": str(amount)})
                left -= amount
            if left == 0:
                break
        return result

    @classmethod
    def sale_manifest(cls, sale, variant, quantity, offset=Decimal("0")):
        allocations = (
            BatchAllocation.objects.filter(
                movement__sale=sale,
                movement__product_variant=variant,
                movement__type=StockMovement.TYPE_SOTUV,
                movement__direction="out",
            )
            .select_related("batch")
            .order_by("pk")
        )
        manifest = [
            {
                "batch_code": a.batch.batch_code,
                "expires_on": a.batch.expires_on.isoformat() if a.batch.expires_on else None,
                "quantity": str(a.quantity),
                "cost_price": str(a.batch.cost_price) if a.batch.cost_price is not None else None,
                "supplier": a.batch.supplier or "",
            }
            for a in allocations
        ]
        return cls.slice_manifest(manifest, quantity, offset)

    @classmethod
    def record(cls, movement, *, batch_code="", expires_on=None, batch_id=None, manifest=None, return_offset=None, supplier=""):
        if movement.direction == "out":
            cls._consume(movement, batch_id)
            return
        if movement.sale_id and movement.type in (StockMovement.TYPE_MIJOZ_QAYTARDI, StockMovement.TYPE_SALE_RESTORE):
            cls._restore(movement, return_offset)
            return
        if batch_id:
            batch = StockBatch.objects.select_for_update().get(
                pk=batch_id, tenant=movement.tenant, product_variant=movement.product_variant
            )
            batch.quantity += movement.quantity
            batch.save(update_fields=["quantity", "updated_at"])
            BatchAllocation.objects.create(movement=movement, batch=batch, quantity=movement.quantity)
            return
        batch_supplier = (supplier or getattr(movement, "supplier", "") or "").strip()
        entries = manifest or [
            {
                "batch_code": batch_code,
                "expires_on": expires_on,
                "quantity": str(movement.quantity),
                "cost_price": movement.cost_price,
                "supplier": batch_supplier,
            }
        ]
        covered = Decimal("0")
        for entry in entries:
            quantity = Decimal(entry["quantity"])
            expiry = entry.get("expires_on")
            if isinstance(expiry, str):
                expiry = date.fromisoformat(expiry)
            cost = entry.get("cost_price")
            if movement.type == StockMovement.TYPE_KIRIM:
                cost = movement.cost_price
            entry_supplier = (entry.get("supplier") or batch_supplier or "").strip()
            batch = StockBatch.objects.create(
                tenant=movement.tenant,
                product_variant=movement.product_variant,
                batch_code=entry.get("batch_code") or "",
                expires_on=expiry,
                quantity=quantity,
                cost_price=cost,
                supplier=entry_supplier,
            )
            BatchAllocation.objects.create(movement=movement, batch=batch, quantity=quantity)
            covered += quantity
        if covered != movement.quantity:
            from apps.inventory.services.stock_service import StockServiceError

            raise StockServiceError("Partiya miqdorlari harakat miqdoriga mos emas.")

    @staticmethod
    def _consume(movement, batch_id):
        batches = StockBatch.objects.select_for_update().filter(
            tenant=movement.tenant, product_variant=movement.product_variant, quantity__gt=0
        )
        if batch_id:
            batches = batches.filter(pk=batch_id)
        # Expiry comes first, including expired stock: the chosen policy warns,
        # but never silently prevents a sale. Undated stock follows by intake.
        batches = batches.order_by(F("expires_on").asc(nulls_last=True), "received_on", "pk")
        remaining = movement.quantity
        for batch in batches:
            used = min(remaining, batch.quantity)
            batch.quantity -= used
            batch.save(update_fields=["quantity", "updated_at"])
            BatchAllocation.objects.create(movement=movement, batch=batch, quantity=used)
            remaining -= used
            if remaining == 0:
                break
        if remaining:
            from apps.inventory.services.stock_service import StockServiceError

            raise StockServiceError("Tanlangan partiyada yetarli qoldiq yo‘q.")

    @staticmethod
    def _restore(movement, offset):
        sources = (
            BatchAllocation.objects.select_for_update(of=("self",))
            .filter(
                movement__sale_id=movement.sale_id,
                movement__tenant=movement.tenant,
                movement__product_variant=movement.product_variant,
                movement__type=StockMovement.TYPE_SOTUV,
                movement__direction="out",
            )
            .select_related("batch")
            .order_by("pk")
        )
        remaining = movement.quantity
        skip = Decimal(offset) if offset is not None else None
        for source in sources:
            if skip is not None:
                omitted = min(skip, source.quantity)
                skip -= omitted
                available = min(source.quantity - omitted, source.quantity - source.restored_quantity)
            else:
                available = source.quantity - source.restored_quantity
            used = min(remaining, available)
            if used <= 0:
                continue
            batch = StockBatch.objects.select_for_update().get(pk=source.batch_id)
            batch.quantity += used
            batch.save(update_fields=["quantity", "updated_at"])
            source.restored_quantity += used
            source.save(update_fields=["restored_quantity"])
            BatchAllocation.objects.create(movement=movement, batch=batch, quantity=used)
            remaining -= used
            if remaining == 0:
                break
        if remaining:
            # Legacy sales had no batch records. The return has an unknown
            # expiry, rather than borrowing one from unrelated current stock.
            batch = StockBatch.objects.create(
                tenant=movement.tenant,
                product_variant=movement.product_variant,
                quantity=remaining,
                batch_code="",
                cost_price=None,
            )
            BatchAllocation.objects.create(movement=movement, batch=batch, quantity=remaining)

    @staticmethod
    def warnings(variant):
        today = timezone.localdate()
        cached = getattr(variant, "_prefetched_objects_cache", {}).get("stock_batches")
        expired = (
            [b for b in cached if b.quantity > 0 and b.expires_on and b.expires_on < today]
            if cached is not None
            else StockBatch.objects.filter(
                tenant_id=variant.tenant_id, product_variant=variant, quantity__gt=0, expires_on__lt=today
            )
        )
        return [
            {
                "batch_id": b.pk,
                "batch_code": b.batch_code,
                "expires_on": b.expires_on.isoformat(),
                "quantity": str(b.quantity),
            }
            for b in expired
        ]
