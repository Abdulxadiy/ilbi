"""Versioned command protocol. Local and cloud runtimes use the same business APIs."""

import hashlib
import json
import re
from contextlib import contextmanager
from contextvars import ContextVar

from django.apps import apps
from django.core.serializers.json import DjangoJSONEncoder
from django.db.models.fields.files import FieldFile
from django.db.models.signals import post_delete, post_save, pre_delete, pre_save

from apps.core.event_clock import event_time

PROTOCOL = 1
LOCAL_ID_START = 1_000_000_000_000
DOMAIN_APPS = {"catalog", "inventory", "sales", "cashbox", "tenants", "accounts", "core"}
capture = ContextVar("desktop_sync_capture", default=None)
replaying = ContextVar("desktop_sync_replaying", default=False)
receipt_hint = ContextVar("desktop_sync_receipt", default=None)

# Explicit allow-list: account/security, cross-store settlement, external providers
# and privileged platform actions are never replayed as arbitrary HTTP requests.
ROUTES = [
    (r"workspace/reminders/(?:\d+/)?", {"POST", "PATCH", "DELETE"}),
    (r"catalog/categories/(?:\d+/(?:archive/)?)?", {"POST", "PATCH", "DELETE"}),
    (r"catalog/products/(?:\d+/(?:archive/|unarchive/)?)?", {"POST", "PATCH", "DELETE"}),
    (r"catalog/products/\d+/variants/", {"POST"}),
    (r"catalog/products/\d+/images/(?:\d+/)?", {"POST", "DELETE"}),
    (r"catalog/import/(?:preview/|\d+/commit/)", {"POST"}),
    (r"sales/counterparties/import/(?:preview/|\d+/commit/)", {"POST"}),
    (r"catalog/variants/(?:\d+/(?:archive/|unarchive/|barcode/)?)?", {"POST", "PATCH", "DELETE"}),
    (r"sales/", {"POST"}),
    (r"sales/\d+/void/", {"POST"}),
    (r"sales/items/\d+/void/", {"POST"}),
    (r"sales/counterparties/(?:\d+/)?", {"POST", "PATCH", "DELETE"}),
    (r"sales/counterparties/\d+/payments/(?:correct/)?", {"POST"}),
    (r"sales/notifications/(?:\d+/read/|read-all/)", {"POST", "PATCH"}),
    (r"cashbox/(?:expenses/|income/|shift/open/|shift/close/)", {"POST"}),
    (r"inventory/(?:intake/|intake/batch/|adjust/|customer-return/|supplier-return/|write-off/)", {"POST"}),
]


def allowed(method, path):
    return any(method in methods and re.fullmatch(pattern, path) for pattern, methods in ROUTES)


def reference_ids(value):
    found, pending = set(), [value]
    while pending:
        item = pending.pop()
        if isinstance(item, dict):
            pending.extend(item.values())
        elif isinstance(item, (list, tuple)):
            pending.extend(item)
        elif type(item) is int and item >= LOCAL_ID_START:
            found.add(item)
        elif isinstance(item, str) and item.isdecimal() and int(item) >= LOCAL_ID_START:
            found.add(int(item))
    return found


def digest(value):
    return hashlib.sha256(
        json.dumps(value, cls=DjangoJSONEncoder, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def json_value(value):
    class Encoder(DjangoJSONEncoder):
        def default(self, obj):
            if isinstance(obj, FieldFile):
                return str(obj)
            return super().default(obj)

    return json.loads(json.dumps(value, cls=Encoder))


def state(instance):
    return json_value({f.attname: f.value_from_object(instance) for f in instance._meta.fields})


def tracked(sender):
    return sender._meta.app_label in DOMAIN_APPS and sender._meta.model_name not in {"notification", "auditlog"}


def protect_replacement(instance, field):
    """An explicit replacement must also guard an unchanged local value."""
    ctx = capture.get()
    if ctx is not None and instance.pk:
        key = f'{instance._meta.label_lower}:{instance.pk}'
        ctx.setdefault('protected', {}).setdefault(key, {}).setdefault(field, json_value(getattr(instance, field)))


def before_save(sender, instance, raw=False, **kwargs):
    ctx = capture.get()
    if raw or ctx is None or not tracked(sender):
        return
    if instance._state.adding and event_time.get() and hasattr(instance, "opened_at"):
        instance.opened_at = event_time.get()
    if instance._state.adding and sender._meta.label_lower == "sales.sale" and receipt_hint.get():
        instance.public_token = receipt_hint.get()["public_token"]
    key = f"{sender._meta.label_lower}:{instance.pk}"
    if instance.pk and key not in ctx["before"]:
        old = sender.objects.filter(pk=instance.pk).first()
        if old is not None:
            ctx["before"][key] = state(old)


def after_save(sender, instance, created, raw=False, **kwargs):
    ctx = capture.get()
    if raw or ctx is None or not tracked(sender):
        return
    key = f"{sender._meta.label_lower}:{instance.pk}"
    ctx["resources"].add(key)
    # FK reads create dependencies even when their row wasn't updated by this command.
    for field in sender._meta.fields:
        if field.is_relation and getattr(instance, field.attname, None):
            ctx["references"].add(f"{field.remote_field.model._meta.label_lower}:{getattr(instance, field.attname)}")
            if field.remote_field.model._meta.label_lower == "cashbox.cashshift":
                ctx["resources"].add(f"cashbox.cashshift:{getattr(instance, field.attname)}")
    if created:
        row = {"model": sender._meta.label_lower, "id": instance.pk, "fields": state(instance)}
        ctx["created"].append(row)
        ctx["created_index"][key] = row
    elif key in ctx["created_index"]:
        # Financial services often create a zero-total header then save its
        # calculated totals. Replay validation needs the final committed values.
        ctx["created_index"][key]["fields"] = state(instance)


def after_delete(sender, instance, **kwargs):
    ctx = capture.get()
    if ctx is not None and tracked(sender):
        ctx["resources"].add(f"{sender._meta.label_lower}:{instance.pk}")


@contextmanager
def record_changes():
    ctx = {"before": {}, "created": [], "created_index": {}, "resources": set(), "references": set()}
    token = capture.set(ctx)
    pre_save.connect(before_save, weak=False, dispatch_uid="desktop-before")
    pre_delete.connect(before_save, weak=False, dispatch_uid="desktop-before-delete")
    post_save.connect(after_save, weak=False, dispatch_uid="desktop-after")
    post_delete.connect(after_delete, weak=False, dispatch_uid="desktop-delete")
    try:
        yield ctx
    finally:
        capture.reset(token)


def preconditions(ctx):
    """Protect replacements; financial balances are recomputed by domain services."""
    result = []
    excluded = {"id", "updated_at", "created_at"}
    for key, previous in ctx["before"].items():
        label, pk = key.split(":")
        if key in ctx["created_index"]:
            continue
        if label not in {
            "catalog.category",
            "catalog.product",
            "catalog.productvariant",
            "sales.counterparty",
            "core.workspacereminder",
        }:
            continue
        current = apps.get_model(label).objects.filter(pk=pk).first()
        if current is None:
            fields = {
                k: v for k, v in previous.items() if k not in excluded and not k.startswith(("debt_", "last_notified_"))
            }
        else:
            now = state(current)
            fields = {
                k: v
                for k, v in previous.items()
                if k not in excluded and now.get(k) != v and not k.startswith(("debt_", "last_notified_"))
            }
        fields.update(ctx.get('protected', {}).get(key, {}))
        if fields:
            result.append({"model": label, "id": int(pk), "fields": fields})
    return result


def title_for(path, method, body=None, response=None):
    body = body or {}
    result = response if isinstance(response, dict) else response[0] if isinstance(response, list) and response else {}
    if path == "sales/":
        return ("Savdo — " + str(result.get("receipt_number", "yangi chek")))[:200]
    if path.startswith("workspace/reminders/"):
        return ("Ish stoli eslatmasi — " + str(body.get("title") or result.get("title") or "yangilash"))[:200]
    if "/payments/" in path:
        return "Qarz to‘lovi"
    if path.startswith("cashbox/shift/open"):
        return "Smenani ochish"
    if path.startswith("cashbox/shift/close"):
        return "Smenani yopish"
    for prefix, title in [
        ("cashbox/expenses", "Kassa chiqimi"),
        ("cashbox/income", "Kassa kirimi"),
        ("sales/counterparties", "Mijoz ma’lumoti"),
        ("catalog/", "Katalog o‘zgarishi"),
        ("inventory/", "Ombor operatsiyasi"),
    ]:
        if path.startswith(prefix):
            name = body.get("name") or result.get("name") or body.get("source") or body.get("category")
            return (f"{title} — {name}" if name else title)[:200]
    return "Ma’lumotni yangilash"
