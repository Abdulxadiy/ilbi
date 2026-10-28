"""Actual cancellation effects and durable replay contracts used by mobile."""
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.db import DatabaseError
from rest_framework.test import APIClient

from apps.inventory.models import Stock
from apps.inventory.services import StockService
from apps.sales.models import Sale, SaleRefund, SaleVoidLog, SaleVoidRequest
from apps.sales.services import SaleService
from apps.sales.services.void_service import VoidService
from tests.factories import CounterpartyFactory, EmployeeFactory, ProductVariantFactory, StaffFactory, TenantFactory

pytestmark = pytest.mark.django_db


def client_for(user, tenant):
    client = APIClient()
    client.force_authenticate(user)
    client.credentials(HTTP_X_TENANT_ID=str(tenant.pk))
    return client


def seeded_sale(tenant, owner, *, payment="cash", customer=None):
    variant = ProductVariantFactory(tenant=tenant, product__tenant=tenant, product__category__tenant=tenant, unit="kg", price_recommended="200.00")
    StockService.intake(tenant=tenant, product_variant=variant, quantity=Decimal("10.000"), cost_price=Decimal("100.00"), created_by=owner)
    sale = SaleService.create_sale(tenant=tenant, user=owner, items_data=[{"product_variant_id": variant.pk, "quantity": "5.000", "unit_price": "200.00"}], payment_type=payment, counterparty=customer)[0]
    return sale, sale.items.get(), variant


def test_void_capability_requires_sale_view_permission(tenant, owner):
    response = client_for(owner, tenant).get('/api/v1/sales/capabilities/')
    assert response.status_code == 200
    assert response.data['sale_void_idempotency'] == 1
    assert response.data['partial_void_quantity_scale'] == 3
    staff = StaffFactory()
    EmployeeFactory(user=staff, tenant=tenant, is_owner=False)
    assert client_for(staff, tenant).get('/api/v1/sales/capabilities/').status_code == 403


def test_sales_list_real_status_payment_currency_search_and_date_filters(tenant, owner):
    from datetime import datetime, time, timedelta
    from django.utils import timezone
    from tests.factories import SaleFactory

    today = timezone.localdate()
    wanted = SaleFactory(tenant=tenant, sold_by=owner, receipt_number='MOBILE-USD-CARD', currency='USD', payment_type='card', total_amount='99.25')
    old = SaleFactory(tenant=tenant, sold_by=owner, receipt_number='MOBILE-OLD-CARD', currency='USD', payment_type='card')
    Sale.objects.filter(pk=old.pk).update(created_at=timezone.make_aware(datetime.combine(today - timedelta(days=10), time(12))))
    SaleFactory(tenant=tenant, sold_by=owner, receipt_number='MOBILE-VOID', status='voided', currency='UZS')
    SaleFactory(receipt_number='MOBILE-FOREIGN', currency='USD', payment_type='card')
    client = client_for(owner, tenant)
    response = client.get('/api/v1/sales/', {'page': 1, 'page_size': 1, 'status': 'completed', 'payment_type': 'card', 'currency': 'USD', 'date_from': today.isoformat(), 'date_to': today.isoformat(), 'search': 'MOBILE'})
    assert response.status_code == 200
    assert response.data['count'] == 1 and response.data['results'][0]['id'] == wanted.pk
    assert client.get('/api/v1/sales/', {'page': 1, 'status': 'voided'}).data['count'] == 1
    assert client.get('/api/v1/sales/', {'date_from': today.isoformat(), 'date_to': (today - timedelta(days=1)).isoformat()}).status_code == 400


def test_customer_filtered_sales_pages_reach_an_older_sale_detail(tenant, owner):
    from tests.factories import SaleFactory

    customer = CounterpartyFactory(tenant=tenant)
    wanted = [SaleFactory(tenant=tenant, sold_by=owner, counterparty=customer, receipt_number=f'PAGED-{index}') for index in range(7)]
    SaleFactory(tenant=tenant, sold_by=owner, counterparty=CounterpartyFactory(tenant=tenant))
    SaleFactory()
    client = client_for(owner, tenant)
    seen = []
    for page in range(1, 5):
        response = client.get('/api/v1/sales/', {'page': page, 'page_size': 2, 'counterparty_id': customer.pk})
        assert response.status_code == 200 and response.data['count'] == 7
        seen.extend(row['id'] for row in response.data['results'])
        assert bool(response.data['next']) is (page < 4)
    assert len(set(seen)) == 7 and set(seen) == {sale.pk for sale in wanted}
    detail = client.get(f'/api/v1/sales/{wanted[0].pk}/')
    assert detail.status_code == 200 and detail.data['receipt_number'] == 'PAGED-0'


def test_full_void_replay_restores_cash_stock_and_sale_once(tenant, owner):
    sale, item, variant = seeded_sale(tenant, owner)
    client = client_for(owner, tenant)
    path = f'/api/v1/sales/{sale.pk}/void/'
    body = {'reason': 'Mijoz qaytardi', 'idempotency_key': 'full-original-key'}
    first = client.post(path, body, format='json')
    repeated = client.post(path, body, format='json')
    assert first.status_code == repeated.status_code == 200
    assert first.data['void_operation'] == repeated.data['void_operation']
    assert first.data['void_operation']['kind'] == 'sale'
    assert first.data['void_operation']['actor_id'] == owner.pk
    assert first.data['void_operation']['tenant_id'] == tenant.pk
    sale.refresh_from_db(); item.refresh_from_db()
    assert sale.status == Sale.STATUS_VOIDED
    assert sale.refunded_amount == Decimal('1000.00')
    assert item.voided_quantity == Decimal('5.000')
    assert Stock.objects.get(product_variant=variant).quantity == Decimal('10.000')
    assert SaleRefund.objects.filter(sale=sale).count() == 1
    assert SaleVoidLog.objects.filter(sale_item=item).count() == 1
    assert SaleVoidRequest.objects.filter(sale=sale).count() == 1


def test_fractional_partial_void_original_key_replay_is_once_only(tenant, owner):
    sale, item, variant = seeded_sale(tenant, owner)
    path = f'/api/v1/sales/items/{item.pk}/void/'
    body = {'quantity': '1.250', 'reason': 'Qisman qaytdi', 'idempotency_key': 'partial-original-key'}
    client = client_for(owner, tenant)
    first = client.post(path, body, format='json')
    repeated = client.post(path, {**body, 'quantity': '1.25'}, format='json')
    assert first.status_code == repeated.status_code == 200
    assert first.data['void_operation'] == repeated.data['void_operation']
    assert first.data['void_operation']['sale_id'] == sale.pk
    assert first.data['void_operation']['sale_item_id'] == item.pk
    assert Decimal(first.data['void_operation']['quantity']) == Decimal('1.250')
    assert Decimal(first.data['void_operation']['result']['refunded_amount']) == Decimal('250.00')
    item.refresh_from_db(); sale.refresh_from_db()
    assert item.voided_quantity == Decimal('1.250')
    assert sale.refunded_amount == Decimal('250.00')
    assert sale.net_amount == Decimal('750.00')
    assert Stock.objects.get(product_variant=variant).quantity == Decimal('6.250')
    assert SaleRefund.objects.filter(sale=sale).count() == 1


@pytest.mark.parametrize('changes', [{'quantity': '2'}, {'reason': 'Boshqa sabab'}])
def test_same_partial_key_cannot_change_payload(tenant, owner, changes):
    sale, item, variant = seeded_sale(tenant, owner)
    client = client_for(owner, tenant)
    path = f'/api/v1/sales/items/{item.pk}/void/'
    body = {'quantity': '1', 'reason': 'Qaytdi', 'idempotency_key': 'bound-key'}
    assert client.post(path, body, format='json').status_code == 200
    assert client.post(path, {**body, **changes}, format='json').status_code == 400
    item.refresh_from_db()
    assert item.voided_quantity == Decimal('1.000')
    assert SaleRefund.objects.filter(sale=sale).count() == 1


def test_key_cannot_be_reused_for_another_sale_or_actor(tenant, owner):
    first_sale, _, _ = seeded_sale(tenant, owner)
    second_sale, _, _ = seeded_sale(tenant, owner)
    client = client_for(owner, tenant)
    body = {'reason': 'Qaytdi', 'idempotency_key': 'tenant-bound-key'}
    assert client.post(f'/api/v1/sales/{first_sale.pk}/void/', body, format='json').status_code == 200
    assert client.post(f'/api/v1/sales/{second_sale.pk}/void/', body, format='json').status_code == 400
    from apps.permissions.models import Permission
    staff = StaffFactory()
    member = EmployeeFactory(user=staff, tenant=tenant, is_owner=False)
    member.permissions.add(Permission.objects.get(category='sales', codename='void_sale'))
    assert client_for(staff, tenant).post(f'/api/v1/sales/{first_sale.pk}/void/', body, format='json').status_code == 400
    second_sale.refresh_from_db()
    assert second_sale.status == Sale.STATUS_COMPLETED


def test_distinct_partial_keys_allow_second_intentional_return(tenant, owner):
    sale, item, variant = seeded_sale(tenant, owner)
    client = client_for(owner, tenant)
    for key in ['return-one', 'return-two']:
        assert client.post(f'/api/v1/sales/items/{item.pk}/void/', {'quantity': '1.25', 'reason': 'Alohida qaytish', 'idempotency_key': key}, format='json').status_code == 200
    item.refresh_from_db(); sale.refresh_from_db()
    assert item.voided_quantity == Decimal('2.500')
    assert sale.refunded_amount == Decimal('500.00')
    assert SaleVoidRequest.objects.filter(sale=sale).count() == 2


def test_original_partial_replay_after_later_full_void(tenant, owner):
    sale, item, variant = seeded_sale(tenant, owner)
    client = client_for(owner, tenant)
    body = {'quantity': '1.25', 'reason': 'Birinchi qism', 'idempotency_key': 'first-partial'}
    first = client.post(f'/api/v1/sales/items/{item.pk}/void/', body, format='json')
    assert first.status_code == 200
    assert client.post(f'/api/v1/sales/{sale.pk}/void/', {'reason': 'Qolgan qism', 'idempotency_key': 'then-full'}, format='json').status_code == 200
    replay = client.post(f'/api/v1/sales/items/{item.pk}/void/', body, format='json')
    assert replay.status_code == 200
    assert replay.data['void_operation'] == first.data['void_operation']
    sale.refresh_from_db()
    assert sale.refunded_amount == Decimal('1000.00')
    assert Stock.objects.get(product_variant=variant).quantity == Decimal('10.000')
    assert SaleRefund.objects.filter(sale=sale).count() == 2


def test_debt_return_changes_receivable_once(tenant, owner):
    customer = CounterpartyFactory(tenant=tenant)
    sale, item, variant = seeded_sale(tenant, owner, payment='debt', customer=customer)
    customer.refresh_from_db()
    assert customer.debt_balance_uzs == Decimal('1000.00')
    client = client_for(owner, tenant)
    body = {'quantity': '1.250', 'reason': 'Nasiya qaytdi', 'idempotency_key': 'debt-return'}
    for _ in range(2):
        assert client.post(f'/api/v1/sales/items/{item.pk}/void/', body, format='json').status_code == 200
    customer.refresh_from_db()
    assert customer.debt_balance_uzs == Decimal('750.00')


def test_receipt_failure_rolls_back_all_financial_effects(tenant, owner):
    sale, item, variant = seeded_sale(tenant, owner)
    with patch('apps.sales.services.void_service.SaleVoidRequest.objects.create', side_effect=DatabaseError('receipt write failed')):
        with pytest.raises(DatabaseError):
            VoidService.void_sale_item(sale_item=item, user=owner, quantity=Decimal('1.250'), reason='Rollback', idempotency_key='rollback-request')
    sale.refresh_from_db(); item.refresh_from_db()
    assert sale.refunded_amount == 0 and item.voided_quantity == 0
    assert Stock.objects.get(product_variant=variant).quantity == Decimal('5.000')
    assert not SaleRefund.objects.filter(sale=sale).exists()
    assert not SaleVoidLog.objects.filter(sale_item=item).exists()
    assert not SaleVoidRequest.objects.filter(sale=sale).exists()


def test_foreign_tenant_and_ungranted_staff_cannot_void(tenant, owner):
    foreign = TenantFactory()
    foreign_sale, foreign_item, _ = seeded_sale(foreign, foreign.owner)
    body = {'reason': 'No access', 'idempotency_key': 'not-authorized'}
    client = client_for(owner, tenant)
    assert client.post(f'/api/v1/sales/{foreign_sale.pk}/void/', body, format='json').status_code == 404
    assert client.post(f'/api/v1/sales/items/{foreign_item.pk}/void/', {**body, 'quantity': '1'}, format='json').status_code == 404
    staff = StaffFactory()
    EmployeeFactory(user=staff, tenant=tenant, is_owner=False)
    sale, _, _ = seeded_sale(tenant, owner)
    assert client_for(staff, tenant).post(f'/api/v1/sales/{sale.pk}/void/', body, format='json').status_code == 403
    assert not SaleVoidRequest.objects.exists()


@pytest.mark.django_db(transaction=True)
def test_concurrent_identical_partial_returns_commit_one_receipt(tenant, owner, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from celery.app.task import Task
    from django.contrib.auth import get_user_model
    from django.db import close_old_connections, connections

    # Domain/ORM transactions are real; this test never contacts a delivery broker.
    monkeypatch.setattr(Task, 'apply_async', lambda *args, **kwargs: None)
    sale, item, variant = seeded_sale(tenant, owner)
    owner_id, tenant_id, item_id = owner.pk, tenant.pk, item.pk

    def submit():
        close_old_connections()
        try:
            actor = get_user_model().objects.get(pk=owner_id)
            shop = type(tenant).objects.get(pk=tenant_id)
            response = client_for(actor, shop).post(
                f'/api/v1/sales/items/{item_id}/void/',
                {'quantity': '1.250', 'reason': 'Concurrent return', 'idempotency_key': 'concurrent-original-key'},
                format='json',
            )
            return response.status_code, response.data.get('void_operation')
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: submit(), range(2)))
    assert [status for status, _ in results] == [200, 200]
    assert results[0][1] == results[1][1]
    item.refresh_from_db(); sale.refresh_from_db()
    assert item.voided_quantity == Decimal('1.250')
    assert sale.refunded_amount == Decimal('250.00')
    assert Stock.objects.get(product_variant=variant).quantity == Decimal('6.250')
    assert SaleRefund.objects.filter(sale=sale).count() == 1
    assert SaleVoidRequest.objects.filter(sale=sale).count() == 1
