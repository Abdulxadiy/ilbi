"""Opaque revision for optimistic settings writes; no operational values leave here."""

import hashlib
import json

from .receipt_settings import RECEIPT_SETTING_FIELDS

SETTINGS_REVISION_FIELDS = (
    "name", "description", "address", "usd_rate", "auto_usd_rate",
    "daily_report_time", "daily_report_target", "shift_report_target", "telegram_group_id",
    "notify_web_reports", "notify_on_sale", "notify_on_debt", "low_stock_report_target",
    "low_stock_report_time", "low_stock_frequency", "low_stock_weekday", "low_stock_day_of_month",
    "notify_web_low_stock", "receipt_header", "receipt_footer", "receipt_phone",
) + RECEIPT_SETTING_FIELDS


def settings_revision(tenant):
    values = {field: getattr(tenant, field) for field in SETTINGS_REVISION_FIELDS}
    values["tenant_id"] = tenant.pk
    encoded = json.dumps(values, sort_keys=True, default=str, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
