"""Real cash handlers/transactions in an isolated pytest database, never live cash."""

import uuid
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from unittest.mock import Mock, patch

import pytest
from django.db import close_old_connections
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from apps.cashbox.models import CashboxMutationReceipt, CashExpense, CashIncome, CashShift, DailyCashReport
from apps.cashbox.services.cashbox_service import CashboxService
from apps.cashbox.services.mutations import perform_cashbox_mutation
from tests.factories import OwnerFactory, TenantFactory

pytestmark = pytest.mark.django_db


def client_for(owner, tenant):
    client = APIClient()
    client.force_authenticate(owner)
    client.credentials(HTTP_X_TENANT_ID=str(tenant.pk))
    return client


def current_shift(tenant):
    return CashShift.objects.get(tenant=tenant, closed_at__isnull=True)


@pytest.mark.parametrize("kind,field", [("income", "source"), ("expense", "category")])
def test_keyed_cash_entry_replays_once_and_rejects_changed_payload(tenant, owner, kind, field):
    client = client_for(owner, tenant)
    body = {
        "amount": "12.50",
        "currency": "USD",
        field: "Synthetic mobile entry",
        "idempotency_key": str(uuid.uuid4()),
        "expected_shift_id": current_shift(tenant).pk,
    }
    first = client.post(f"/api/v1/cashbox/{kind if kind == 'income' else 'expenses'}/", body, format="json")
    again = client.post(f"/api/v1/cashbox/{kind if kind == 'income' else 'expenses'}/", body, format="json")
    assert first.status_code == again.status_code == 201
    assert first.data == again.data
    assert first.data["cashbox_operation"] == {
        "idempotency_key": body["idempotency_key"],
        "kind": kind,
        "actor_id": owner.pk,
        "tenant_id": tenant.pk,
    }
    model = CashIncome if kind == "income" else CashExpense
    assert model.objects.filter(tenant=tenant).count() == 1
    assert CashboxMutationReceipt.objects.filter(tenant=tenant).count() == 1
    changed = client.post(
        f"/api/v1/cashbox/{kind if kind == 'income' else 'expenses'}/", {**body, "amount": "99.00"}, format="json"
    )
    assert changed.status_code == 400
    assert model.objects.filter(tenant=tenant).count() == 1


def test_open_and_close_replay_bind_report_and_counted_cash(tenant, owner):
    client = client_for(owner, tenant)
    status = CashboxService.get_current_shift_status(tenant)
    close = {
        "idempotency_key": str(uuid.uuid4()),
        "shift_id": status["shift_id"],
        "actual_cash_uzs": str(status["expected_cash_uzs"]),
        "actual_cash_usd": str(status["expected_cash_usd"]),
        "expected_cash_uzs": str(status["expected_cash_uzs"]),
        "expected_cash_usd": str(status["expected_cash_usd"]),
        "staff_notes": "Synthetic close",
    }
    first = client.post("/api/v1/cashbox/shift/close/", close, format="json")
    replay = client.post("/api/v1/cashbox/shift/close/", close, format="json")
    assert first.status_code == replay.status_code == 201
    assert first.data == replay.data
    assert DailyCashReport.objects.filter(tenant=tenant).count() == 1
    opening = {
        "idempotency_key": str(uuid.uuid4()),
        "expected_report_id": first.data["id"],
        "opening_cash_uzs": "5.00",
        "opening_cash_usd": "1.00",
    }
    opened = client.post("/api/v1/cashbox/shift/open/", opening, format="json")
    opened_again = client.post("/api/v1/cashbox/shift/open/", opening, format="json")
    assert opened.status_code == opened_again.status_code == 201
    assert opened.data == opened_again.data
    assert opened.data["id"] == opened.data["shift_id"]
    assert CashShift.objects.filter(tenant=tenant, closed_at__isnull=True).count() == 1
    assert (
        client.post("/api/v1/cashbox/shift/open/", {**opening, "opening_cash_uzs": "6.00"}, format="json").status_code
        == 400
    )


def test_stale_shift_and_stale_opening_are_rejected_before_writing(tenant, owner):
    client = client_for(owner, tenant)
    body = {
        "amount": "8.00",
        "source": "Stale",
        "expected_shift_id": current_shift(tenant).pk + 10000,
        "idempotency_key": str(uuid.uuid4()),
    }
    assert client.post("/api/v1/cashbox/income/", body, format="json").status_code == 400
    assert not CashIncome.objects.filter(tenant=tenant).exists()
    status = CashboxService.get_current_shift_status(tenant)
    CashboxService.close_shift(
        tenant=tenant,
        user=owner,
        shift_id=status["shift_id"],
        actual_cash_uzs=status["expected_cash_uzs"],
        actual_cash_usd=status["expected_cash_usd"],
    )
    assert (
        client.post(
            "/api/v1/cashbox/shift/open/",
            {
                "opening_cash_uzs": "0",
                "opening_cash_usd": "0",
                "expected_report_id": None,
                "idempotency_key": str(uuid.uuid4()),
            },
            format="json",
        ).status_code
        == 400
    )
    assert not CashShift.objects.filter(tenant=tenant, closed_at__isnull=True).exists()


def test_cash_change_after_client_reread_requires_reconfirmation_under_tenant_lock(tenant, owner):
    client = client_for(owner, tenant)
    snapshot = CashboxService.get_current_shift_status(tenant)
    CashboxService.record_income(tenant=tenant, user=owner, amount=Decimal("9.00"), source="Concurrent cash arrival")
    body = {
        "idempotency_key": str(uuid.uuid4()),
        "shift_id": snapshot["shift_id"],
        "expected_cash_uzs": str(snapshot["expected_cash_uzs"]),
        "expected_cash_usd": str(snapshot["expected_cash_usd"]),
        "actual_cash_uzs": str(snapshot["expected_cash_uzs"]),
        "actual_cash_usd": "0.00",
    }
    rejected = client.post("/api/v1/cashbox/shift/close/", body, format="json")
    assert rejected.status_code == 400
    assert current_shift(tenant).pk == snapshot["shift_id"]
    assert not DailyCashReport.objects.filter(tenant=tenant).exists()
    assert not CashboxMutationReceipt.objects.filter(tenant=tenant).exists()
    assert CashIncome.objects.filter(tenant=tenant).count() == 1
    confirmed_body = {**body, "expected_cash_uzs": "9.00", "actual_cash_uzs": "9.00"}
    confirmed = client.post("/api/v1/cashbox/shift/close/", confirmed_body, format="json")
    assert confirmed.status_code == 201
    assert DailyCashReport.objects.filter(tenant=tenant).count() == 1
    replay = client.post("/api/v1/cashbox/shift/close/", confirmed_body, format="json")
    assert replay.status_code == 201 and replay.data == confirmed.data
    stale_new = client.post(
        "/api/v1/cashbox/shift/close/",
        {**confirmed_body, "idempotency_key": str(uuid.uuid4()), "expected_cash_uzs": "0.00"},
        format="json",
    )
    assert stale_new.status_code == 400
    assert CashboxMutationReceipt.objects.filter(tenant=tenant).count() == 1


def test_receipt_failure_rolls_back_the_cash_entry(tenant, owner):
    client = client_for(owner, tenant)
    body = {
        "amount": "10.00",
        "source": "Rollback",
        "expected_shift_id": current_shift(tenant).pk,
        "idempotency_key": str(uuid.uuid4()),
    }
    with patch(
        "apps.cashbox.services.mutations.CashboxMutationReceipt.objects.create",
        side_effect=RuntimeError("synthetic receipt failure"),
    ):
        with pytest.raises(RuntimeError, match="synthetic receipt failure"):
            client.post("/api/v1/cashbox/income/", body, format="json")
    assert not CashIncome.objects.filter(tenant=tenant).exists()
    assert not CashboxMutationReceipt.objects.filter(tenant=tenant).exists()


def test_close_receipt_failure_rolls_back_report_shift_links_and_notifications(tenant, owner):
    from apps.notifications.models import PushEvent
    from apps.sales.models import Notification

    client = client_for(owner, tenant)
    shift = current_shift(tenant)
    CashboxService.record_income(tenant=tenant, user=owner, amount=Decimal("9.00"), source="Synthetic rollback")
    before_notifications = Notification.objects.count()
    before_events = PushEvent.objects.count()
    body = {
        "idempotency_key": str(uuid.uuid4()),
        "shift_id": shift.pk,
        "actual_cash_uzs": "9.00",
        "actual_cash_usd": "0.00",
        "expected_cash_uzs": "9.00",
        "expected_cash_usd": "0.00",
    }
    with patch(
        "apps.cashbox.services.mutations.CashboxMutationReceipt.objects.create",
        side_effect=RuntimeError("synthetic receipt failure"),
    ):
        with pytest.raises(RuntimeError, match="synthetic receipt failure"):
            client.post("/api/v1/cashbox/shift/close/", body, format="json")
    shift.refresh_from_db()
    assert shift.closed_at is None
    assert not DailyCashReport.objects.filter(tenant=tenant).exists()
    assert CashIncome.objects.get(tenant=tenant).shift_report_id is None
    assert Notification.objects.count() == before_notifications
    assert PushEvent.objects.count() == before_events
    assert not CashboxMutationReceipt.objects.filter(tenant=tenant).exists()


def test_capability_and_legacy_web_contract_and_tenant_isolation(tenant, owner):
    client = client_for(owner, tenant)
    assert client.get("/api/v1/cashbox/capabilities/").data["cashbox_mutations"] == 1
    legacy = client.post("/api/v1/cashbox/income/", {"amount": "10.00", "source": "Legacy"}, format="json")
    assert legacy.status_code == 201
    assert "cashbox_operation" not in legacy.data
    foreign = TenantFactory()
    denied = client_for(owner, foreign).post(
        "/api/v1/cashbox/income/", {"amount": "10.00", "source": "Denied"}, format="json"
    )
    assert denied.status_code in (403, 404)
    assert not CashIncome.objects.filter(tenant=foreign).exists()


def test_receipt_is_actor_bound_even_for_a_known_valid_key(tenant, owner):
    key = uuid.uuid4()
    action = Mock(return_value={"id": 42, "amount": "1.00"})
    payload = {"expected_shift_id": current_shift(tenant).pk, "amount": Decimal("1.00")}
    perform_cashbox_mutation(tenant=tenant, actor=owner, key=key, kind="income", payload=payload, action=action)
    with pytest.raises(ValidationError):
        perform_cashbox_mutation(
            tenant=tenant, actor=OwnerFactory(), key=key, kind="income", payload=payload, action=action
        )
    assert action.call_count == 1


@pytest.mark.django_db(transaction=True)
def test_concurrent_same_key_creates_one_cash_entry(tenant, owner):
    body = {
        "amount": "15.25",
        "currency": "UZS",
        "source": "Concurrent",
        "expected_shift_id": current_shift(tenant).pk,
        "idempotency_key": str(uuid.uuid4()),
    }

    def submit():
        close_old_connections()
        try:
            response = client_for(owner, tenant).post("/api/v1/cashbox/income/", body, format="json")
            return response.status_code, response.data["id"]
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        values = list(pool.map(lambda _: submit(), range(2)))
    assert values[0] == values[1] and values[0][0] == 201
    assert CashIncome.objects.filter(tenant=tenant).count() == 1
    assert CashboxMutationReceipt.objects.filter(tenant=tenant).count() == 1
