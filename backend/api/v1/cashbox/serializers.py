from decimal import Decimal

from rest_framework import serializers

from apps.cashbox.models import CashExpense, CashIncome, DailyCashReport


class CashExpenseSerializer(serializers.ModelSerializer):
    recorded_by_name = serializers.SerializerMethodField()
    idempotency_key = serializers.UUIDField(required=False, write_only=True)
    expected_shift_id = serializers.IntegerField(required=False, min_value=1, write_only=True)

    class Meta:
        model = CashExpense
        fields = [
            'idempotency_key', 'expected_shift_id',
            'id',
            'amount',
            'currency',
            'category',
            'recorded_by',
            'recorded_by_name',
            'shift_report',
            'date',
            'note',
            'created_at',
        ]
        read_only_fields = ['id', 'recorded_by', 'shift_report', 'created_at']

    def get_recorded_by_name(self, obj) -> str:
        name_parts = [obj.recorded_by.first_name, obj.recorded_by.last_name]
        return " ".join(p for p in name_parts if p).strip() or obj.recorded_by.username or obj.recorded_by.phone_number


class CashIncomeSerializer(serializers.ModelSerializer):
    recorded_by_name = serializers.SerializerMethodField()
    idempotency_key = serializers.UUIDField(required=False, write_only=True)
    expected_shift_id = serializers.IntegerField(required=False, min_value=1, write_only=True)

    class Meta:
        model = CashIncome
        fields = [
            'idempotency_key', 'expected_shift_id',
            'id',
            'amount',
            'currency',
            'source',
            'recorded_by',
            'recorded_by_name',
            'shift_report',
            'date',
            'note',
            'created_at',
        ]
        read_only_fields = ['id', 'recorded_by', 'shift_report', 'created_at']

    def get_recorded_by_name(self, obj) -> str:
        name_parts = [obj.recorded_by.first_name, obj.recorded_by.last_name]
        return " ".join(p for p in name_parts if p).strip() or obj.recorded_by.username or obj.recorded_by.phone_number


class ShiftCloseSerializer(serializers.Serializer):
    idempotency_key = serializers.UUIDField(required=False, write_only=True)
    shift_id = serializers.IntegerField(required=False, min_value=1)
    expected_cash_uzs = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, write_only=True)
    expected_cash_usd = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, write_only=True)
    actual_cash_uzs = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal('0.00'))
    actual_cash_usd = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal('0.00'))
    discrepancy_reason = serializers.CharField(required=False, allow_blank=True, default='')
    staff_notes = serializers.CharField(required=False, allow_blank=True, default='')


class DailyCashReportSerializer(serializers.ModelSerializer):
    tenant_name = serializers.CharField(source="tenant.name", read_only=True)
    closed_by_name = serializers.SerializerMethodField()
    incomes = CashIncomeSerializer(many=True, read_only=True)
    expenses = CashExpenseSerializer(many=True, read_only=True)

    class Meta:
        model = DailyCashReport
        fields = [
            'id',
            'date',
            'tenant_name',
            'shift',
            'opening_cash_uzs',
            'opening_cash_usd',
            'collected_debt_cash_uzs',
            'collected_debt_cash_usd',
            'refund_cash_uzs',
            'refund_cash_usd',
            'closed_by',
            'closed_by_name',
            'closed_at',
            'total_sale_cash_uzs',
            'total_sale_cash_usd',
            'total_sale_card_uzs',
            'total_sale_card_usd',
            'total_sale_debt_uzs',
            'total_sale_debt_usd',
            'total_extra_income_uzs',
            'total_extra_income_usd',
            'total_expenses_uzs',
            'total_expenses_usd',
            'expected_cash_uzs',
            'expected_cash_usd',
            'actual_cash_uzs',
            'actual_cash_usd',
            'discrepancy_uzs',
            'discrepancy_usd',
            'discrepancy_reason',
            'staff_notes',
            'is_closed',
            'incomes',
            'expenses',
        ]
        read_only_fields = fields

    def get_closed_by_name(self, obj) -> str:
        name_parts = [obj.closed_by.first_name, obj.closed_by.last_name]
        return " ".join(p for p in name_parts if p).strip() or obj.closed_by.username or obj.closed_by.phone_number


class DailyCashReportListSerializer(DailyCashReportSerializer):
    class Meta(DailyCashReportSerializer.Meta):
        fields = [field for field in DailyCashReportSerializer.Meta.fields if field not in ('incomes', 'expenses')]

    incomes = None
    expenses = None


class ShiftOpenSerializer(serializers.Serializer):
    idempotency_key = serializers.UUIDField(required=False, write_only=True)
    expected_report_id = serializers.IntegerField(required=False, allow_null=True, min_value=1, write_only=True)
    opening_cash_uzs = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal('0'), required=False)
    opening_cash_usd = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal('0'), required=False)
