"""Human-readable, immutable catalog snapshots captured with the mutation."""

from apps.catalog.models import Product, ProductVariant
from apps.core.models import AuditAction
from apps.core.services.audit_service import AuditService


def catalog_snapshot(obj, *, variant_id=None):
    if obj is None:
        return {}
    fields = (
        "name",
        "kod",
        "unit",
        "code",
        "barcode",
        "mxik",
        "package_code",
        "is_active",
        "price_partner",
        "price_min",
        "price_recommended",
    )
    snapshot = {field: getattr(obj, field) for field in fields if hasattr(obj, field)}
    if hasattr(obj, "currency"):
        snapshot["currency"] = obj.currency
    if isinstance(obj, Product):
        snapshot["category"] = obj.category.name
        snapshot["image_count"] = obj.gallery_images.count()
        variant = obj.variants.filter(pk=variant_id).first() if variant_id else obj.variants.order_by("pk").first()
        if variant:
            snapshot.update({f"variant_{key}": value for key, value in catalog_snapshot(variant).items()})
    if isinstance(obj, ProductVariant):
        snapshot["product"] = obj.product.name
    if hasattr(obj, "parent"):
        snapshot["parent"] = obj.parent.name if obj.parent_id else ""
    if hasattr(obj, "image"):
        snapshot["image"] = str(obj.image or "")
    return {
        key: value if isinstance(value, (str, bool, int)) or value is None else str(value)
        for key, value in snapshot.items()
    }


def record_catalog_activity(*, request, tenant, model_name, target_id, before, after):
    path = request.path.rstrip("/")
    if not before:
        action, changes = AuditAction.CATALOG_CREATE, {"snapshot": after}
    elif not after:
        action, changes = AuditAction.CATALOG_DELETE, {"snapshot": before}
    else:
        changes = {
            key: {"old": before.get(key), "new": value} for key, value in after.items() if before.get(key) != value
        }
        # Price edits already have their own PRICE_CHANGE entries.
        if request.method == "PATCH":
            changes = {key: value for key, value in changes.items() if "price_" not in key}
        if not changes:
            return
        action = AuditAction.CATALOG_UPDATE
        if path.endswith("/unarchive"):
            action = AuditAction.CATALOG_RESTORE
        elif before.get("is_active") and not after.get("is_active"):
            action = AuditAction.CATALOG_ARCHIVE
    snapshot = after or before
    name = snapshot.get("name", "")
    if model_name == "ProductVariant":
        name = f"{snapshot.get('product', '')} · {name}"
    AuditService.log(
        action=action,
        actor=request.user,
        tenant=tenant,
        target_model=model_name,
        target_id=str(target_id),
        changes=changes,
        description=name,
        request=request,
    )
