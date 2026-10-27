"""Serializers for tenant creation and management."""

from django.contrib.auth import get_user_model
import re
from rest_framework import serializers

from apps.tenants.models import SellerProfile, Tenant
from apps.tenants.receipt_settings import RECEIPT_SETTING_FIELDS, receipt_settings
from apps.tenants.settings_revision import settings_revision

from .currency_serializers import CURRENCY_FIELDS, TenantCurrencyMixin


class ReceiptSettingsMixin:
    def get_settings_revision(self, obj) -> str:
        return settings_revision(obj)

    def validate_low_stock_weekday(self, value):
        if not 1 <= value <= 7:
            raise serializers.ValidationError("Hafta kuni 1 dan 7 gacha bo‘lsin.")
        return value

    def validate_low_stock_day_of_month(self, value):
        if not 1 <= value <= 31:
            raise serializers.ValidationError("Oy kuni 1 dan 31 gacha bo‘lsin.")
        return value

    def validate_telegram_group_id(self, value):
        if value and not re.fullmatch(r"-?[0-9]{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31}", value):
            raise serializers.ValidationError("Telegram manzilini raqamli ID yoki @kanal_nomi shaklida kiriting.")
        return value

    def get_receipt_settings(self, obj) -> dict:
        return receipt_settings(obj)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        def value(field):
            return attrs.get(field, getattr(self.instance, field, Tenant._meta.get_field(field).get_default()))
        regime = value("tax_regime")
        if regime == "turnover" and (value("is_vat_payer") or value("profit_tax_enabled")):
            raise serializers.ValidationError({"tax_regime": "AOS rejimida QQS va foyda solig‘ini o‘chiring."})
        if regime == "unspecified" and (value("is_vat_payer") or value("profit_tax_enabled")):
            raise serializers.ValidationError({"tax_regime": "Avval soliq rejimini tanlang."})
        if regime == "other" and not value("tax_regime_name").strip():
            raise serializers.ValidationError({"tax_regime_name": "Soliq rejimi nomini kiriting."})
        return attrs

User = get_user_model()


class TenantCreateSerializer(serializers.ModelSerializer):
    """Validate input for creating a tenant with its owner."""

    owner_phone_number = serializers.CharField(max_length=20, required=False, write_only=True)
    # Required e-mail address for the owner to send the password setup magic link.
    owner_email = serializers.EmailField(required=False, allow_blank=False, write_only=True)
    owner_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(), source='owner', required=False, write_only=True
    )

    class Meta:
        model = Tenant
        fields = [
            "id", "name",
            "owner_phone_number", "owner_email", "owner_id",
            "description", "is_active", "created_at",
        ]
        read_only_fields = ["id", "is_active", "created_at"]

    def validate(self, attrs):
        owner_phone = attrs.get("owner_phone_number")
        if not owner_phone and not attrs.get("owner"):
            raise serializers.ValidationError(
                "Either owner_phone_number or owner_id must be provided."
            )
        owner_email = attrs.get("owner_email")
        owner_user = attrs.get("owner")
        if owner_phone:
            normalized_phone = User.objects.normalize_phone_number(owner_phone)
            if owner_user and owner_user.phone_number != normalized_phone:
                raise serializers.ValidationError({"owner_id": "Ega ID va telefon raqami mos kelmaydi."})
            existing_owner = User.objects.filter(phone_number=normalized_phone).first()
            owner_user = existing_owner or owner_user
        if owner_email and owner_user and owner_user.email and owner_user.email.casefold() != owner_email.casefold():
            raise serializers.ValidationError(
                {"owner_email": "Bu hisobga boshqa email biriktirilgan. Mavjud egani tekshiring."}
            )
        if not owner_email and not (owner_user and owner_user.email):
            raise serializers.ValidationError(
                {"owner_email": "Do‘kon egasining email manzili majburiy (parol o‘rnatish xabari yuborilishi uchun)."}
            )
        return attrs


class TenantMySerializer(serializers.ModelSerializer):
    seller_profile = serializers.SerializerMethodField()

    class Meta:
        model = Tenant
        fields = ["id", "name", "public_code", "address", "is_active", "seller_profile"]

    def get_seller_profile(self, obj) -> dict | None:
        profile = obj.seller_profile
        if profile is None:
            return None
        return {"id": profile.id, "official_name": profile.official_name, "status": profile.status}


class SellerProfileOutputSerializer(serializers.ModelSerializer):
    tax_identifier_masked = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = SellerProfile
        fields = [
            "id", "legal_form", "official_name", "tax_identifier_masked", "tax_regime",
            "permitted_activity", "fiscal_provider", "status", "status_display",
            "submitted_at", "reviewed_at", "review_reason", "expires_at",
        ]
        read_only_fields = fields

    def get_tax_identifier_masked(self, obj) -> str:
        return f"••••{obj.tax_identifier[-4:]}" if obj.tax_identifier else ""


class SellerProfileReviewQueueSerializer(SellerProfileOutputSerializer):
    """Operational review data without exposing the full tax identifier."""

    owner_id = serializers.IntegerField(read_only=True)
    owner_name = serializers.SerializerMethodField()
    tenant_count = serializers.IntegerField(read_only=True)

    class Meta(SellerProfileOutputSerializer.Meta):
        fields = SellerProfileOutputSerializer.Meta.fields + [
            "owner_id", "owner_name", "tenant_count",
        ]

    def get_owner_name(self, obj) -> str:
        return obj.owner.get_full_name()


class SellerProfileInputSerializer(serializers.Serializer):
    legal_form = serializers.ChoiceField(choices=SellerProfile.LEGAL_FORM_CHOICES)
    official_name = serializers.CharField(max_length=200)
    tax_identifier = serializers.CharField(max_length=20, trim_whitespace=True, write_only=True)
    tax_regime = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    permitted_activity = serializers.CharField(required=False, allow_blank=True, default="")
    fiscal_provider = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")

    def validate_tax_identifier(self, value):
        request = self.context.get("request")
        profile = self.context.get("profile")
        duplicates = SellerProfile.objects.filter(owner=request.user, tax_identifier=value)
        if profile is not None:
            duplicates = duplicates.exclude(pk=profile.pk)
        if duplicates.exists():
            raise serializers.ValidationError("Bu identifikator bilan sotuvchi profili allaqachon mavjud.")
        return value


class SellerProfileReviewSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[
        (SellerProfile.STATUS_APPROVED, "Tasdiqlangan"),
        (SellerProfile.STATUS_REJECTED, "Rad etilgan"),
        (SellerProfile.STATUS_EXPIRED, "Muddati o‘tgan"),
    ])
    reason = serializers.CharField(required=False, allow_blank=True, default="")
    expires_at = serializers.DateTimeField(required=False, allow_null=True)


class SellerProfileBindingSerializer(serializers.Serializer):
    seller_profile_id = serializers.PrimaryKeyRelatedField(
        source="seller_profile", queryset=SellerProfile.objects.all(), required=True, allow_null=True
    )

    def validate_seller_profile(self, profile):
        if profile is not None and profile.owner_id != self.context["request"].user.id:
            raise serializers.ValidationError("Faqat o‘zingizga tegishli sotuvchi profilini tanlang.")
        return profile


class TenantCreateForOwnerSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    address = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    copy_settings_from = serializers.PrimaryKeyRelatedField(
        queryset=Tenant.objects.all(), required=False, allow_null=True
    )
    seller_profile = serializers.PrimaryKeyRelatedField(
        queryset=SellerProfile.objects.all(), required=False, allow_null=True
    )

    def validate_seller_profile(self, profile):
        request = self.context.get("request")
        if profile is not None and profile.owner_id != request.user.id:
            raise serializers.ValidationError("Faqat o‘zingizga tegishli sotuvchi profilini tanlang.")
        return profile

    def to_internal_value(self, data):
        allowed = {"name", "description", "address", "copy_settings_from", "seller_profile"}
        if isinstance(data, dict):
            unexpected = set(data) - allowed
            if unexpected:
                raise serializers.ValidationError({
                    key: "Bu maydon orqali boshqa foydalanuvchi tayinlab bo‘lmaydi."
                    for key in unexpected
                })
        return super().to_internal_value(data)


class TenantAdminSerializer(ReceiptSettingsMixin, TenantCurrencyMixin):
    """Full view for platform_admin. name/description/usd_rate/settings editable via PATCH;
    owner and is_active are changed only through their dedicated endpoints."""

    owner_details = serializers.SerializerMethodField()
    receipt_settings = serializers.SerializerMethodField()
    settings_revision = serializers.SerializerMethodField()

    class Meta:
        model = Tenant
        fields = [
            "id", "name", "owner", "owner_details", "description", "is_active",
            "usd_rate", "daily_report_time", "daily_report_target", "shift_report_target",
            "telegram_group_id", "notify_web_reports", "notify_on_sale", "notify_on_debt",
            "low_stock_report_target", "low_stock_report_time", "low_stock_frequency",
            "low_stock_weekday", "low_stock_day_of_month", "notify_web_low_stock",
            "last_low_stock_report_sent_at",
            "receipt_header", "receipt_footer", "receipt_phone", "created_at", "address", "receipt_settings",
        ] + list(RECEIPT_SETTING_FIELDS) + CURRENCY_FIELDS + ["settings_revision"]
        read_only_fields = ["id", "owner", "is_active", "last_low_stock_report_sent_at", "created_at"]

    def get_owner_details(self, obj) -> dict | None:
        if obj.owner:
            return {
                "id": obj.owner.id,
                "phone_number": obj.owner.phone_number,
                "contact_phone": obj.owner.contact_phone,
                "email": obj.owner.email,
                "first_name": obj.owner.first_name,
                "last_name": obj.owner.last_name,
                "username": obj.owner.username,
            }
        return None


class TenantOwnerSerializer(ReceiptSettingsMixin, TenantCurrencyMixin):
    """View for the tenant's own owner. Sees everything, edits settings and description."""

    owner_details = serializers.SerializerMethodField()
    receipt_settings = serializers.SerializerMethodField()
    settings_revision = serializers.SerializerMethodField()

    class Meta:
        model = Tenant
        fields = [
            "id", "name", "owner", "owner_details", "description", "is_active",
            "usd_rate", "daily_report_time", "daily_report_target", "shift_report_target",
            "telegram_group_id", "notify_web_reports", "notify_on_sale", "notify_on_debt",
            "low_stock_report_target", "low_stock_report_time", "low_stock_frequency",
            "low_stock_weekday", "low_stock_day_of_month", "notify_web_low_stock",
            "last_low_stock_report_sent_at",
            "receipt_header", "receipt_footer", "receipt_phone", "created_at", "address", "receipt_settings",
        ] + list(RECEIPT_SETTING_FIELDS) + CURRENCY_FIELDS + ["settings_revision"]
        read_only_fields = ["id", "name", "owner", "is_active", "last_low_stock_report_sent_at", "created_at"]

    def get_owner_details(self, obj) -> dict | None:
        if obj.owner:
            return {
                "id": obj.owner.id,
                "phone_number": obj.owner.phone_number,
                "contact_phone": obj.owner.contact_phone,
                "email": obj.owner.email,
                "first_name": obj.owner.first_name,
                "last_name": obj.owner.last_name,
                "username": obj.owner.username,
            }
        return None


class TenantStaffSerializer(ReceiptSettingsMixin, TenantCurrencyMixin):
    """Read-only view for staff."""

    receipt_settings = serializers.SerializerMethodField()
    settings_revision = serializers.SerializerMethodField()
    usd_rate = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = Tenant
        fields = [
            "id", "name", "owner", "description", "is_active",
            "usd_rate", "receipt_header", "receipt_footer", "receipt_phone", "receipt_settings",
        ] + CURRENCY_FIELDS + ["settings_revision"]
        read_only_fields = fields


class TenantSettingsSerializer(ReceiptSettingsMixin, TenantCurrencyMixin):
    """Assignable settings access does not expose owner account/contact details."""

    receipt_settings = serializers.SerializerMethodField()
    settings_revision = serializers.SerializerMethodField()

    class Meta:
        model = Tenant
        fields = [
            "id", "name", "description", "address", "usd_rate", "daily_report_time", "daily_report_target",
            "shift_report_target", "telegram_group_id", "notify_web_reports", "notify_on_sale", "notify_on_debt",
            "low_stock_report_target", "low_stock_report_time", "low_stock_frequency", "low_stock_weekday",
            "low_stock_day_of_month", "notify_web_low_stock", "receipt_header", "receipt_footer", "receipt_phone",
            "receipt_settings",
        ] + list(RECEIPT_SETTING_FIELDS) + CURRENCY_FIELDS + ["settings_revision"]
        read_only_fields = ["id", "name"]

    def to_internal_value(self, data):
        unexpected = set(data) - set(self.fields)
        if unexpected:
            raise serializers.ValidationError({key: "Bu sozlamani o‘zgartirish mumkin emas." for key in unexpected})
        return super().to_internal_value(data)


class TenantChangeOwnerSerializer(serializers.Serializer):
    """Validates input for the change-owner endpoint."""
    new_owner_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(),
        required=False,
    )
    new_owner_phone_number = serializers.CharField(
        max_length=20,
        required=False,
    )
    new_owner_email = serializers.EmailField(
        required=False,
        allow_blank=False,
    )

    def validate(self, attrs):
        new_owner_id = attrs.get('new_owner_id')
        new_phone = attrs.get('new_owner_phone_number')
        new_email = attrs.get('new_owner_email')

        if not new_owner_id and not new_phone:
            raise serializers.ValidationError(
                "Yangi do‘kon egasining ID raqami yoki telefon raqami kiritilishi shart."
            )
        if (
            new_owner_id and new_phone
            and new_owner_id.phone_number != User.objects.normalize_phone_number(new_phone)
        ):
            raise serializers.ValidationError(
                {"new_owner_id": "Ega ID va telefon raqami mos kelmaydi."}
            )
        if new_phone and not new_email:
            normalized_phone = User.objects.normalize_phone_number(new_phone)
            existing = User.objects.filter(phone_number=normalized_phone).first()
            if not existing or not existing.email:
                raise serializers.ValidationError(
                    {"new_owner_email": "Yangi egasining email manzili majburiy (parol o‘rnatish xabari yuborilishi uchun)."}
                )
        elif new_phone:
            normalized_phone = User.objects.normalize_phone_number(new_phone)
            existing = User.objects.filter(phone_number=normalized_phone).first()
            if existing and existing.email and existing.email.casefold() != new_email.casefold():
                raise serializers.ValidationError(
                    {"new_owner_email": "Bu hisobga boshqa email biriktirilgan. Mavjud egani tekshiring."}
                )
        if new_owner_id and not new_owner_id.email and not new_email:
            raise serializers.ValidationError(
                {"new_owner_email": "Ushbu foydalanuvchida email mavjud emas. Yangi egasining email manzili kiritilishi shart."}
            )
        if (
            new_owner_id and new_email and new_owner_id.email
            and new_owner_id.email.casefold() != new_email.casefold()
        ):
            raise serializers.ValidationError(
                {"new_owner_email": "Bu hisobga boshqa email biriktirilgan. Mavjud egani tekshiring."}
            )
        return attrs


class TenantCompactSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tenant
        fields = ['id', 'name', 'is_active']
        read_only_fields = fields
