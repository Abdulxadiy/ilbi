"""Same-currency owner adjustments and bounded customer-credit refunds."""

import json
import os
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

import pytest
from django.db import DatabaseError
from rest_framework.test import APIClient

from apps.cashbox.services.cashbox_service import CashboxService
from apps.sales.models import Counterparty, DebtPayment
from apps.sales.services.debt_adjustment_service import DebtAdjustmentService
from apps.sales.services.debt_service import DebtServiceError
from tests.factories import CounterpartyFactory, EmployeeFactory, OwnerFactory, StaffFactory, TenantFactory

pytestmark = pytest.mark.django_db


def client_for(user, tenant):
    client = APIClient()
    client.force_authenticate(user=user)
    client.credentials(HTTP_X_TENANT_ID=str(tenant.pk))
    return client


def test_legacy_usd_credit_correction_changes_usd_only(owner, tenant):
    tenant.usd_rate = Decimal("13000.00")
    tenant.save(update_fields=["usd_rate"])
    cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs="0.00", debt_balance_usd="-10.00")
    response = client_for(owner, tenant).post(
        f"/api/v1/sales/counterparties/{cp.pk}/payments/correct/",
        {
            "amount": "-3.00",
            "currency": "USD",
            "payment_type": "cash",
            "idempotency_key": "legacy-usd-refund",
            "note": "Customer credit refund",
        },
        format="json",
    )
    assert response.status_code == 201
    cp.refresh_from_db()
    assert cp.debt_balance_usd == Decimal("-7.00")
    assert cp.debt_balance_uzs == Decimal("0.00")
    assert response.data["exchange_rate"] is None


def body(**kwargs):
    return {
        "kind": "credit_refund",
        "amount": "3.00",
        "currency": "USD",
        "payment_type": "cash",
        "note": "Partial customer credit refund",
        **kwargs,
    }


def quote(client, cp, payload):
    response = client.post(
        f"/api/v1/sales/counterparties/{cp.pk}/payments/adjustment-quote/",
        payload,
        format="json",
    )
    assert response.status_code == 200, response.data
    assert response["Cache-Control"] == "no-store"
    return response.data


def commit(client, cp, payload, expected_quote, key="original-adjustment-key"):
    return client.post(
        f"/api/v1/sales/counterparties/{cp.pk}/payments/adjust/",
        {
            **payload,
            "expected_quote": expected_quote,
            "idempotency_key": key,
        },
        format="json",
    )


def test_credit_quote_is_read_only_and_usd_partial_refund_replay_is_exact(owner, tenant):
    cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs="100.00", debt_balance_usd="-10.00")
    client = client_for(owner, tenant)
    payload = body()
    computed = quote(client, cp, payload)
    assert computed["protocol"] == DebtAdjustmentService.PROTOCOL
    assert computed["payment_amount"] == "-3.00" and computed["available_credit"] == "10.00"
    assert computed["remaining"] == {"UZS": "100.00", "USD": "-7.00"}
    cp.refresh_from_db()
    assert cp.debt_balance_usd == Decimal("-10.00") and not cp.payments.exists()
    first = commit(client, cp, payload, computed["expected_quote"])
    repeated = commit(client, cp, payload, computed["expected_quote"])
    assert first.status_code == repeated.status_code == 201
    assert first.data == repeated.data
    assert first.data["amount"] == "-3.00" and first.data["is_correction"] is True
    assert first.data["adjustment_operation"]["idempotency_key"] == "original-adjustment-key"
    assert first.data["adjustment_operation"]["actor_id"] == owner.pk
    assert first.data["adjustment_operation"]["tenant_id"] == tenant.pk
    cp.refresh_from_db()
    assert cp.debt_balance_usd == Decimal("-7.00") and cp.debt_balance_uzs == Decimal("100.00")
    assert cp.payments.count() == 1
    assert CashboxService.get_current_shift_status(tenant)["collected_debt_cash_usd"] == Decimal("-3.00")
    target = os.environ.get("ILBI_MOBILE_ADJUSTMENT_CONTRACT")
    if target:
        Path(target).write_text(
            json.dumps(
                {
                    "source": (
                        "Actual isolated PostgreSQL/API credit refund; USD-10→-7, UZS100 unchanged, replay once"
                    ),
                    "customer": cp.pk,
                    "actor": owner.pk,
                    "tenant": tenant.pk,
                    "payload": payload,
                    "quote": computed,
                    "result": first.json(),
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n"
        )


@pytest.mark.parametrize("currency,channel", [("UZS", "cash"), ("UZS", "card"), ("USD", "card")])
def test_refund_uses_selected_credit_currency_and_channel(owner, tenant, currency, channel):
    cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs="-10.00", debt_balance_usd="-10.00")
    client = client_for(owner, tenant)
    payload = body(currency=currency, payment_type=channel, amount="10.00")
    computed = quote(client, cp, payload)
    result = commit(client, cp, payload, computed["expected_quote"])
    assert result.status_code == 201 and result.data["payment_type"] == channel
    cp.refresh_from_db()
    assert getattr(cp, "debt_balance_" + currency.lower()) == Decimal("0.00")
    other = "usd" if currency == "UZS" else "uzs"
    assert getattr(cp, "debt_balance_" + other) == Decimal("-10.00")
    assert result.data["exchange_rate"] is None and result.data["converted_amount_uzs"] is None


@pytest.mark.parametrize(
    "changes",
    [{"amount": "11"}, {"amount": "-1"}, {"amount": "0"}, {"payment_type": "none"}, {"currency": "EUR"}, {"note": ""}],
)
def test_invalid_or_excess_refund_has_no_side_effects(owner, tenant, changes):
    cp = CounterpartyFactory(tenant=tenant, debt_balance_usd="-10.00")
    response = client_for(owner, tenant).post(
        f"/api/v1/sales/counterparties/{cp.pk}/payments/adjustment-quote/",
        body(**changes),
        format="json",
    )
    assert response.status_code == 400
    cp.refresh_from_db()
    assert cp.debt_balance_usd == Decimal("-10.00") and not cp.payments.exists()


@pytest.mark.parametrize("amount", ["3.00", "6.00"])
def test_stale_quote_and_changed_original_key_payload_cannot_double_refund(owner, tenant, amount):
    cp = CounterpartyFactory(tenant=tenant, debt_balance_usd="-10.00")
    client = client_for(owner, tenant)
    payload = body(amount=amount)
    computed = quote(client, cp, payload)
    assert commit(client, cp, payload, computed["expected_quote"], "first-key").status_code == 201
    assert commit(client, cp, payload, computed["expected_quote"], "second-key").status_code == 400
    assert commit(client, cp, body(amount="1.00"), computed["expected_quote"], "first-key").status_code == 400
    assert commit(client, cp, body(note="Changed reason"), computed["expected_quote"], "first-key").status_code == 400
    cp.refresh_from_db()
    assert cp.debt_balance_usd == Decimal("-10.00") + Decimal(amount) and cp.payments.count() == 1


def test_refund_replay_succeeds_after_credit_exhaustion_and_shift_close(owner, tenant):
    from django.utils import timezone

    from apps.cashbox.models import CashShift

    cp = CounterpartyFactory(tenant=tenant, debt_balance_usd="-3.00")
    client = client_for(owner, tenant)
    payload = body()
    computed = quote(client, cp, payload)
    first = commit(client, cp, payload, computed["expected_quote"])
    assert first.status_code == 201
    CashShift.objects.filter(tenant=tenant, closed_at__isnull=True).update(closed_at=timezone.now())
    replay = commit(client, cp, payload, computed["expected_quote"])
    assert replay.status_code == 201 and replay.data == first.data
    assert cp.payments.count() == 1


def test_replay_after_zero_balance_archive_keeps_receipt_but_new_adjustment_is_denied(owner, tenant):
    cp = CounterpartyFactory(tenant=tenant, debt_balance_usd="-3.00")
    client = client_for(owner, tenant)
    computed = quote(client, cp, body())
    first = commit(client, cp, body(), computed["expected_quote"])
    assert first.status_code == 201
    assert client.delete(f"/api/v1/sales/counterparties/{cp.pk}/").status_code == 200
    replay = commit(client, cp, body(), computed["expected_quote"])
    assert replay.status_code == 201 and replay.data == first.data
    new = commit(client, cp, body(), computed["expected_quote"], "new-archived-request")
    assert new.status_code == 400
    assert cp.payments.count() == 1


def test_new_cash_adjustment_requires_open_shift_and_rolls_back_on_closed_shift(owner, tenant):
    from django.utils import timezone

    from apps.cashbox.models import CashShift

    cp = CounterpartyFactory(tenant=tenant, debt_balance_usd="-10.00")
    client = client_for(owner, tenant)
    computed = quote(client, cp, body())
    CashShift.objects.filter(tenant=tenant, closed_at__isnull=True).update(closed_at=timezone.now())
    result = commit(client, cp, body(), computed["expected_quote"])
    assert result.status_code == 400
    cp.refresh_from_db()
    assert cp.debt_balance_usd == Decimal("-10.00") and not cp.payments.exists()


def test_quote_is_bound_to_reason_store_actor_and_action_kind(owner, tenant):
    cp = CounterpartyFactory(tenant=tenant, debt_balance_usd="-10.00")
    client = client_for(owner, tenant)
    computed = quote(client, cp, body())
    assert commit(client, cp, body(kind="correction"), computed["expected_quote"]).status_code == 400
    assert commit(client, cp, body(note="Different reason"), computed["expected_quote"]).status_code == 400
    other = TenantFactory(owner=owner)
    EmployeeFactory(user=owner, tenant=other, is_owner=True)
    assert commit(client, cp, body(branch_id=other.pk), computed["expected_quote"]).status_code == 400
    assert not cp.payments.exists()


def test_unauthorized_or_foreign_branch_cannot_quote_or_commit(owner, tenant):
    cp = CounterpartyFactory(tenant=tenant, debt_balance_usd="-10.00")
    staff = StaffFactory()
    EmployeeFactory(user=staff, tenant=tenant)
    path = f"/api/v1/sales/counterparties/{cp.pk}/payments/"
    assert client_for(staff, tenant).post(path + "adjustment-quote/", body(), format="json").status_code == 403
    client = client_for(owner, tenant)
    foreign = TenantFactory()
    assert client.post(path + "adjustment-quote/", body(branch_id=foreign.pk), format="json").status_code == 404
    assert not cp.payments.exists()


@pytest.mark.parametrize("amount,expected", [("5.00", "95.00"), ("-5.00", "105.00")])
def test_bookkeeping_correction_changes_selected_balance_without_cash_shift(owner, tenant, amount, expected):
    cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs="100.00", debt_balance_usd="2.00")
    client = client_for(owner, tenant)
    payload = body(kind="correction", currency="UZS", amount=amount, payment_type="none")
    computed = quote(client, cp, payload)
    with patch.object(CashboxService, "lock_open_shift", side_effect=AssertionError("No cash movement")):
        response = commit(client, cp, payload, computed["expected_quote"])
    assert response.status_code == 201
    assert DebtPayment.objects.get(pk=response.data["id"]).shift_id is None
    cp.refresh_from_db()
    assert cp.debt_balance_uzs == Decimal(expected) and cp.debt_balance_usd == Decimal("2.00")


def test_failed_key_persistence_rolls_back_balance_and_payment(owner, tenant):
    cp = CounterpartyFactory(tenant=tenant, debt_balance_usd="-10.00")
    payload = {
        "counterparty": cp,
        "actor": owner,
        "branch": tenant,
        "kind": "credit_refund",
        "amount": Decimal("3.00"),
        "currency": "USD",
        "payment_type": "cash",
        "note": "Rollback proof",
    }
    computed = DebtAdjustmentService.quote(**payload)
    original = DebtPayment.save

    def fail_on_key(self, *args, **kwargs):
        if kwargs.get("update_fields") == ["idempotency_key", "request_fingerprint"]:
            raise DatabaseError("Synthetic key persistence failure")
        return original(self, *args, **kwargs)

    with patch.object(DebtPayment, "save", fail_on_key), pytest.raises(DatabaseError):
        DebtAdjustmentService.commit(
            **payload, idempotency_key="rollback-key", expected_quote=computed["expected_quote"]
        )
    cp.refresh_from_db()
    assert cp.debt_balance_usd == Decimal("-10.00") and not cp.payments.exists()


@pytest.mark.parametrize("amount", ["NaN", "Infinity", "0.001", "1000000000000.00"])
def test_service_rejects_unrepresentable_money_before_writing(owner, tenant, amount):
    cp = CounterpartyFactory(tenant=tenant, debt_balance_usd="-10.00")
    with pytest.raises(DebtServiceError):
        DebtAdjustmentService.quote(
            counterparty=cp,
            actor=owner,
            kind="correction",
            amount=Decimal(amount),
            currency="USD",
            payment_type="none",
            note="Invalid value",
        )
    assert not cp.payments.exists()


def test_old_quote_cannot_cross_ownership_transfer_or_be_adopted_by_new_actor(owner, tenant):
    cp = CounterpartyFactory(tenant=tenant, debt_balance_usd="-10.00")
    computed = quote(client_for(owner, tenant), cp, body())
    new_owner = OwnerFactory()
    tenant.owner = new_owner
    tenant.save(update_fields=["owner"])
    owner.employments.filter(tenant=tenant).update(is_active=False)
    EmployeeFactory(user=new_owner, tenant=tenant, is_owner=True)
    assert commit(client_for(owner, tenant), cp, body(), computed["expected_quote"]).status_code == 403
    assert commit(client_for(new_owner, tenant), cp, body(), computed["expected_quote"]).status_code == 400
    assert not cp.payments.exists()


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("same_key", [False, True])
def test_concurrent_refunds_from_one_quote_are_once_only(owner, tenant, same_key, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor

    from celery.app.task import Task
    from django.contrib.auth import get_user_model
    from django.db import close_old_connections, connections

    from apps.tenants.models import Tenant

    monkeypatch.setattr(Task, "apply_async", lambda *args, **kwargs: None)
    cp = CounterpartyFactory(tenant=tenant, debt_balance_usd="-10.00")
    computed = quote(client_for(owner, tenant), cp, body())
    actor_id, tenant_id, cp_id = owner.pk, tenant.pk, cp.pk

    def refund(key):
        close_old_connections()
        try:
            actor = get_user_model().objects.get(pk=actor_id)
            shop = Tenant.objects.get(pk=tenant_id)
            customer = Counterparty.objects.get(pk=cp_id)
            return commit(client_for(actor, shop), customer, body(), computed["expected_quote"], key).status_code
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(refund, ["device-one", "device-one" if same_key else "device-two"]))
    assert sorted(statuses) == ([201, 201] if same_key else [201, 400])
    cp.refresh_from_db()
    assert cp.debt_balance_usd == Decimal("-7.00") and cp.payments.count() == 1
