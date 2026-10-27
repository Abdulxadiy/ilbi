"""Additive keyed API operations; old web callers keep the original service contract."""

import hashlib
import json

from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from rest_framework.exceptions import ValidationError

from apps.cashbox.models import CashboxMutationReceipt, CashShift, DailyCashReport
from apps.cashbox.services.cashbox_service import CashboxService
from apps.tenants.models import Tenant


def perform_cashbox_mutation(*, tenant, actor, key, kind, payload, action):
    if key is None:
        return action()
    normalized = json.dumps(payload, cls=DjangoJSONEncoder, sort_keys=True, separators=(",", ":"))
    fingerprint = hashlib.sha256(normalized.encode()).hexdigest()
    with transaction.atomic():
        # Same lock order as all existing cash writers: tenant before shift.
        Tenant.objects.select_for_update().get(pk=tenant.pk)
        previous = CashboxMutationReceipt.objects.filter(tenant=tenant, idempotency_key=key).first()
        if previous:
            if previous.actor_id != actor.pk or previous.kind != kind or previous.fingerprint != fingerprint:
                raise ValidationError(
                    {"idempotency_key": "Bu kalit boshqa kassa amaliga tegishli. Avvalgi natijani tekshiring."}
                )
            return previous.result
        if kind == "open":
            if "expected_report_id" not in payload:
                raise ValidationError({"expected_report_id": "Kassa holatini yangilang."})
            last = DailyCashReport.objects.filter(tenant=tenant).order_by("-closed_at", "-pk").first()
            if payload["expected_report_id"] != (last.pk if last else None):
                raise ValidationError({"expected_report_id": "Oxirgi smena o‘zgargan. Kassa holatini yangilang."})
        elif kind in {"income", "expense"}:
            current = CashShift.objects.filter(tenant=tenant, closed_at__isnull=True).first()
            if not current or payload.get("expected_shift_id") != current.pk:
                raise ValidationError({"expected_shift_id": "Smena o‘zgargan yoki yopilgan. Kassa holatini yangilang."})
        elif kind == "close":
            if not payload.get("shift_id"):
                raise ValidationError({"shift_id": "Yopiladigan smenani tanlang."})
            snapshot = CashboxService.get_current_shift_status(tenant, include_entries=False)
            if not snapshot["is_open"] or snapshot["shift_id"] != payload["shift_id"]:
                raise ValidationError({"shift_id": "Smena o‘zgargan yoki yopilgan. Kassa holatini yangilang."})
            mismatches = {
                field: "Kassa yig‘indisi o‘zgardi. Holatni yangilab, sanalgan pulni qayta tasdiqlang."
                for field in ("expected_cash_uzs", "expected_cash_usd")
                if field not in payload or payload[field] != snapshot[field]
            }
            if mismatches:
                raise ValidationError(mismatches)
        else:
            raise ValidationError("Kassa amali qo‘llab-quvvatlanmaydi.")
        # A serialization/storage failure must roll back the financial action too.
        result = json.loads(json.dumps(action(), cls=DjangoJSONEncoder))
        result["cashbox_operation"] = {
            "idempotency_key": str(key),
            "kind": kind,
            "actor_id": actor.pk,
            "tenant_id": tenant.pk,
        }
        if kind == "open":
            result["id"] = result["shift_id"]
        CashboxMutationReceipt.objects.create(
            tenant=tenant, actor=actor, idempotency_key=key, kind=kind, fingerprint=fingerprint, result=result
        )
        return result
