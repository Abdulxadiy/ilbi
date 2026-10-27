"""Authoritative debt allocation previews and opt-in no-new-credit commits."""

from decimal import Decimal
from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from apps.cashbox.models import CashShift
from apps.sales.models import Counterparty, DebtPayment, Notification
from apps.tenants.models import CBUExchangeRate, Tenant
from tests.factories import CounterpartyFactory, EmployeeFactory, StaffFactory, TenantFactory

pytestmark = pytest.mark.django_db


def client_for(user, tenant):
    client = APIClient()
    client.force_authenticate(user)
    client.credentials(HTTP_X_TENANT_ID=str(tenant.pk))
    return client


def payment_path(cp):
    return f"/api/v1/sales/counterparties/{cp.pk}/payments/"


def quote(client, cp, *, amount="5.00", currency="USD", payment_type="cash", **kwargs):
    response = client.get(
        payment_path(cp) + "quote/", {"amount": amount, "currency": currency, "payment_type": payment_type, **kwargs}
    )
    assert response.status_code == 200, response.data
    return response.data


def test_usd_quote_covers_uzs_debt_at_actual_branch_rate_without_side_effects(tenant, owner):
    tenant.usd_rate = Decimal("13000.00")
    tenant.save(update_fields=["usd_rate"])
    cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs="100000.00", debt_balance_usd="0.00")
    shifts = CashShift.objects.count()
    with patch("apps.sales.services.debt_service.DebtService.check_threshold_and_notify") as notify:
        result = quote(client_for(owner, tenant), cp)
        notify.assert_not_called()
    assert result["protocol"] == "ilbi-debt-payment-quote-v1"
    assert result["amount"] == "5.00" and result["applied"] == {"UZS": "65000.00", "USD": "0.00"}
    assert result["remaining"] == {"UZS": "35000.00", "USD": "0.00"}
    assert result["exchange_rate"] == "13000.000000" and result["exchange_rate_source"] == "manual"
    assert result["exchange_rate_date"] is None and not result["creates_credit"]
    assert len(result["expected_quote"]) == 64
    assert result["actor_id"] == owner.pk and result["tenant_id"] == tenant.pk
    cp.refresh_from_db()
    assert cp.debt_balance_uzs == Decimal("100000.00")
    assert (
        not DebtPayment.objects.exists() and not Notification.objects.exists() and CashShift.objects.count() == shifts
    )


def test_usd_allocation_pays_usd_first_then_uzs_with_exact_quote_ack(tenant, owner):
    tenant.usd_rate = Decimal("13000.00")
    tenant.save(update_fields=["usd_rate"])
    cp = CounterpartyFactory(tenant=tenant, debt_balance_usd="2.00", debt_balance_uzs="100000.00")
    client = client_for(owner, tenant)
    preview = quote(client, cp, payment_type="card")
    assert preview["applied"] == {"UZS": "39000.00", "USD": "2.00"}
    body = {
        "amount": "5",
        "currency": "USD",
        "payment_type": "card",
        "note": "Original",
        "idempotency_key": "quote-original",
        "expected_quote": preview["expected_quote"],
    }
    result = client.post(payment_path(cp), body, format="json")
    assert result.status_code == 201, result.data
    receipt = result.data["payment_operation"]
    assert receipt == {
        "protocol": preview["protocol"],
        "idempotency_key": "quote-original",
        "expected_quote": preview["expected_quote"],
        "actor_id": owner.pk,
        "tenant_id": tenant.pk,
        "counterparty_id": cp.pk,
        "branch_id": tenant.pk,
    }
    assert Decimal(result.data["converted_amount_uzs"]) == Decimal("39000")
    cp.refresh_from_db()
    assert cp.debt_balance_usd == 0 and cp.debt_balance_uzs == Decimal("61000")


@pytest.mark.parametrize("change", ["balance", "rate"])
def test_stale_quote_cannot_change_money(change, tenant, owner):
    tenant.usd_rate = Decimal("13000.00")
    tenant.save(update_fields=["usd_rate"])
    cp = CounterpartyFactory(tenant=tenant, debt_balance_usd="0", debt_balance_uzs="100000")
    client = client_for(owner, tenant)
    preview = quote(client, cp)
    if change == "balance":
        Counterparty.objects.filter(pk=cp.pk).update(debt_balance_uzs="1000")
    else:
        Tenant.objects.filter(pk=tenant.pk).update(usd_rate="13001")
    result = client.post(
        payment_path(cp),
        {"amount": "5", "currency": "USD", "idempotency_key": "stale", "expected_quote": preview["expected_quote"]},
        format="json",
    )
    assert result.status_code == 400
    cp.refresh_from_db()
    assert cp.debt_balance_uzs == Decimal("1000" if change == "balance" else "100000")
    assert not DebtPayment.objects.exists()


def test_guard_blocks_credit_but_legacy_client_still_can_record_credit(tenant, owner):
    cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs="100.00", debt_balance_usd="0")
    client = client_for(owner, tenant)
    preview = quote(client, cp, amount="120", currency="UZS")
    assert preview["creates_credit"] and preview["remaining"]["UZS"] == "-20.00"
    body = {
        "amount": "120",
        "currency": "UZS",
        "idempotency_key": "guarded-credit",
        "expected_quote": preview["expected_quote"],
    }
    assert client.post(payment_path(cp), body, format="json").status_code == 400
    assert not DebtPayment.objects.exists()
    assert (
        client.post(
            payment_path(cp), {"amount": "120", "currency": "UZS", "idempotency_key": "legacy-credit"}, format="json"
        ).status_code
        == 201
    )
    cp.refresh_from_db()
    assert cp.debt_balance_uzs == Decimal("-20")


def test_existing_other_currency_credit_does_not_block_a_payment_that_creates_no_new_credit(tenant, owner):
    cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs="-50", debt_balance_usd="10")
    client = client_for(owner, tenant)
    preview = quote(client, cp)
    assert not preview["creates_credit"] and preview["remaining"] == {"UZS": "-50.00", "USD": "5.00"}
    result = client.post(
        payment_path(cp),
        {"amount": "5", "currency": "USD", "idempotency_key": "usd-only", "expected_quote": preview["expected_quote"]},
        format="json",
    )
    assert result.status_code == 201


def test_original_guarded_replay_survives_changed_balance_rate_and_closed_shift(tenant, owner):
    tenant.usd_rate = Decimal("13000")
    tenant.save(update_fields=["usd_rate"])
    cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs="65000", debt_balance_usd="0")
    client = client_for(owner, tenant)
    preview = quote(client, cp)
    body = {
        "amount": "5",
        "currency": "USD",
        "idempotency_key": "durable-original",
        "expected_quote": preview["expected_quote"],
    }
    first = client.post(payment_path(cp), body, format="json")
    assert first.status_code == 201
    from django.utils import timezone

    Tenant.objects.filter(pk=tenant.pk).update(usd_rate="14000")
    CashShift.objects.filter(tenant=tenant, closed_at__isnull=True).update(closed_at=timezone.now())
    repeat = client.post(payment_path(cp), {**body, "amount": "5.00"}, format="json")
    assert repeat.status_code == 201 and repeat.data == first.data
    assert DebtPayment.objects.count() == 1
    cp.refresh_from_db()
    assert cp.debt_balance_uzs == 0


@pytest.mark.parametrize("change", [{"amount": "4"}, {"note": "Changed"}, {"expected_quote": "a" * 64}])
def test_guarded_key_is_bound_to_original_body(change, tenant, owner):
    cp = CounterpartyFactory(tenant=tenant, debt_balance_usd="10", debt_balance_uzs="0")
    client = client_for(owner, tenant)
    preview = quote(client, cp)
    body = {
        "amount": "5",
        "currency": "USD",
        "idempotency_key": "bound-body",
        "expected_quote": preview["expected_quote"],
    }
    assert client.post(payment_path(cp), body, format="json").status_code == 201
    assert client.post(payment_path(cp), {**body, **change}, format="json").status_code == 400
    assert DebtPayment.objects.count() == 1


def test_branch_rate_and_membership_are_authoritative(tenant, owner):
    branch = TenantFactory(owner=owner, usd_rate="15000")
    EmployeeFactory(user=owner, tenant=branch, is_owner=True)
    cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs="100000", debt_balance_usd="0")
    client = client_for(owner, tenant)
    preview = quote(client, cp, branch_id=branch.pk)
    assert preview["branch_id"] == branch.pk and preview["applied"]["UZS"] == "75000.00"
    result = client.post(
        payment_path(cp),
        {
            "amount": "5",
            "currency": "USD",
            "branch_id": branch.pk,
            "idempotency_key": "branch-payment",
            "expected_quote": preview["expected_quote"],
        },
        format="json",
    )
    assert result.status_code == 201 and result.data["branch_id"] == branch.pk
    foreign = TenantFactory()
    assert (
        client.get(payment_path(cp) + "quote/", {"amount": "1", "currency": "USD", "branch_id": foreign.pk}).status_code
        == 404
    )


def test_quote_requires_payment_permission_and_current_tenant(tenant, owner):
    cp = CounterpartyFactory(tenant=tenant)
    foreign = CounterpartyFactory()
    client = client_for(owner, tenant)
    assert client.get(payment_path(foreign) + "quote/", {"amount": "1", "currency": "UZS"}).status_code == 404
    staff = StaffFactory()
    EmployeeFactory(user=staff, tenant=tenant)
    assert (
        client_for(staff, tenant).get(payment_path(cp) + "quote/", {"amount": "1", "currency": "UZS"}).status_code
        == 403
    )
    assert (
        client.post(
            payment_path(cp), {"amount": "1", "currency": "UZS", "expected_quote": "a" * 64}, format="json"
        ).status_code
        == 400
    )


def test_original_key_and_quote_cannot_be_replayed_by_another_authorized_actor(tenant, owner):
    from apps.permissions.models import Permission

    cp = CounterpartyFactory(tenant=tenant, debt_balance_usd="10", debt_balance_uzs="0")
    client = client_for(owner, tenant)
    preview = quote(client, cp)
    body = {
        "amount": "5",
        "currency": "USD",
        "idempotency_key": "actor-bound",
        "expected_quote": preview["expected_quote"],
    }
    assert client.post(payment_path(cp), body, format="json").status_code == 201
    staff = StaffFactory()
    member = EmployeeFactory(user=staff, tenant=tenant)
    member.permissions.add(Permission.objects.get(category="sales", codename="record_debt_payment"))
    assert client_for(staff, tenant).post(payment_path(cp), body, format="json").status_code == 400
    cp.refresh_from_db()
    assert cp.debt_balance_usd == Decimal("5") and DebtPayment.objects.count() == 1


def test_official_rate_quote_records_the_actual_six_place_source(tenant, owner):
    from django.utils import timezone

    tenant.auto_usd_rate = True
    tenant.save(update_fields=["auto_usd_rate"])
    day = timezone.localdate()
    CBUExchangeRate.objects.create(currency="USD", effective_date=day, checked_at=timezone.now(), rate="13000.123456")
    cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs="100000", debt_balance_usd="0")
    preview = quote(client_for(owner, tenant), cp)
    assert preview["exchange_rate"] == "13000.123456" and preview["exchange_rate_source"] == "cbu"
    assert preview["exchange_rate_date"] == day.isoformat() and preview["applied"]["UZS"] == "65000.62"


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("same_key", [False, True])
def test_concurrent_guarded_payments_from_one_snapshot_are_once_only(same_key, tenant, owner, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor

    from celery.app.task import Task
    from django.contrib.auth import get_user_model
    from django.db import close_old_connections, connections

    monkeypatch.setattr(Task, "apply_async", lambda *args, **kwargs: None)
    cp = CounterpartyFactory(tenant=tenant, debt_balance_usd="0", debt_balance_uzs="100")
    preview = quote(client_for(owner, tenant), cp, amount="100", currency="UZS")
    actor_id, tenant_id, cp_id = owner.pk, tenant.pk, cp.pk

    def pay(key):
        close_old_connections()
        try:
            actor = get_user_model().objects.get(pk=actor_id)
            shop = Tenant.objects.get(pk=tenant_id)
            return (
                client_for(actor, shop)
                .post(
                    f"/api/v1/sales/counterparties/{cp_id}/payments/",
                    {
                        "amount": "100",
                        "currency": "UZS",
                        "expected_quote": preview["expected_quote"],
                        "idempotency_key": key,
                    },
                    format="json",
                )
                .status_code
            )
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(pay, ["device-one", "device-one" if same_key else "device-two"]))
    assert sorted(results) == ([201, 201] if same_key else [201, 400])
    cp.refresh_from_db()
    assert cp.debt_balance_uzs == 0 and DebtPayment.objects.count() == 1
