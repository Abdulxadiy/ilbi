"""Public receipt configuration. Keep private operational settings out of receipts."""

RECEIPT_SETTING_FIELDS = (
    "tax_regime",
    "tax_regime_name",
    "is_vat_payer",
    "vat_rate",
    "price_includes_vat",
    "turnover_tax_rate",
    "profit_tax_enabled",
    "profit_tax_rate",
    "receipt_show_item_tax",
    "receipt_show_cashier",
    "receipt_show_customer",
    "receipt_paper_width",
)


def receipt_settings(tenant):
    profile = tenant.seller_profile
    return {
        "version": 1,
        "store_name": tenant.name,
        "store_address": tenant.address,
        "store_code": tenant.public_code,
        "seller_name": profile.official_name if profile else "",
        "seller_tax_identifier": profile.tax_identifier if profile else "",
        "receipt_header": tenant.receipt_header,
        "receipt_footer": tenant.receipt_footer,
        "receipt_phone": tenant.receipt_phone,
        **{
            field: f"{value:.2f}" if field.endswith("_rate") else value
            for field in RECEIPT_SETTING_FIELDS
            for value in [getattr(tenant, field)]
        },
    }
