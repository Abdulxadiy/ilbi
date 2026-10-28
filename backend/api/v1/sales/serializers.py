from decimal import Decimal

from rest_framework import serializers

from api.serializers import SensitiveCostSerializerMixin
from apps.sales.models import (
    Counterparty,
    DebtPayment,
    Notification,
    Sale,
    SaleItem,
)
from apps.sales.services.counterparty_queries import DUE_STATUSES


class CounterpartyOutputSerializer(serializers.ModelSerializer):
    target_tenant_name = serializers.CharField(source="target_tenant.name", read_only=True)
    last_payment = serializers.SerializerMethodField()

    class Meta:
        model = Counterparty
        fields = [
            "id",
            "name",
            "phone_number",
            "target_tenant",
            "target_tenant_name",
            "debt_balance_uzs",
            "debt_balance_usd",
            "debt_due_date",
            "note",
            "is_active",
            "created_at",
            "last_payment",
        ]
        read_only_fields = fields

    def get_last_payment(self, obj) -> dict | None:
        prefetched = getattr(obj, "prefetched_payments", None)
        if prefetched is not None:
            payment = prefetched[0] if prefetched else None
        else:
            payment = obj.payments.select_related("recorded_by", "branch", "tenant").order_by("-paid_at").first()

        if not payment:
            return None

        branch_name = ""
        if payment.branch:
            branch_name = payment.branch.name
        elif payment.tenant:
            branch_name = payment.tenant.name

        recorded_by_name = ""
        if payment.recorded_by:
            recorded_by_name = payment.recorded_by.get_full_name() or payment.recorded_by.username

        return {
            "id": payment.id,
            "amount": str(payment.amount),
            "currency": payment.currency,
            "paid_at": payment.paid_at.isoformat() if payment.paid_at else None,
            "recorded_by_name": recorded_by_name,
            "branch_id": payment.branch_id or payment.tenant_id,
            "branch_name": branch_name,
            "note": payment.note,
            "is_correction": payment.is_correction,
            "exchange_rate": str(payment.exchange_rate) if payment.exchange_rate is not None else None,
            "exchange_rate_source": payment.exchange_rate_source,
            "exchange_rate_date": payment.exchange_rate_date.isoformat() if payment.exchange_rate_date else None,
            "converted_amount_uzs": (
                str(payment.converted_amount_uzs) if payment.converted_amount_uzs is not None else None
            ),
        }


class CounterpartyDueQuerySerializer(serializers.Serializer):
    due_status = serializers.ChoiceField(choices=DUE_STATUSES, required=False, allow_blank=True)


class CounterpartyCreateSerializer(serializers.Serializer):
    debt_due_date = serializers.DateField(required=False, allow_null=True)
    target_tenant_code = serializers.CharField(max_length=12, required=False, allow_blank=True, default="")
    name = serializers.CharField(max_length=150)
    phone_number = serializers.CharField(max_length=20)
    note = serializers.CharField(required=False, allow_blank=True, default="")


class CounterpartyUpdateSerializer(serializers.Serializer):
    debt_due_date = serializers.DateField(required=False, allow_null=True)
    name = serializers.CharField(max_length=150, required=False)
    note = serializers.CharField(required=False, allow_blank=True)
    is_active = serializers.BooleanField(required=False)


class DebtPaymentOutputSerializer(serializers.ModelSerializer):
    recorded_by_name = serializers.SerializerMethodField()
    branch_id = serializers.SerializerMethodField()
    branch_name = serializers.SerializerMethodField()

    class Meta:
        model = DebtPayment
        fields = [
            "id",
            "counterparty",
            "amount",
            "currency",
            "paid_at",
            "recorded_by",
            "recorded_by_name",
            "branch",
            "branch_id",
            "branch_name",
            "is_correction",
            "payment_type",
            "note",
            "exchange_rate",
            "exchange_rate_source",
            "exchange_rate_date",
            "converted_amount_uzs",
        ]
        read_only_fields = fields

    def get_recorded_by_name(self, obj) -> str:
        if obj.recorded_by:
            return obj.recorded_by.get_full_name() or obj.recorded_by.username
        return "Kassir"

    def get_branch_id(self, obj) -> int | None:
        return obj.branch_id or obj.tenant_id

    def get_branch_name(self, obj) -> str:
        if obj.branch:
            return obj.branch.name
        if obj.tenant:
            return obj.tenant.name
        return ""


class DebtPaymentCreateSerializer(serializers.Serializer):
    payment_type = serializers.ChoiceField(choices=["cash", "card"], default="cash")
    idempotency_key = serializers.CharField(max_length=64, required=False, allow_blank=False)
    expected_quote = serializers.RegexField(regex=r"^[a-f0-9]{64}$", required=False, write_only=True)
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.01"))
    currency = serializers.ChoiceField(choices=["UZS", "USD"])
    branch_id = serializers.IntegerField(required=False, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if "expected_quote" in attrs and not attrs.get("idempotency_key"):
            raise serializers.ValidationError(
                {"idempotency_key": "Tasdiqlangan to‘lov uchun asl qayta so‘rash kaliti kerak."}
            )
        return attrs


class DebtPaymentQuoteSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.01"))
    currency = serializers.ChoiceField(choices=["UZS", "USD"])
    payment_type = serializers.ChoiceField(choices=["cash", "card"], default="cash")
    branch_id = serializers.IntegerField(required=False, min_value=1)


class DebtPaymentCorrectionSerializer(serializers.Serializer):
    payment_type = serializers.ChoiceField(choices=["cash", "card", "none"], default="none")
    idempotency_key = serializers.CharField(max_length=64, required=False, allow_blank=False)
    amount = serializers.DecimalField(max_digits=14, decimal_places=2)
    currency = serializers.ChoiceField(choices=["UZS", "USD"])
    branch_id = serializers.IntegerField(required=False, allow_null=True)
    note = serializers.CharField(required=True, allow_blank=False)


class ReceiptProductSerializer(serializers.ModelSerializer):
    product_variant_name = serializers.CharField(source="receipt_product.product_variant_name", read_only=True)
    product_name = serializers.CharField(source="receipt_product.product_name", read_only=True)
    product_code = serializers.CharField(source="receipt_product.product_code", read_only=True)
    product_sku = serializers.CharField(source="receipt_product.product_sku", read_only=True)
    product_barcode = serializers.CharField(source="receipt_product.product_barcode", read_only=True, allow_null=True)
    unit = serializers.CharField(source="receipt_product.unit", read_only=True)
    mxik = serializers.CharField(source="receipt_product.mxik", read_only=True, allow_null=True)
    package_code = serializers.CharField(source="receipt_product.package_code", read_only=True, allow_null=True)


class SaleItemOutputSerializer(SensitiveCostSerializerMixin, ReceiptProductSerializer):

    class Meta:
        model = SaleItem
        fields = [
            "id",
            "product_variant",
            "product_name",
            "product_variant_name",
            "product_code",
            "product_sku",
            "product_barcode",
            "unit",
            "mxik", "package_code",
            "quantity",
            "unit_price",
            "cost_price",
            "original_partner_price",
            "total_price",
            "net_amount", "tax_amount", "tax_rate",
            "status",
            "voided_quantity",
            "b2b_accepted_quantity",
            "b2b_rejected_quantity",
            "b2b_return_pending_quantity",
            "b2b_discrepancy_closed_quantity",
        ]
        read_only_fields = fields


class SaleOutputSerializer(serializers.ModelSerializer):
    tenant_name = serializers.CharField(source="tenant.name", read_only=True)
    tenant_address = serializers.CharField(source="tenant.address", read_only=True)
    tenant_phone = serializers.CharField(source="tenant.receipt_phone", read_only=True)
    sold_by_name = serializers.CharField(source="sold_by.get_full_name", read_only=True)
    counterparty_name = serializers.CharField(source="counterparty.name", read_only=True)
    counterparty_phone = serializers.CharField(source="counterparty.phone_number", read_only=True)
    b2b_target_tenant_name = serializers.CharField(source="b2b_target_tenant.name", read_only=True)
    items = SaleItemOutputSerializer(many=True, read_only=True)

    class Meta:
        model = Sale
        fields = [
            "id",
            "receipt_number",
            "public_token",
            "tenant_name",
            "tenant_address",
            "tenant_phone",
            "sold_by",
            "sold_by_name",
            "counterparty",
            "counterparty_name",
            "counterparty_phone",
            "currency",
            "is_partner_sale",
            "total_amount",
            "subtotal_amount", "tax_amount", "receipt_snapshot",
            "refunded_amount",
            "net_amount",
            "payment_type",
            "status",
            "b2b_target_tenant",
            "b2b_target_tenant_name",
            "b2b_expires_at",
            "b2b_reject_reason",
            "voided_at",
            "voided_by",
            "void_reason",
            "items",
            "created_at",
        ]
        read_only_fields = fields


class SaleCreateItemInputSerializer(serializers.Serializer):
    product_variant_id = serializers.IntegerField()
    quantity = serializers.DecimalField(max_digits=14, decimal_places=3, min_value=Decimal("0.001"))
    unit_price = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, min_value=Decimal("0.01"))


class SaleCreateInputSerializer(serializers.Serializer):
    debt_due_date = serializers.DateField(required=False, allow_null=True)
    expected_tax_settings = serializers.JSONField(required=False)
    items = SaleCreateItemInputSerializer(many=True)
    payment_type = serializers.ChoiceField(choices=["cash", "card", "debt"], default="cash")
    counterparty_id = serializers.IntegerField(required=False, allow_null=True)
    is_partner_sale = serializers.BooleanField(default=False)
    idempotency_key = serializers.CharField(max_length=64, required=False, allow_null=True, allow_blank=True)

    def validate(self, attrs):
        if 'debt_due_date' in attrs and attrs['payment_type'] != 'debt':
            raise serializers.ValidationError({'debt_due_date': 'Qaytarish sanasi faqat nasiya savdosida belgilanadi.'})
        return attrs


class SaleVoidSerializer(serializers.Serializer):
    idempotency_key = serializers.CharField(max_length=64, required=False, allow_blank=False)
    reason = serializers.CharField(required=True, allow_blank=False)


class SaleItemVoidSerializer(serializers.Serializer):
    idempotency_key = serializers.CharField(max_length=64, required=False, allow_blank=False)
    quantity = serializers.DecimalField(max_digits=14, decimal_places=3, min_value=Decimal("0.001"))
    reason = serializers.CharField(required=True, allow_blank=False)


class B2BAcceptItemSerializer(serializers.Serializer):
    sale_item_id = serializers.IntegerField()
    accepted_quantity = serializers.DecimalField(max_digits=14, decimal_places=3, min_value=Decimal("0.000"))
    target_category_id = serializers.IntegerField(required=False, allow_null=True)
    target_variant_id = serializers.IntegerField(required=False, allow_null=True)


class B2BAcceptInputSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField(required=False, write_only=True)
    items = B2BAcceptItemSerializer(many=True)


class B2BRejectInputSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField(required=False, write_only=True)
    reason = serializers.CharField(required=True, allow_blank=False)


class B2BReturnItemInputSerializer(serializers.Serializer):
    sale_item_id = serializers.IntegerField(min_value=1)
    quantity = serializers.DecimalField(max_digits=14, decimal_places=3, min_value=Decimal("0.001"))


class B2BReturnInputSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField(required=False, write_only=True)
    idempotency_key = serializers.CharField(max_length=64, allow_blank=False)
    reason = serializers.CharField(required=True, allow_blank=False)
    items = B2BReturnItemInputSerializer(many=True, allow_empty=False)


class B2BReturnDiscrepancyCloseInputSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField(required=False, write_only=True)
    idempotency_key = serializers.CharField(max_length=64, allow_blank=False)
    reason = serializers.CharField(required=True, allow_blank=False)
    items = B2BReturnItemInputSerializer(many=True, allow_empty=False)


class B2BIncomingSaleItemSerializer(ReceiptProductSerializer):

    class Meta:
        model = SaleItem
        fields = [
            "id",
            "product_name",
            "product_variant_name",
            "product_code",
            "product_sku",
            "product_barcode",
            "unit",
            "mxik", "package_code",
            "quantity",
            "unit_price",
            "status",
            "b2b_accepted_quantity",
            "voided_quantity",
            "b2b_rejected_quantity",
            "b2b_return_pending_quantity",
            "b2b_discrepancy_closed_quantity",
        ]
        read_only_fields = fields


class B2BIncomingSaleSerializer(serializers.ModelSerializer):
    source_tenant_name = serializers.CharField(source="tenant.name", read_only=True)
    items = B2BIncomingSaleItemSerializer(many=True, read_only=True)

    class Meta:
        model = Sale
        fields = [
            "id",
            "receipt_number",
            "source_tenant_name",
            "currency",
            "total_amount",
            "refunded_amount",
            "net_amount",
            "status",
            "b2b_expires_at",
            "items",
            "created_at",
        ]
        read_only_fields = fields


class NotificationOutputSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ["id", "recipient", "type", "title", "message", "link", "is_read", "created_at"]
        read_only_fields = fields


class PublicReceiptItemSerializer(ReceiptProductSerializer):

    class Meta:
        model = SaleItem
        fields = [
            "id",
            "product_name",
            "product_variant_name",
            "unit",
            "mxik", "package_code",
            "quantity",
            "voided_quantity",
            "status",
            "unit_price",
            "total_price",
            "net_amount", "tax_amount", "tax_rate",
        ]
        read_only_fields = fields


class PublicReceiptSerializer(serializers.ModelSerializer):
    store_name = serializers.CharField(source="tenant.name", read_only=True)
    store_address = serializers.CharField(source="tenant.address", read_only=True)
    store_phone = serializers.CharField(source="tenant.receipt_phone", read_only=True)
    payment_type_display = serializers.CharField(source="get_payment_type_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    items = serializers.SerializerMethodField()

    class Meta:
        model = Sale
        fields = [
            "receipt_number",
            "store_name",
            "store_address",
            "store_phone",
            "currency",
            "total_amount",
            "subtotal_amount", "tax_amount", "receipt_snapshot",
            "refunded_amount",
            "net_amount",
            "payment_type",
            "payment_type_display",
            "status",
            "status_display",
            "created_at",
            "items",
        ]
        read_only_fields = fields

    def get_items(self, obj) -> list[dict]:
        return PublicReceiptItemSerializer(obj.items.all(), many=True).data


class SaleListQuerySerializer(serializers.Serializer):
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)
    status = serializers.ChoiceField(choices=Sale.STATUS_CHOICES, required=False)
    currency = serializers.ChoiceField(choices=Sale.CURRENCY_CHOICES, required=False)
    payment_type = serializers.ChoiceField(choices=Sale.PAYMENT_CHOICES, required=False)
    counterparty_id = serializers.IntegerField(required=False, min_value=1)
    b2b_only = serializers.BooleanField(required=False)

    def validate(self, attrs):
        if attrs.get('date_from') and attrs.get('date_to') and attrs['date_from'] > attrs['date_to']:
            raise serializers.ValidationError('Boshlanish sanasi tugash sanasidan katta bo‘lmaydi.')
        return attrs
