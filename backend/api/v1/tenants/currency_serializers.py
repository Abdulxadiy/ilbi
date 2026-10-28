from decimal import Decimal

from rest_framework import serializers

from apps.tenants.exchange_rates import get_cbu_rates

CURRENCY_FIELDS = ["auto_usd_rate", "manual_usd_rate", "usd_rate_source", "cbu_rates"]


class TenantCurrencyMixin(serializers.ModelSerializer):
    # Existing clients keep receiving the effective rate through usd_rate.
    # Writes to the same field only change the owner's stored manual rate.
    usd_rate = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"), required=False)
    manual_usd_rate = serializers.DecimalField(source="usd_rate", max_digits=12, decimal_places=2, read_only=True)
    usd_rate_source = serializers.SerializerMethodField()
    cbu_rates = serializers.SerializerMethodField()

    def _rates(self):
        if "cbu_rates" not in self.context:
            self.context["cbu_rates"] = get_cbu_rates()
        return self.context["cbu_rates"]

    def get_usd_rate_source(self, obj) -> str:
        return "cbu" if obj.auto_usd_rate else "manual"

    def get_cbu_rates(self, obj) -> dict:
        return {
            code: {
                "rate": str(row.rate),
                "date": row.effective_date.isoformat(),
                "checked_at": row.checked_at.isoformat(),
            }
            for code, row in self._rates().items()
        }

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if instance.auto_usd_rate:
            official = self._rates().get("USD")
            data["usd_rate"] = f"{official.rate:.2f}" if official else None
        return data

    def validate(self, attrs):
        attrs = super().validate(attrs)
        automatic = attrs.get("auto_usd_rate", getattr(self.instance, "auto_usd_rate", False))
        if automatic and "usd_rate" in attrs:
            raise serializers.ValidationError({
                "usd_rate": "CBU avtomatik rejimida ichki kursni qo‘lda o‘zgartirib bo‘lmaydi.",
            })
        if automatic and "USD" not in self._rates():
            raise serializers.ValidationError({
                "auto_usd_rate": "CBU USD kursi hali olinmagan. Keyinroq qayta urinib ko‘ring.",
            })
        return attrs
