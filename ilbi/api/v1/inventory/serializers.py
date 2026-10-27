from decimal import Decimal

from rest_framework import serializers

from api.serializers import SensitiveCostSerializerMixin, SensitiveSupplierSerializerMixin
from apps.catalog.models import ProductVariant
from apps.inventory.models import Stock, StockMovement, TenantTransfer, TenantTransferItem


class StockOutputSerializer(SensitiveCostSerializerMixin, SensitiveSupplierSerializerMixin, serializers.ModelSerializer):
    product_name = serializers.CharField(source="product_variant.product.name", read_only=True)
    variant_name = serializers.CharField(source="product_variant.name", read_only=True)
    sku = serializers.CharField(source="product_variant.sku", read_only=True)
    code = serializers.CharField(source="product_variant.code", read_only=True)
    barcode = serializers.CharField(source="product_variant.barcode", read_only=True)
    category_id = serializers.IntegerField(source="product_variant.product.category_id", read_only=True)
    category_name = serializers.CharField(source="product_variant.product.category.name", read_only=True)
    unit = serializers.CharField(source="product_variant.unit", read_only=True)
    currency = serializers.CharField(source="product_variant.currency", read_only=True)
    supplier = serializers.SerializerMethodField()

    class Meta:
        model = Stock
        fields = [
            "id", "product_variant", "quantity", "last_cost_price",
            "product_name", "variant_name", "sku", "code", "barcode",
            "category_id", "category_name", "unit", "currency", "supplier",
        ]
        read_only_fields = fields

    def get_supplier(self, obj) -> str | None:
        pv = getattr(obj, "product_variant", None)
        if not pv:
            return None
        cached_batches = getattr(pv, "_cached_supplier_batches", None)
        if cached_batches is not None:
            for b in cached_batches:
                if b.quantity > 0 and b.supplier:
                    return b.supplier
            if cached_batches and cached_batches[0].supplier:
                return cached_batches[0].supplier
        else:
            batch = pv.stock_batches.filter(quantity__gt=0).exclude(supplier="").order_by("-received_on", "-pk").first()
            if batch and batch.supplier:
                return batch.supplier
            batch = pv.stock_batches.exclude(supplier="").order_by("-received_on", "-pk").first()
            if batch and batch.supplier:
                return batch.supplier

        cached_movs = getattr(pv, "_cached_supplier_movements", None)
        if cached_movs is not None:
            if cached_movs and cached_movs[0].supplier:
                return cached_movs[0].supplier
        else:
            mov = pv.stock_movements.filter(direction="in").exclude(supplier="").order_by("-created_at", "-pk").first()
            if mov and mov.supplier:
                return mov.supplier

        return None


class StockMovementOutputSerializer(SensitiveCostSerializerMixin, SensitiveSupplierSerializerMixin, serializers.ModelSerializer):
    created_by_name = serializers.CharField(source="created_by.username", read_only=True)
    product_name = serializers.CharField(source="product_variant.product.name", read_only=True)
    variant_name = serializers.CharField(source="product_variant.name", read_only=True)
    code = serializers.CharField(source="product_variant.code", read_only=True)
    unit = serializers.CharField(source="product_variant.unit", read_only=True)
    currency = serializers.CharField(source="product_variant.currency", read_only=True)
    class Meta:
        model = StockMovement
        fields = [
            "id",
            "product_variant", "product_name", "variant_name", "code", "unit", "currency",
            "type", "direction", "quantity", "cost_price", "note", "supplier", "created_by", "created_by_name", "created_at",
        ]
        read_only_fields = fields


class InventoryIdempotencyInputSerializer(serializers.Serializer):
    idempotency_key = serializers.UUIDField(required=False)


class _BaseMovementInputSerializer(InventoryIdempotencyInputSerializer):
    product_variant_id = serializers.PrimaryKeyRelatedField(
        queryset=ProductVariant.objects.all(), source="product_variant"
    )
    def validate_product_variant_id(self, value):
        tenant = self.context.get("tenant")
        if tenant and value.tenant_id != tenant.id:
            raise serializers.ValidationError(
                "Product variant does not belong to your tenant."
            )
        return value

    def validate(self, attrs):
        batch_id = attrs.get('batch_id')
        if batch_id:
            from apps.inventory.models import StockBatch
            if not StockBatch.objects.filter(pk=batch_id, tenant=self.context.get('tenant'), product_variant=attrs.get('product_variant')).exists():
                raise serializers.ValidationError({'batch_id': 'Partiya ushbu do‘kon va mahsulotga tegishli bo‘lishi kerak.'})
        return attrs


class IntakeCreateSerializer(_BaseMovementInputSerializer):
    batch_code = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    expires_on = serializers.DateField(required=False, allow_null=True)
    quantity = serializers.DecimalField(max_digits=14, decimal_places=3, min_value=Decimal("0.001"))
    cost_price = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))
    supplier = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    note = serializers.CharField(required=False, allow_blank=True, default="")


class BatchIntakeItemInputSerializer(serializers.Serializer):
    batch_code = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    expires_on = serializers.DateField(required=False, allow_null=True)
    product_variant_id = serializers.PrimaryKeyRelatedField(
        queryset=ProductVariant.objects.all(), source="product_variant"
    )
    quantity = serializers.DecimalField(max_digits=14, decimal_places=3, min_value=Decimal("0.001"))
    cost_price = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))
    supplier = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    note = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_product_variant_id(self, value):
        tenant = self.context.get("tenant")
        if tenant and value.tenant_id != tenant.id:
            raise serializers.ValidationError("Tovar ushbu do'konga tegishli emas.")
        return value


class BatchIntakeCreateSerializer(InventoryIdempotencyInputSerializer):
    items = BatchIntakeItemInputSerializer(many=True)
    supplier = serializers.CharField(required=False, allow_blank=True, default="")
    faktura_number = serializers.CharField(required=False, allow_blank=True, default="")
    note = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError("Kamida bitta tovar kiritilishi shart.")
        if len(value) > 100:
            raise serializers.ValidationError("Bitta partiyada ko'pi bilan 100 ta tovar bo'lishi mumkin.")
        return value


class SimpleMovementCreateSerializer(_BaseMovementInputSerializer):
    batch_id = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    quantity = serializers.DecimalField(max_digits=14, decimal_places=3, min_value=Decimal("0.001"))
    note = serializers.CharField(required=False, allow_blank=True, default="")


class AdjustCreateSerializer(SimpleMovementCreateSerializer):
    quantity = serializers.DecimalField(max_digits=14, decimal_places=3, min_value=Decimal("0.001"))
    direction = serializers.ChoiceField(choices=StockMovement.DIRECTION_CHOICES)
    note = serializers.CharField(required=False, allow_blank=True, default="")


class TenantTransferLineInputSerializer(serializers.Serializer):
    source_variant_id = serializers.IntegerField(min_value=1)
    quantity = serializers.DecimalField(max_digits=14, decimal_places=3, min_value=Decimal("0.001"))
    destination_variant_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    destination_category_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)


class TenantTransferCreateSerializer(InventoryIdempotencyInputSerializer):
    request_key = serializers.UUIDField()
    destination_tenant_id = serializers.IntegerField(min_value=1)
    note = serializers.CharField(required=False, allow_blank=True, default="")
    items = TenantTransferLineInputSerializer(many=True)

    def validate_items(self, items):
        if not 1 <= len(items) <= 100:
            raise serializers.ValidationError("Transferda 1 dan 100 tagacha mahsulot bo‘lishi kerak.")
        return items


class TenantTransferReceiveLineSerializer(serializers.Serializer):
    item_id = serializers.IntegerField(min_value=1)
    received_quantity = serializers.DecimalField(max_digits=14, decimal_places=3, min_value=Decimal("0"))
    destination_variant_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    destination_category_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    discrepancy_reason = serializers.CharField(required=False, allow_blank=True, default="")


class TenantTransferReceiveSerializer(InventoryIdempotencyInputSerializer):
    items = TenantTransferReceiveLineSerializer(many=True)

    def validate_items(self, items):
        if not items:
            raise serializers.ValidationError("Kamida bitta qabul qatori yuboring.")
        item_ids = [item["item_id"] for item in items]
        if len(item_ids) != len(set(item_ids)):
            raise serializers.ValidationError("Qabul qatori takrorlanmasligi kerak.")
        return items


class TenantTransferReturnLineSerializer(serializers.Serializer):
    original_item_id = serializers.IntegerField(min_value=1)
    quantity = serializers.DecimalField(max_digits=14, decimal_places=3, min_value=Decimal("0.001"))


class TenantTransferReturnSerializer(InventoryIdempotencyInputSerializer):
    request_key = serializers.UUIDField()
    note = serializers.CharField(required=False, allow_blank=True, default="")
    items = TenantTransferReturnLineSerializer(many=True)

    def validate_items(self, items):
        if not items:
            raise serializers.ValidationError("Qaytariladigan mahsulotlarni kiriting.")
        ids = [item["original_item_id"] for item in items]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError("Asl transfer qatori takrorlanmasligi kerak.")
        return items


class TenantTransferDiscrepancyCloseSerializer(InventoryIdempotencyInputSerializer):
    reason = serializers.CharField(min_length=3, max_length=2000, trim_whitespace=True)


class TenantTransferItemOutputSerializer(serializers.ModelSerializer):
    source_product_name = serializers.CharField(source="source_variant.product.name", read_only=True)
    source_variant_name = serializers.CharField(source="source_variant.name", read_only=True)
    source_sku = serializers.CharField(source="source_variant.sku", read_only=True)
    destination_product_name = serializers.CharField(source="destination_variant.product.name", read_only=True, allow_null=True)
    destination_variant_name = serializers.CharField(source="destination_variant.name", read_only=True, allow_null=True)

    class Meta:
        model = TenantTransferItem
        fields = [
            "id", "source_variant", "source_product_name", "source_variant_name", "source_sku",
            "destination_variant", "destination_product_name", "destination_variant_name",
            "destination_category", "quantity_sent", "quantity_received", "discrepancy_reason",
            "quantity_returned", "quantity_return_in_transit", "original_item",
        ]
        read_only_fields = fields


class TenantTransferOutputSerializer(serializers.ModelSerializer):
    source_tenant_name = serializers.CharField(source="source_tenant.name", read_only=True)
    destination_tenant_name = serializers.CharField(source="destination_tenant.name", read_only=True)
    items = TenantTransferItemOutputSerializer(many=True, read_only=True)

    class Meta:
        model = TenantTransfer
        fields = [
            "id", "request_key", "source_tenant", "source_tenant_name", "destination_tenant",
            "destination_tenant_name", "kind", "status", "created_by", "received_by", "return_of",
            "note", "sent_at", "received_at", "items",
        ]
        read_only_fields = fields
