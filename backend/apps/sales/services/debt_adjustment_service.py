"""Owner-approved same-currency adjustments with quote-bound, once-only writes."""

import hashlib
import json
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils.crypto import constant_time_compare, salted_hmac

from apps.accounts.services.permission_service import PermissionService
from apps.sales.models import Counterparty, DebtPayment
from apps.tenants.models import Tenant

from .debt_service import DebtService, DebtServiceError


class DebtAdjustmentService:
    PROTOCOL = "ilbi-debt-adjustment-quote-v1"
    MAX_MONEY = Decimal("999999999999.99")

    @classmethod
    def _validate(cls, *, kind, amount, currency, payment_type, note):
        if kind not in ("credit_refund", "correction") or currency not in ("UZS", "USD"):
            raise DebtServiceError("Tuzatish turi yoki valyutasi noto‘g‘ri.")
        try:
            if (
                not amount.is_finite()
                or amount == 0
                or abs(amount) > cls.MAX_MONEY
                or amount != amount.quantize(Decimal("0.01"))
            ):
                raise DebtServiceError("Summani ikki kasr xonasigacha to‘g‘ri kiriting.")
        except (AttributeError, InvalidOperation) as exc:
            raise DebtServiceError("Summani to‘g‘ri kiriting.") from exc
        if kind == "credit_refund" and (amount <= 0 or payment_type not in ("cash", "card")):
            raise DebtServiceError("Mijoz haqqi musbat summada naqd yoki kartaga qaytariladi.")
        if payment_type not in ("cash", "card", "none"):
            raise DebtServiceError("Tuzatish to‘lov turi noto‘g‘ri.")
        if not isinstance(note, str) or not note.strip() or len(note.strip()) > 2000:
            raise DebtServiceError("Tuzatish sababini kiriting (2000 belgigacha).")

    @staticmethod
    def _locked(counterparty, actor, branch, *, allow_archived=False):
        target = branch or counterparty.tenant
        # Lock both stores in a stable order before the customer. This also
        # rechecks ownership after a concurrent transfer/deactivation.
        tenants = {
            row.pk: row
            for row in Tenant.objects.select_for_update()
            .filter(
                pk__in={counterparty.tenant_id, target.pk},
            )
            .order_by("pk")
        }
        source, target = tenants[counterparty.tenant_id], tenants[target.pk]
        if not actor.is_active or actor.role != "platform_admin" and source.owner_id != actor.pk:
            raise DebtServiceError("Tuzatish uchun amaldagi do‘kon egasi vakolati talab qilinadi.")
        for tenant in (source, target):
            if not PermissionService.has_permission(actor, "sales.correct_debt_payment", tenant=tenant):
                raise DebtServiceError("Tuzatish uchun do‘kon egasi vakolati talab qilinadi.")
        cp = Counterparty.objects.select_for_update().get(pk=counterparty.pk)
        if cp.tenant_id != source.pk:
            raise DebtServiceError("Mijoz do‘koni o‘zgargan.")
        cp.tenant = source
        if (
            (not cp.is_active and not allow_archived)
            or not source.is_active
            or not target.is_active
            or target.owner_id != source.owner_id
        ):
            raise DebtServiceError("Mijoz va shu egaga tegishli qaytaruvchi do‘kon faol bo‘lishi kerak.")
        return cp, target

    @classmethod
    def _quote(cls, *, cp, branch, actor, kind, amount, currency, payment_type, note):
        signed = -amount if kind == "credit_refund" else amount
        balance = cp.debt_balance_uzs if currency == "UZS" else cp.debt_balance_usd
        credit = max(-balance, Decimal("0"))
        if kind == "credit_refund" and amount > credit:
            raise DebtServiceError("Qaytarish summasi shu valyutadagi mijoz haqqidan oshadi.")
        allocation = DebtService._correction_allocation(cp, signed, currency)
        result = {
            "protocol": cls.PROTOCOL,
            "actor_id": actor.pk,
            "tenant_id": cp.tenant_id,
            "counterparty_id": cp.pk,
            "branch_id": branch.pk,
            "kind": kind,
            "amount": f"{amount:.2f}",
            "payment_amount": f"{signed:.2f}",
            "currency": currency,
            "payment_type": payment_type,
            "note": note.strip(),
            "available_credit": f"{credit:.2f}",
            "balances": {"UZS": f"{cp.debt_balance_uzs:.2f}", "USD": f"{cp.debt_balance_usd:.2f}"},
            "remaining": {"UZS": f"{allocation['uzs']:.2f}", "USD": f"{allocation['usd']:.2f}"},
        }
        result["expected_quote"] = salted_hmac(
            "ilbi.debt-adjustment.v1",
            json.dumps(result, sort_keys=True, separators=(",", ":")),
            algorithm="sha256",
        ).hexdigest()
        return result

    @classmethod
    @transaction.atomic
    def quote(cls, *, counterparty, actor, kind, amount, currency, payment_type, note, branch=None):
        cls._validate(kind=kind, amount=amount, currency=currency, payment_type=payment_type, note=note)
        cp, target = cls._locked(counterparty, actor, branch)
        return cls._quote(
            cp=cp,
            branch=target,
            actor=actor,
            kind=kind,
            amount=amount,
            currency=currency,
            payment_type=payment_type,
            note=note,
        )

    @classmethod
    @transaction.atomic
    def commit(
        cls,
        *,
        counterparty,
        actor,
        kind,
        amount,
        currency,
        payment_type,
        note,
        idempotency_key,
        expected_quote,
        branch=None,
    ):
        cls._validate(kind=kind, amount=amount, currency=currency, payment_type=payment_type, note=note)
        if not isinstance(idempotency_key, str) or not idempotency_key.strip() or len(idempotency_key) > 64:
            raise DebtServiceError("Tuzatishning asl qayta so‘rash kaliti kerak.")
        if not isinstance(expected_quote, str) or len(expected_quote) != 64:
            raise DebtServiceError("Avval tuzatish hisobini tekshiring.")
        cp, target = cls._locked(counterparty, actor, branch, allow_archived=True)
        identity = {
            "protocol": cls.PROTOCOL,
            "actor": actor.pk,
            "tenant": cp.tenant_id,
            "customer": cp.pk,
            "branch": target.pk,
            "kind": kind,
            "amount": f"{amount:.2f}",
            "currency": currency,
            "payment_type": payment_type,
            "note": note.strip(),
            "expected_quote": expected_quote,
        }
        fingerprint = hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        payment = DebtPayment.objects.filter(counterparty=cp, idempotency_key=idempotency_key).first()
        if payment:
            if payment.recorded_by_id != actor.pk or not constant_time_compare(
                payment.request_fingerprint, fingerprint
            ):
                raise DebtServiceError("Asl kalit boshqa tuzatish uchun ishlatilgan.")
        else:
            if not cp.is_active:
                raise DebtServiceError("Arxivlangan mijozga yangi tuzatish yuborilmaydi.")
            quote = cls._quote(
                cp=cp,
                branch=target,
                actor=actor,
                kind=kind,
                amount=amount,
                currency=currency,
                payment_type=payment_type,
                note=note,
            )
            if not constant_time_compare(quote["expected_quote"], expected_quote):
                raise DebtServiceError("Mijoz balansi yoki tuzatish hisobi o‘zgardi. Hisobni qayta tekshiring.")
            # This outer atomic transaction keeps the balance, payment and key
            # invisible until all three persist. The locked customer serializes
            # legacy/new callers; failed key storage rolls the entire write back.
            payment = DebtService.record_payment(
                counterparty=cp,
                amount=-amount if kind == "credit_refund" else amount,
                currency=currency,
                recorded_by=actor,
                branch=target,
                is_correction=True,
                same_currency_correction=True,
                note=note.strip(),
                payment_type=payment_type,
            )
            payment.idempotency_key = idempotency_key
            payment.request_fingerprint = fingerprint
            payment.save(update_fields=["idempotency_key", "request_fingerprint"])
        payment._adjustment_operation = {
            "protocol": cls.PROTOCOL,
            "actor_id": payment.recorded_by_id,
            "tenant_id": cp.tenant_id,
            "counterparty_id": cp.pk,
            "branch_id": payment.branch_id,
            "kind": kind,
            "amount": f"{amount:.2f}",
            "currency": payment.currency,
            "payment_type": payment.payment_type,
            "idempotency_key": payment.idempotency_key,
            "expected_quote": expected_quote,
            "note": note.strip(),
        }
        return payment
