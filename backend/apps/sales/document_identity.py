"""Frozen document identity. Private parties must never enter the public receipt DTO."""
from apps.tenants.receipt_settings import RECEIPT_SETTING_FIELDS, receipt_settings

PUBLIC_RECEIPT_FIELDS = (
    "version", "store_name", "store_address", "store_code", "seller_name", "seller_tax_identifier",
    "receipt_header", "receipt_footer", "receipt_phone", *RECEIPT_SETTING_FIELDS,
)


def document_snapshot(tenant, user, counterparty):
    return {
        **receipt_settings(tenant),
        "document_parties": {
            "version": 1,
            "cashier_name": user.get_full_name(),
            "customer_name": counterparty.name if counterparty else None,
            "customer_phone": counterparty.phone_number if counterparty else None,
            "recipient_store_name": counterparty.target_tenant.name
            if counterparty and counterparty.target_tenant_id else None,
        },
    }


def document_party(sale, field, legacy):
    snapshot = sale.receipt_snapshot
    parties = snapshot.get("document_parties") if isinstance(snapshot, dict) else None
    if isinstance(parties, dict) and parties.get("version") == 1:
        value = parties.get(field)
        return value if isinstance(value, str) else None
    return legacy()


def document_store(sale, field, legacy):
    snapshot = sale.receipt_snapshot
    if isinstance(snapshot, dict) and snapshot.get("version") == 1:
        value = snapshot.get(field)
        return value if isinstance(value, str) else ""
    return legacy()


def public_receipt_snapshot(sale):
    snapshot = sale.receipt_snapshot
    if not isinstance(snapshot, dict):
        return {}
    return {key: snapshot[key] for key in PUBLIC_RECEIPT_FIELDS if key in snapshot}
