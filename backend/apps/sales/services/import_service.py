import re
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.services.permission_service import PermissionService
from apps.core.services.audit_service import AuditService
from apps.core.spreadsheets import read_import_file
from apps.sales.models import Counterparty, CounterpartyImportJob, DebtPayment
from apps.sales.services.counterparty_service import CounterpartyService
from apps.tenants.models import Tenant

TEMPLATE_HEADERS = ["mijoz", "telefon", "nasiya_uzs", "nasiya_usd", "izoh"]
IMPORT_PROTOCOL = "ilbi-counterparty-import-v1"
HEADERS = dict(
    zip(TEMPLATE_HEADERS, ["name", "phone_number", "debt_balance_uzs", "debt_balance_usd", "note"], strict=True)
)
MONEY_FIELDS = ("debt_balance_uzs", "debt_balance_usd")


def normalized_phone(value):
    return re.sub(r"[\s()+-]", "", str(value))


class CounterpartyImportRowSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=150)
    phone_number = serializers.CharField(max_length=40)
    debt_balance_uzs = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0, default=Decimal("0.00"))
    debt_balance_usd = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0, default=Decimal("0.00"))
    note = serializers.CharField(max_length=5000, allow_blank=True, required=False, default="")

    def validate_phone_number(self, value):
        digits = normalized_phone(value)
        if not digits.isascii() or not digits.isdigit() or not 7 <= len(digits) <= 15:
            raise serializers.ValidationError("Telefon raqami 7–15 ta raqamdan iborat bo‘lsin.")
        return "+" + digits


class CounterpartyImportService:
    @classmethod
    def check_rows(cls, rows, tenant, user):
        if not PermissionService.has_permission(user, "sales.manage_counterparty", tenant=tenant):
            raise PermissionDenied("Mijozlarni boshqarish uchun ruxsat yo‘q.")
        can_add_debt = PermissionService.has_permission(user, "sales.record_debt_payment", tenant=tenant)
        existing = {
            normalized_phone(phone)
            for phone in Counterparty.objects.filter(tenant=tenant).values_list("phone_number", flat=True)
        }
        seen = set()
        checked = []
        for row in rows:
            serializer = CounterpartyImportRowSerializer(data=row["data"])
            serializer.is_valid()
            errors = {field: " ".join(map(str, messages)) for field, messages in serializer.errors.items()}
            phone = normalized_phone(row["data"].get("phone_number", ""))
            if phone:
                if phone in seen:
                    errors["phone_number"] = "Telefon raqami faylda takrorlangan."
                elif phone in existing:
                    errors["phone_number"] = "Bu telefonli mijoz mavjud (arxivni ham tekshiring)."
                seen.add(phone)
            if not errors:
                for field in MONEY_FIELDS:
                    if serializer.validated_data[field] > 0 and not can_add_debt:
                        errors[field] = "Boshlang‘ich nasiya uchun qarz to‘lovlarini qayd etish ruxsati kerak."
            checked.append({**row, "errors": errors})
        return checked

    @classmethod
    def preview(cls, *, upload, tenant, user):
        rows = read_import_file(upload)
        if any("\x00" in str(value) for row in rows for value in row):
            raise ValidationError("Faylda noto‘g‘ri boshqaruv belgisi bor. Ma’lumotlarni tozalab qayta yuklang.")
        headers = [HEADERS.get(str(h).strip().lower().replace(" ", "_"), str(h).strip().lower()) for h in rows[0]]
        fields = set(CounterpartyImportRowSerializer().fields)
        if len(set(headers)) != len(headers) or any(header not in fields for header in headers):
            raise ValidationError("Ustun nomlari shablonga mos bo‘lishi va takrorlanmasligi kerak.")
        if not {"name", "phone_number"}.issubset(headers):
            raise ValidationError("mijoz va telefon ustunlari majburiy.")
        parsed = []
        for number, values in enumerate(rows[1:], start=2):
            if not any(str(value).strip() for value in values):
                continue
            if len(values) > len(headers):
                raise ValidationError(f"{number}-qatorda ustunlar soni sarlavhadan ko‘p.")
            data = {
                header: str(value).strip() for header, value in zip(headers, values, strict=False) if str(value).strip()
            }
            for field in MONEY_FIELDS:
                if field in data:
                    data[field] = data[field].replace(" ", "").replace("\u00a0", "").replace(",", ".")
            parsed.append({"row_number": number, "data": data})
        if not parsed:
            raise ValidationError("Faylda mijoz qatorlari yo‘q.")
        return CounterpartyImportJob.objects.create(
            tenant=tenant,
            created_by=user,
            rows=cls.check_rows(parsed, tenant, user),
            expires_at=timezone.now() + timedelta(hours=1),
        )

    @classmethod
    @transaction.atomic
    def commit(cls, *, job_id, tenant, user, request=None):
        Tenant.objects.select_for_update().get(pk=tenant.pk)
        job = CounterpartyImportJob.objects.select_for_update().get(pk=job_id, tenant=tenant, created_by=user)
        if job.completed_at:
            return job.result
        if job.expires_at <= timezone.now():
            raise ValidationError("Ko‘rib chiqish muddati tugadi. Faylni qayta yuklang.")
        checked = cls.check_rows(job.rows, tenant, user)
        if any(row["errors"] for row in checked):
            raise ValidationError({"detail": "Xatoli qatorlar bor. Faylni tuzatib qayta tekshiring.", "rows": checked})
        created_ids = []
        totals = {field: Decimal("0.00") for field in MONEY_FIELDS}
        for row in checked:
            serializer = CounterpartyImportRowSerializer(data=row["data"])
            serializer.is_valid(raise_exception=True)
            data = dict(serializer.validated_data)
            balances = {field: data.pop(field) for field in MONEY_FIELDS}
            cp = CounterpartyService.create(tenant=tenant, **data)
            for field, currency in zip(MONEY_FIELDS, ("UZS", "USD"), strict=True):
                amount = balances[field]
                setattr(cp, field, amount)
                totals[field] += amount
                if amount:
                    # Opening balances are historical debt, never cash receipts or FX conversions.
                    DebtPayment.objects.create(
                        tenant=tenant,
                        branch=tenant,
                        counterparty=cp,
                        amount=-amount,
                        currency=currency,
                        payment_type="none",
                        is_correction=True,
                        recorded_by=user,
                        note=f"XLSX/CSV import #{job.pk}: boshlang‘ich nasiya. {cp.note}".strip(),
                    )
            cp.save(update_fields=list(MONEY_FIELDS))
            created_ids.append(cp.pk)
        job.completed_at = timezone.now()
        job.result = {
            "created_count": len(created_ids),
            "counterparty_ids": created_ids,
            "total_debt_uzs": str(totals["debt_balance_uzs"]),
            "total_debt_usd": str(totals["debt_balance_usd"]),
        }
        job.save(update_fields=["completed_at", "result", "updated_at"])
        AuditService.log(
            action="counterparty_import",
            actor=user,
            tenant=tenant,
            target_model="CounterpartyImportJob",
            target_id=str(job.pk),
            changes=job.result,
            description="Mijozlar va boshlang‘ich nasiya fayldan import qilindi",
            request=request,
        )
        return job.result
