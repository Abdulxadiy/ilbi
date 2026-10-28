from django.apps import apps
from django.conf import settings
from django.db.models import F

from .models import TenantSyncRevision


def changed(sender, instance, raw=False, action=None, **kwargs):
    if raw or getattr(settings, "DESKTOP_MODE", False) or sender._meta.apps is not apps:
        return
    if action and action not in {"post_add", "post_remove", "post_clear"}:
        return
    if sender._meta.app_label not in {
        "catalog",
        "inventory",
        "sales",
        "cashbox",
        "tenants",
        "accounts",
        "permissions",
        "core",
    }:
        return
    tenant_ids = []
    if hasattr(instance, "tenant_id") and instance.tenant_id:
        tenant_ids = [instance.tenant_id]
    elif instance._meta.label_lower == "tenants.tenant":
        tenant_ids = [instance.pk]
    elif instance._meta.label_lower == "accounts.user":
        tenant_ids = list(instance.employments.values_list("tenant_id", flat=True))
    elif instance._meta.label_lower == "tenants.sellerprofile":
        tenant_ids = list(instance.tenants.values_list("pk", flat=True))
    elif instance._meta.label_lower in {"permissions.permission", "tenants.cbuexchangerate"}:
        tenant_ids = list(TenantSyncRevision.objects.values_list("tenant_id", flat=True))
    for tenant_id in set(tenant_ids):
        TenantSyncRevision.objects.get_or_create(tenant_id=tenant_id)
        TenantSyncRevision.objects.filter(tenant_id=tenant_id).update(revision=F("revision") + 1)


def revision_for(tenant_id):
    return TenantSyncRevision.objects.filter(tenant_id=tenant_id).values_list("revision", flat=True).first() or 0
