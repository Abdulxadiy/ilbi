from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from decimal import Decimal
from unittest.mock import Mock, patch

import pytest
import requests
from celery.exceptions import Retry
from django.utils import timezone
from rest_framework.test import APIClient

from api.v1.sales.serializers import CounterpartyOutputSerializer, DebtPaymentOutputSerializer
from api.v1.tenants.serializers import TenantAdminSerializer, TenantOwnerSerializer, TenantSettingsSerializer
from apps.sales.models import DebtPayment
from apps.sales.services import DebtService, DebtServiceError
from apps.tenants.exchange_rates import (
    CBU_URL,
    TASHKENT,
    ExchangeRateError,
    get_cbu_rates,
    resolve_usd_rate,
    sync_cbu_rates,
)
from apps.tenants.models import CBUExchangeRate
from apps.tenants.services import TenantService
from apps.tenants.tasks import sync_cbu_rates_task
from tests.factories import CounterpartyFactory, EmployeeFactory, StaffFactory, TenantFactory

pytestmark = pytest.mark.django_db
URL = "/api/v1/tenants/current/"


def official(code="USD", rate="12500.25", date=None):
    return CBUExchangeRate.objects.create(
        currency=code, rate=Decimal(rate),
        effective_date=date or timezone.localdate(timezone=TASHKENT), checked_at=timezone.now(),
    )


def payload():
    date = timezone.localdate(timezone=TASHKENT).strftime("%d.%m.%Y")
    return [
        {"Ccy": "USD", "Rate": "12500.25", "Nominal": "1", "Date": date},
        {"Ccy": "EUR", "Rate": "14000.50", "Nominal": "1", "Date": date},
        {"Ccy": "RUB", "Rate": "1500.75", "Nominal": "10", "Date": date},
    ]


def client_for(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


def test_sync_normalizes_nominal_and_is_shared_and_idempotent(tenant):
    with patch("apps.tenants.exchange_rates.requests.get", return_value=Mock(json=payload)) as get:
        sync_cbu_rates()
        sync_cbu_rates()
    assert CBUExchangeRate.objects.count() == 3
    assert get_cbu_rates()["RUB"].rate == Decimal("150.075000")
    today = timezone.localdate(timezone=TASHKENT)
    get.assert_called_with(f"{CBU_URL}all/{today.isoformat()}/", timeout=(5, 20))
    tenant.refresh_from_db()
    assert tenant.auto_usd_rate is False
    assert tenant.usd_rate == Decimal("12800.00")


@pytest.mark.parametrize("bad", [
    [], {}, None,
    [{"Ccy": "USD"}],
    payload()[:2],
    payload() + [payload()[0]],
    [{**row, "Rate": "NaN"} for row in payload()],
    [{**row, "Rate": "Infinity"} for row in payload()],
    [{**row, "Rate": "-1"} for row in payload()],
    [{**row, "Rate": "0"} for row in payload()],
    [{**row, "Rate": "1e999"} for row in payload()],
    [{**row, "Nominal": "0"} for row in payload()],
    [{**row, "Nominal": "-1"} for row in payload()],
    [{**row, "Date": "invalid"} for row in payload()],
    [payload()[0], payload()[1], {**payload()[2], "Rate": "broken"}],
])
def test_invalid_response_never_partially_replaces_last_successful_rates(bad):
    existing = official()
    checked_at = existing.checked_at
    with patch("apps.tenants.exchange_rates.requests.get", return_value=Mock(json=lambda: bad)):
        with pytest.raises(ExchangeRateError):
            sync_cbu_rates()
    existing.refresh_from_db()
    assert CBUExchangeRate.objects.count() == 1
    assert existing.rate == Decimal("12500.25")
    assert existing.checked_at == checked_at


@pytest.mark.parametrize("error", [requests.Timeout(), requests.ConnectionError(), requests.HTTPError(), ValueError()])
def test_transport_and_json_failures_preserve_existing_rates(error):
    official()
    with patch("apps.tenants.exchange_rates.requests.get", side_effect=error):
        with pytest.raises(ExchangeRateError):
            sync_cbu_rates()
    assert get_cbu_rates()["USD"].rate == Decimal("12500.25")


def test_future_rates_are_not_used_and_last_effective_rate_survives_weekends(tenant):
    today = timezone.localdate(timezone=TASHKENT)
    old = official(date=today - timedelta(days=3))
    official(rate="14000", date=today + timedelta(days=1))
    tenant.auto_usd_rate = True
    assert resolve_usd_rate(tenant) == (old.rate, "cbu", old.effective_date)


def test_effective_date_uses_tashkent_midnight():
    official(date=datetime(2026, 10, 18).date(), rate="12000")
    official(date=datetime(2026, 10, 19).date(), rate="13000")
    with patch("django.utils.timezone.now", return_value=datetime(2026, 10, 18, 18, 59, tzinfo=dt_timezone.utc)):
        assert get_cbu_rates()["USD"].rate == Decimal("12000")
    with patch("django.utils.timezone.now", return_value=datetime(2026, 10, 18, 19, 0, tzinfo=dt_timezone.utc)):
        assert get_cbu_rates()["USD"].rate == Decimal("13000")


def test_owner_toggle_restores_saved_manual_rate_and_new_publication_is_visible(tenant, owner):
    client = client_for(owner)
    assert client.patch(URL, {"usd_rate": "13123.45"}, format="json").status_code == 200
    rate = official()
    enabled = client.patch(URL, {"auto_usd_rate": True}, format="json")
    assert enabled.status_code == 200
    assert enabled.data["usd_rate"] == "12500.25"
    assert enabled.data["manual_usd_rate"] == "13123.45"
    assert enabled.data["usd_rate_source"] == "cbu"
    assert enabled.data["cbu_rates"]["USD"]["date"] == rate.effective_date.isoformat()
    tenant.refresh_from_db()
    assert tenant.usd_rate == Decimal("13123.45")
    rate.rate = Decimal("12600.75")
    rate.save(update_fields=["rate"])
    assert client.get(URL).data["usd_rate"] == "12600.75"
    assert client.patch(URL, {"description": "Updated"}, format="json").status_code == 200
    disabled = client.patch(URL, {"auto_usd_rate": False}, format="json")
    assert disabled.data["usd_rate"] == "13123.45"
    assert disabled.data["usd_rate_source"] == "manual"
    assert client.patch(URL, {"usd_rate": "13200.00"}, format="json").status_code == 200


@pytest.mark.parametrize("serializer_class", [TenantAdminSerializer, TenantOwnerSerializer, TenantSettingsSerializer])
def test_all_settings_serializers_block_manual_changes_while_automatic(tenant, serializer_class):
    official()
    tenant.auto_usd_rate = True
    serializer = serializer_class(tenant, data={"usd_rate": "1.00"}, partial=True)
    assert not serializer.is_valid()
    assert "usd_rate" in serializer.errors
    transition = serializer_class(tenant, data={"auto_usd_rate": False, "usd_rate": "13000.00"}, partial=True)
    assert transition.is_valid(), transition.errors


def test_enabling_requires_an_effective_usd_rate(tenant, owner):
    client = client_for(owner)
    official(date=timezone.localdate(timezone=TASHKENT) + timedelta(days=1))
    response = client.patch(URL, {"auto_usd_rate": True}, format="json")
    assert response.status_code == 400
    tenant.refresh_from_db()
    assert tenant.auto_usd_rate is False


def test_api_cannot_write_rate_when_auto_or_replace_readonly_manual_backup(tenant, owner):
    official()
    tenant.auto_usd_rate = True
    tenant.save(update_fields=["auto_usd_rate"])
    client = client_for(owner)
    assert client.patch(URL, {"usd_rate": "1"}, format="json").status_code == 400
    response = client.patch(URL, {"manual_usd_rate": "1", "cbu_rates": {"USD": {"rate": "1"}}}, format="json")
    assert response.status_code == 200
    tenant.refresh_from_db()
    assert tenant.usd_rate == Decimal("12800.00")
    assert get_cbu_rates()["USD"].rate == Decimal("12500.25")


@pytest.mark.parametrize("value", ["0", "-1", "NaN", "Infinity"])
def test_manual_rate_must_be_positive_and_finite(tenant, owner, value):
    assert client_for(owner).patch(URL, {"usd_rate": value}, format="json").status_code == 400


def test_automatic_choice_is_tenant_local_and_staff_cannot_enable_it(tenant, owner):
    official()
    second = TenantFactory(owner=owner, usd_rate="14000.00")
    EmployeeFactory(user=owner, tenant=second, is_owner=True)
    client = client_for(owner)
    assert client.patch(URL, {"auto_usd_rate": True}, format="json", HTTP_X_TENANT_ID=str(tenant.pk)).status_code == 200
    own = client.get(URL, HTTP_X_TENANT_ID=str(second.pk))
    assert own.data["auto_usd_rate"] is False
    assert own.data["usd_rate"] == "14000.00"
    foreign = TenantFactory()
    foreign_change = client.patch(URL, {"auto_usd_rate": True}, format="json", HTTP_X_TENANT_ID=str(foreign.pk))
    assert foreign_change.status_code == 403
    staff = StaffFactory()
    EmployeeFactory(user=staff, tenant=tenant)
    assert client_for(staff).patch(URL, {"auto_usd_rate": True}, format="json").status_code == 403
    staff_read = client_for(staff).get(URL)
    assert staff_read.data["usd_rate"] == "12500.25"


def test_copying_store_settings_preserves_both_source_and_manual_backup(tenant, owner):
    official()
    tenant.auto_usd_rate = True
    tenant.usd_rate = Decimal("13000")
    tenant.save(update_fields=["auto_usd_rate", "usd_rate"])
    clone = TenantService.create_for_existing_owner(owner=owner, name="Copied currency", copy_settings_from=tenant.pk)
    assert clone.auto_usd_rate is True
    assert clone.usd_rate == Decimal("13000")
    assert clone.effective_usd_rate == Decimal("12500.25")


def test_debt_conversion_uses_receiving_store_and_keeps_historical_snapshot(tenant, owner):
    rate = official()
    receiving = TenantFactory(owner=owner, auto_usd_rate=True, usd_rate="14000")
    EmployeeFactory(user=owner, tenant=receiving, is_owner=True)
    cp = CounterpartyFactory(tenant=tenant, debt_balance_usd=Decimal("5"), debt_balance_uzs=Decimal("1000000"))
    payment = DebtService.record_payment(
        counterparty=cp, amount=Decimal("15"), currency="USD", recorded_by=owner,
        branch=receiving, is_correction=True, note="Synthetic conversion", idempotency_key="conversion-1",
    )
    cp.refresh_from_db()
    assert cp.debt_balance_usd == 0
    assert cp.debt_balance_uzs == Decimal("874997.50")
    assert payment.exchange_rate == Decimal("12500.25")
    assert payment.exchange_rate_source == "cbu"
    assert payment.exchange_rate_date == rate.effective_date
    assert payment.converted_amount_uzs == Decimal("125002.50")
    before = DebtPaymentOutputSerializer(payment).data
    rate.rate = Decimal("15000")
    rate.save(update_fields=["rate"])
    receiving.auto_usd_rate = False
    receiving.save(update_fields=["auto_usd_rate"])
    payment.refresh_from_db()
    assert DebtPaymentOutputSerializer(payment).data == before
    last = CounterpartyOutputSerializer(cp).data["last_payment"]
    assert Decimal(last["exchange_rate"]) == Decimal("12500.25")
    assert Decimal(last["converted_amount_uzs"]) == Decimal("125002.50")
    replay = DebtService.record_payment(
        counterparty=cp, amount=Decimal("15"), currency="USD", recorded_by=owner,
        branch=receiving, is_correction=True, note="Synthetic conversion", idempotency_key="conversion-1",
    )
    assert replay.pk == payment.pk
    assert DebtPayment.objects.filter(counterparty=cp).count() == 1


def test_manual_debt_conversion_uses_fresh_locked_settings(tenant, owner):
    from apps.tenants.models import Tenant
    cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs=Decimal("1000000"))
    Tenant.objects.filter(pk=tenant.pk).update(usd_rate="13100")
    payment = DebtService.record_payment(
        counterparty=cp, amount=Decimal("10"), currency="USD", recorded_by=owner,
    )
    assert payment.exchange_rate == Decimal("13100")
    assert payment.exchange_rate_source == "manual"
    assert payment.exchange_rate_date is None
    assert payment.converted_amount_uzs == Decimal("131000")


def test_missing_cbu_rate_blocks_conversion_without_changing_debt(tenant, owner):
    tenant.auto_usd_rate = True
    tenant.save(update_fields=["auto_usd_rate"])
    cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs=Decimal("1000000"))
    with pytest.raises(DebtServiceError, match="CBU"):
        DebtService.record_payment(counterparty=cp, amount=Decimal("10"), currency="USD", recorded_by=owner)
    cp.refresh_from_db()
    assert cp.debt_balance_uzs == Decimal("1000000")
    assert not cp.payments.exists()
    assert client_for(owner).get(URL).data["usd_rate"] is None
    assert client_for(owner).patch(URL, {"auto_usd_rate": False}, format="json").status_code == 200


def test_task_retries_source_failures():
    with patch("apps.tenants.tasks.sync_cbu_rates", side_effect=ExchangeRateError("offline")), patch.object(
        sync_cbu_rates_task, "retry", side_effect=Retry(),
    ) as retry:
        with pytest.raises(Retry):
            sync_cbu_rates_task.run()
    assert retry.call_count == 1
