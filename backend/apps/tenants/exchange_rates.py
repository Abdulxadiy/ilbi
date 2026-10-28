"""Fetch once for the platform; resolve each tenant's selected source locally."""

from datetime import datetime
from decimal import Decimal, InvalidOperation, localcontext
from zoneinfo import ZoneInfo

import requests
from django.db import transaction
from django.db.models import OuterRef, Subquery
from django.utils import timezone

from apps.tenants.models import CBUExchangeRate

CBU_URL = "https://cbu.uz/uz/arkhiv-kursov-valyut/json/"
CURRENCIES = ("USD", "EUR", "RUB")
TASHKENT = ZoneInfo("Asia/Tashkent")


class ExchangeRateError(Exception):
    """The last successful rates remain intact when the source is unavailable."""


def get_cbu_rates():
    today = timezone.localdate(timezone=TASHKENT)
    latest = CBUExchangeRate.objects.filter(
        currency=OuterRef("currency"), effective_date__lte=today,
    ).order_by("-effective_date").values("pk")[:1]
    return {row.currency: row for row in CBUExchangeRate.objects.filter(pk=Subquery(latest))}


def resolve_usd_rate(tenant, *, rates=None):
    if not tenant.auto_usd_rate:
        return tenant.usd_rate, "manual", None
    rates = get_cbu_rates() if rates is None else rates
    official = rates.get("USD")
    if official is None:
        raise ExchangeRateError("CBU USD kursi hali olinmagan. Keyinroq qayta urinib ko‘ring.")
    return official.rate, "cbu", official.effective_date


def sync_cbu_rates():
    try:
        # Date-specific endpoint avoids applying tomorrow's publication today.
        today = timezone.localdate(timezone=TASHKENT)
        response = requests.get(f"{CBU_URL}all/{today.isoformat()}/", timeout=(5, 20))
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise ExchangeRateError("CBU kurslarini olishning imkoni bo‘lmadi.") from exc

    # Validate the entire response before persisting any currency.
    parsed = {}
    try:
        if not isinstance(payload, list):
            raise ValueError("Expected a list")
        for row in payload:
            code = row.get("Ccy")
            if code not in CURRENCIES:
                continue
            if code in parsed:
                raise ValueError("Duplicate currency")
            nominal, raw_rate = Decimal(str(row["Nominal"])), Decimal(str(row["Rate"]))
            if not nominal.is_finite() or not raw_rate.is_finite() or nominal <= 0 or raw_rate <= 0:
                raise ValueError("Invalid rate or nominal")
            with localcontext() as ctx:
                ctx.prec = 32
                rate = (raw_rate / nominal).quantize(Decimal("0.000001"))
            if not Decimal("0") < rate < Decimal("10000000000"):
                raise ValueError("Rate out of range")
            effective_date = datetime.strptime(row["Date"], "%d.%m.%Y").date()
            parsed[code] = (rate, effective_date)
        if set(parsed) != set(CURRENCIES):
            raise ValueError("Missing currency")
    except (KeyError, TypeError, AttributeError, ValueError, InvalidOperation) as exc:
        raise ExchangeRateError("CBU javobidagi valyuta ma’lumotlari yaroqsiz.") from exc

    checked_at = timezone.now()
    with transaction.atomic():
        for code in CURRENCIES:
            rate, effective_date = parsed[code]
            CBUExchangeRate.objects.update_or_create(
                currency=code, effective_date=effective_date,
                defaults={"rate": rate, "checked_at": checked_at},
            )
    return parsed
