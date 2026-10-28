from datetime import date, datetime, timedelta, timezone as dt_timezone
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.inventory.services import StockService
from apps.sales.models import Notification, Sale
from apps.sales.services import CounterpartyService, DebtService
from apps.sales.services.debt_reminder_service import notify_due_debts
from apps.sales.tasks import notify_due_debts_task
from tests.factories import CounterpartyFactory, EmployeeFactory, ProductVariantFactory, StaffFactory, TenantFactory

pytestmark = pytest.mark.django_db
CUSTOMERS = '/api/v1/sales/counterparties/'
NOTIFICATIONS = '/api/v1/sales/notifications/'


@pytest.fixture
def client(owner, tenant):
    client = APIClient()
    client.force_authenticate(owner)
    client.credentials(HTTP_X_TENANT_ID=str(tenant.pk))
    return client


def test_date_is_optional_editable_and_clearable(client, tenant):
    result = client.post(CUSTOMERS, {'name': 'Sana ixtiyoriy', 'phone_number': '+998900000100'}, format='json')
    assert result.status_code == 201
    assert result.data['debt_due_date'] is None
    pk = result.data['id']
    url = f'{CUSTOMERS}{pk}/'
    selected = (timezone.localdate() + timedelta(days=3)).isoformat()
    assert client.patch(url, {'debt_due_date': selected}, format='json').data['debt_due_date'] == selected
    assert client.patch(url, {'note': 'Izoh'}, format='json').data['debt_due_date'] == selected
    assert client.patch(url, {'debt_due_date': 'invalid'}, format='json').status_code == 400
    assert client.patch(url, {'debt_due_date': None}, format='json').data['debt_due_date'] is None
    assert client.post(CUSTOMERS, {'name': 'Sana bilan', 'phone_number': '+998900000101', 'debt_due_date': selected}, format='json').data['debt_due_date'] == selected


def test_only_due_outstanding_active_customers_are_notified(tenant):
    today = timezone.localdate()
    for values in (
        {'debt_due_date': None, 'debt_balance_uzs': 100},
        {'debt_due_date': today + timedelta(days=1), 'debt_balance_uzs': 100},
        {'debt_due_date': today, 'debt_balance_uzs': 0},
        {'debt_due_date': today, 'debt_balance_uzs': -100},
        {'debt_due_date': today, 'debt_balance_uzs': 100, 'is_active': False},
    ):
        CounterpartyFactory(tenant=tenant, **values)
    due = CounterpartyFactory(tenant=tenant, debt_due_date=today, debt_balance_uzs=100)
    overdue = CounterpartyFactory(tenant=tenant, debt_due_date=today-timedelta(days=1), debt_balance_usd=25)
    other = CounterpartyFactory(tenant=TenantFactory(is_active=False), debt_due_date=today, debt_balance_uzs=100)
    assert notify_due_debts_task() == 2
    assert set(Notification.objects.values_list('link', flat=True)) == {f'/debts?workspace_id={cp.pk}' for cp in (due, overdue)}
    assert set(Notification.objects.values_list('recipient_id', flat=True)) == {tenant.owner_id}
    assert notify_due_debts_task() == 0
    other.refresh_from_db()
    assert other.last_notified_debt_due_date is None


def test_owner_poll_works_offline_and_other_users_do_not_receive_or_trigger_it(client, owner, tenant, settings):
    settings.DESKTOP_MODE = True
    today = timezone.localdate()
    cp = CounterpartyFactory(tenant=tenant, debt_due_date=today, debt_balance_uzs=100)
    other = CounterpartyFactory(tenant=TenantFactory(), debt_due_date=today, debt_balance_uzs=100)
    staff = StaffFactory()
    EmployeeFactory(tenant=tenant, user=staff)
    client.force_authenticate(staff)
    assert client.get(NOTIFICATIONS).data == []
    cp.refresh_from_db()
    assert cp.last_notified_debt_due_date is None
    client.force_authenticate(owner)
    result = client.get(NOTIFICATIONS + '?page=1')
    assert result.status_code == 200
    assert result.data['unread_count'] == 1
    assert result.data['results'][0]['type'] == 'debt_due_reminder'
    assert '100.00 UZS' in result.data['results'][0]['message']
    assert client.get(NOTIFICATIONS + '?page=1').data['count'] == 1
    other.refresh_from_db()
    assert other.last_notified_debt_due_date is None
    # Reading or removing the notification must not make it reappear.
    pk = result.data['results'][0]['id']
    client.post(f'{NOTIFICATIONS}{pk}/read/')
    client.delete(f'{NOTIFICATIONS}{pk}/')
    assert client.get(NOTIFICATIONS).data == []


def test_rescheduling_rearms_once_and_clearing_cancels(tenant):
    today = timezone.localdate()
    cp = CounterpartyFactory(tenant=tenant, debt_due_date=today-timedelta(days=1), debt_balance_uzs=100)
    assert notify_due_debts(tenant_id=tenant.pk) == 1
    CounterpartyService.update(cp, debt_due_date=today)
    assert notify_due_debts(tenant_id=tenant.pk) == 1
    CounterpartyService.update(cp, debt_due_date=today)
    assert notify_due_debts(tenant_id=tenant.pk) == 0
    CounterpartyService.update(cp, debt_due_date=today+timedelta(days=1))
    assert notify_due_debts(tenant_id=tenant.pk) == 0
    CounterpartyService.update(cp, debt_due_date=None)
    cp.refresh_from_db()
    assert cp.debt_due_date is cp.last_notified_debt_due_date is None
    assert notify_due_debts(tenant_id=tenant.pk) == 0


def test_partial_payment_keeps_date_and_reminds_remaining_balance_full_payment_clears(tenant, owner):
    today = timezone.localdate()
    cp = CounterpartyFactory(tenant=tenant, debt_due_date=today, debt_balance_uzs=100, debt_balance_usd=5)
    DebtService.record_payment(counterparty=cp, amount=Decimal('40'), currency='UZS', recorded_by=owner)
    cp.refresh_from_db()
    assert cp.debt_due_date == today
    assert notify_due_debts(tenant_id=tenant.pk) == 1
    assert '60.00 UZS / 5.00 USD' in Notification.objects.get(type='debt_due_reminder').message
    DebtService.record_payment(counterparty=cp, amount=Decimal('60'), currency='UZS', recorded_by=owner)
    cp.refresh_from_db()
    assert cp.debt_due_date == today  # USD is still owed.
    DebtService.record_payment(counterparty=cp, amount=Decimal('5'), currency='USD', recorded_by=owner)
    cp.refresh_from_db()
    assert cp.debt_due_date is cp.last_notified_debt_due_date is None
    assert notify_due_debts(tenant_id=tenant.pk) == 0


def test_payment_before_due_date_prevents_reminder(tenant, owner):
    cp = CounterpartyFactory(tenant=tenant, debt_due_date=timezone.localdate(), debt_balance_uzs=100)
    DebtService.record_payment(counterparty=cp, amount=Decimal('100'), currency='UZS', recorded_by=owner)
    assert notify_due_debts(tenant_id=tenant.pk) == 0


def test_shop_local_day_is_used_at_utc_boundary(tenant, monkeypatch):
    monkeypatch.setattr(timezone, 'now', lambda: datetime(2026, 10, 20, 19, 1, tzinfo=dt_timezone.utc))
    CounterpartyFactory(tenant=tenant, debt_due_date=date(2026, 10, 21), debt_balance_uzs=100)
    assert notify_due_debts(tenant_id=tenant.pk) == 1


def test_other_tenant_cannot_read_or_change_deadline(client):
    cp = CounterpartyFactory(tenant=TenantFactory(), debt_due_date=timezone.localdate(), debt_balance_uzs=100)
    assert client.get(f'{CUSTOMERS}{cp.pk}/').status_code == 404
    assert client.patch(f'{CUSTOMERS}{cp.pk}/', {'debt_due_date': None}, format='json').status_code == 404


def test_checkout_date_and_idempotency(client, tenant, owner):
    variant = ProductVariantFactory(tenant=tenant, product__tenant=tenant, product__category__tenant=tenant)
    StockService.intake(tenant=tenant, product_variant=variant, quantity=Decimal('20'), cost_price=Decimal('1'), created_by=owner)
    cp = CounterpartyFactory(tenant=tenant)
    selected = timezone.localdate().isoformat()
    payload = {'items': [{'product_variant_id': variant.pk, 'quantity': '1', 'unit_price': str(variant.price_recommended)}],
               'payment_type': 'debt', 'counterparty_id': cp.pk, 'debt_due_date': selected, 'idempotency_key': 'due-checkout'}
    first = client.post('/api/v1/sales/', payload, format='json')
    assert first.status_code == 201, first.data
    cp.refresh_from_db()
    assert cp.debt_due_date.isoformat() == selected
    assert client.post('/api/v1/sales/', payload, format='json').data == first.data
    payload['debt_due_date'] = (timezone.localdate()+timedelta(days=1)).isoformat()
    assert client.post('/api/v1/sales/', payload, format='json').status_code == 400
    payload['idempotency_key'] = 'due-checkout-cleared'
    payload['debt_due_date'] = None
    assert client.post('/api/v1/sales/', payload, format='json').status_code == 201
    cp.refresh_from_db()
    assert cp.debt_due_date is None
    payload.update(payment_type='cash', idempotency_key='no-date-for-cash')
    assert client.post('/api/v1/sales/', payload, format='json').status_code == 400


def test_legacy_checkout_keeps_deadline_and_full_void_clears_it(client, tenant, owner):
    from apps.sales.services.void_service import VoidService
    variant = ProductVariantFactory(tenant=tenant, product__tenant=tenant, product__category__tenant=tenant)
    StockService.intake(tenant=tenant, product_variant=variant, quantity=Decimal('2'), cost_price=Decimal('1'), created_by=owner)
    cp = CounterpartyFactory(tenant=tenant, debt_due_date=timezone.localdate())
    payload = {'items': [{'product_variant_id': variant.pk, 'quantity': '1', 'unit_price': str(variant.price_recommended)}],
               'payment_type': 'debt', 'counterparty_id': cp.pk}
    result = client.post('/api/v1/sales/', payload, format='json')
    assert result.status_code == 201
    cp.refresh_from_db()
    assert cp.debt_due_date == timezone.localdate()
    VoidService.void_sale(sale=Sale.objects.get(pk=result.data[0]['id']), user=owner, reason='Qaytarildi')
    cp.refresh_from_db()
    assert cp.debt_balance_uzs == 0
    assert cp.debt_due_date is None


@pytest.mark.parametrize('selected', [None, date(2035, 3, 15)])
def test_checkout_protects_an_explicit_unchanged_deadline(client, tenant, owner, selected):
    from apps.desktop_sync.protocol import preconditions, record_changes
    variant = ProductVariantFactory(tenant=tenant, product__tenant=tenant, product__category__tenant=tenant)
    StockService.intake(tenant=tenant, product_variant=variant, quantity=Decimal('2'), cost_price=Decimal('1'), created_by=owner)
    cp = CounterpartyFactory(tenant=tenant, debt_due_date=selected)
    expected = selected.isoformat() if selected else None
    payload = {'items': [{'product_variant_id': variant.pk, 'quantity': '1', 'unit_price': str(variant.price_recommended)}],
               'payment_type': 'debt', 'counterparty_id': cp.pk, 'debt_due_date': expected}
    with record_changes() as changes:
        result = client.post('/api/v1/sales/', payload, format='json')
    assert result.status_code == 201
    condition = next(row for row in preconditions(changes) if row['model'] == 'sales.counterparty')
    assert condition == {'model': 'sales.counterparty', 'id': cp.pk, 'fields': {'debt_due_date': expected}}
