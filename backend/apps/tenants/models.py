import datetime
import secrets
from decimal import Decimal

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models.functions import Lower
from django.contrib.auth import get_user_model

User = get_user_model()


class SellerProfile(models.Model):
    LEGAL_FORM_YTT = "ytt"
    LEGAL_FORM_MCHJ = "mchj"
    LEGAL_FORM_OTHER = "other"
    LEGAL_FORM_CHOICES = [
        (LEGAL_FORM_YTT, "YTT"),
        (LEGAL_FORM_MCHJ, "MChJ"),
        (LEGAL_FORM_OTHER, "Boshqa"),
    ]
    STATUS_PENDING = "pending"
    STATUS_APPROVED = "approved"
    STATUS_REJECTED = "rejected"
    STATUS_EXPIRED = "expired"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Tekshiruv kutilmoqda"),
        (STATUS_APPROVED, "Tasdiqlangan"),
        (STATUS_REJECTED, "Rad etilgan"),
        (STATUS_EXPIRED, "Muddati o‘tgan"),
    ]

    owner = models.ForeignKey(User, on_delete=models.PROTECT, related_name="seller_profiles")
    legal_form = models.CharField(max_length=10, choices=LEGAL_FORM_CHOICES)
    official_name = models.CharField(max_length=200)
    tax_identifier = models.CharField(max_length=20)
    tax_regime = models.CharField(max_length=100, blank=True)
    permitted_activity = models.TextField(blank=True)
    fiscal_provider = models.CharField(max_length=150, blank=True)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_PENDING)
    submitted_at = models.DateTimeField(null=True, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL, related_name="reviewed_seller_profiles"
    )
    review_reason = models.TextField(blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["owner", "tax_identifier"], name="unique_seller_identifier_per_owner"),
        ]

    def __str__(self):
        return f"{self.official_name} ({self.get_status_display()})"


class CBUExchangeRate(models.Model):
    """Platform-wide official rates, normalized to one unit of foreign currency."""

    currency = models.CharField(max_length=3, choices=[(code, code) for code in ("USD", "EUR", "RUB")])
    rate = models.DecimalField(max_digits=18, decimal_places=6, validators=[MinValueValidator(Decimal("0.000001"))])
    effective_date = models.DateField()
    checked_at = models.DateTimeField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["currency", "effective_date"], name="unique_cbu_currency_date"),
        ]
        ordering = ["currency", "-effective_date"]


class Tenant(models.Model):
    TARGET_PERSONAL = 'personal'
    TARGET_GROUP = 'group'
    TARGET_BOTH = 'both'
    TARGET_NONE = 'none'
    TARGET_CHOICES = [
        (TARGET_PERSONAL, 'Faqat Shaxsiy chat'),
        (TARGET_GROUP, 'Faqat Guruh yoki Kanal'),
        (TARGET_BOTH, 'Ikkalasiga ham'),
        (TARGET_NONE, 'Yuborilmasin'),
    ]

    name = models.CharField(max_length=100)
    owner = models.ForeignKey(
        User, on_delete=models.PROTECT, related_name="owned_tenants"
    )
    seller_profile = models.ForeignKey(
        SellerProfile, null=True, blank=True, on_delete=models.PROTECT, related_name="tenants"
    )
    description = models.TextField(blank=True)
    address = models.CharField(max_length=255, blank=True, default="")
    public_code = models.CharField(max_length=12, unique=True, editable=False)
    is_active = models.BooleanField(default=True)
    usd_rate = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=12800.00,
        help_text="Ichki dollar kursi (ko'rgazmali hisoblash uchun)",
    )
    auto_usd_rate = models.BooleanField(default=False, help_text="Ichki hisoblash uchun CBU USD kursidan foydalanish")

    @property
    def effective_usd_rate(self):
        from apps.tenants.exchange_rates import ExchangeRateError, resolve_usd_rate
        try:
            return resolve_usd_rate(self)[0]
        except ExchangeRateError:
            return None

    daily_report_time = models.TimeField(
        default=datetime.time(22, 0),
        help_text="Kunlik Z-hisobot xabari yuboriladigan vaqt (masalan 22:00)",
    )
    last_daily_report_sent_at = models.DateTimeField(null=True, blank=True)

    # Telegram va Bildirishnoma sozlamalari
    daily_report_target = models.CharField(
        max_length=20,
        choices=TARGET_CHOICES,
        default=TARGET_BOTH,
        help_text="Kunlik hisobot yuboriladigan manzil",
    )
    shift_report_target = models.CharField(
        max_length=20,
        choices=TARGET_CHOICES,
        default=TARGET_BOTH,
        help_text="Smena yopilgandagi Z-hisobot yuboriladigan manzil",
    )
    telegram_group_id = models.CharField(
        max_length=100,
        blank=True,
        default="",
        help_text="Telegram guruh yoki kanal ID si (masalan: -1001234567890 yoki @kanal_nomi)",
    )
    notify_web_reports = models.BooleanField(
        default=True,
        help_text="Smena va kunlik hisobotlarni veb interfeys bildirishnomalariga yuborish",
    )
    notify_on_sale = models.BooleanField(
        default=False,
        help_text="Har bir savdodan so'ng Telegramga xabar yuborish",
    )
    notify_on_debt = models.BooleanField(
        default=True,
        help_text="Nasiya chegarasi va qarzdorlik haqida ogohlantirish",
    )

    # Kamayib qolgan tovarlar (Kamchiliklar / Defitsit) sozlamalari
    FREQUENCY_DAILY = 'daily'
    FREQUENCY_WEEKLY = 'weekly'
    FREQUENCY_MONTHLY = 'monthly'
    FREQUENCY_CHOICES = [
        (FREQUENCY_DAILY, 'Har kuni'),
        (FREQUENCY_WEEKLY, 'Haftalik'),
        (FREQUENCY_MONTHLY, 'Oylik'),
    ]

    low_stock_report_target = models.CharField(
        max_length=20,
        choices=TARGET_CHOICES,
        default=TARGET_BOTH,
        help_text="Kamchilik tovarlar hisoboti yuboriladigan manzil",
    )
    low_stock_report_time = models.TimeField(
        default=datetime.time(9, 0),
        help_text="Kamayib qolgan tovarlar hisoboti yuboriladigan vaqt (masalan 09:00)",
    )
    low_stock_frequency = models.CharField(
        max_length=10,
        choices=FREQUENCY_CHOICES,
        default=FREQUENCY_DAILY,
        help_text="Kamchilik tovarlar hisoboti davriyligi",
    )
    low_stock_weekday = models.PositiveSmallIntegerField(
        default=1,
        help_text="Haftalik reja uchun hafta kuni (1=Dushanba .. 7=Yakshanba)",
    )
    low_stock_day_of_month = models.PositiveSmallIntegerField(
        default=1,
        help_text="Oylik reja uchun oyning sanasi (1 .. 31)",
    )
    notify_web_low_stock = models.BooleanField(
        default=True,
        help_text="Kamayib qolgan tovarlar hisobotini veb interfeys bildirishnomalariga yuborish",
    )
    last_low_stock_report_sent_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="So'nggi marta kamchiliklar hisoboti yuborilgan sana va vaqt",
    )

    # Chek va Kassa sozlamalari
    receipt_header = models.TextField(
        blank=True,
        default="",
        help_text="Kassa cheki yuqori qismidagi matn",
    )
    receipt_footer = models.TextField(
        blank=True,
        default="Xaridingiz uchun rahmat!",
        help_text="Kassa cheki pastki qismidagi matn/shior",
    )
    receipt_phone = models.CharField(
        max_length=30,
        blank=True,
        default="",
        help_text="Chekda ko'rinadigan aloqa raqami",
    )

    tax_regime = models.CharField(max_length=16, default="unspecified", choices=[
        ("unspecified", "Belgilanmagan"),
        ("general", "Umumbelgilangan (QQS / foyda solig‘i)"),
        ("turnover", "Aylanmadan olinadigan soliq (AOS)"),
        ("other", "Boshqa soliq rejimi"),
    ])
    tax_regime_name = models.CharField(max_length=150, blank=True)
    is_vat_payer = models.BooleanField(default=False)
    vat_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("12.00"),
        validators=[MinValueValidator(0), MaxValueValidator(100)])
    price_includes_vat = models.BooleanField(default=True)
    turnover_tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0.00"),
        validators=[MinValueValidator(0), MaxValueValidator(100)])
    profit_tax_enabled = models.BooleanField(default=False)
    profit_tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0.00"),
        validators=[MinValueValidator(0), MaxValueValidator(100)])
    receipt_show_item_tax = models.BooleanField(default=True)
    receipt_show_cashier = models.BooleanField(default=True)
    receipt_show_customer = models.BooleanField(default=True)
    receipt_paper_width = models.CharField(max_length=4, default="58mm", choices=[("58mm", "58 mm"), ("80mm", "80 mm")])

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(Lower("name"), name="unique_tenant_name_ci"),
        ]

    def save(self, *args, **kwargs):
        if not self.public_code:
            for _ in range(10):
                candidate = secrets.token_hex(4).upper()
                if not type(self).objects.filter(public_code=candidate).exists():
                    self.public_code = candidate
                    break
            else:
                raise RuntimeError("Could not generate a unique tenant code")
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name
