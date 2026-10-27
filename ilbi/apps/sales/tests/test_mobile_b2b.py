from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

import pytest
from rest_framework.test import APIClient

from apps.inventory.models import Stock
from apps.inventory.services import StockService
from apps.sales.models import B2BMutationReceipt, DebtPayment
from apps.sales.services import SaleService
from tests.factories import (
    CategoryFactory,
    CounterpartyFactory,
    EmployeeFactory,
    OwnerFactory,
    ProductVariantFactory,
    StaffFactory,
    TenantFactory,
)

pytestmark = pytest.mark.django_db


def client(user, tenant):
    result = APIClient()
    result.force_authenticate(user)
    result.credentials(HTTP_X_TENANT_ID=str(tenant.pk))
    return result


@pytest.fixture
def transfer(tenant, owner):
    recipient = OwnerFactory()
    destination = TenantFactory(owner=recipient)
    EmployeeFactory(user=recipient, tenant=destination, is_owner=True, is_active=True)
    category = CategoryFactory(tenant=destination, currency='UZS')
    variant = ProductVariantFactory(
        tenant=tenant, product__tenant=tenant, product__category__tenant=tenant,
        product__category__currency='UZS', unit='kg', price_recommended='200.00',
    )
    StockService.intake(
        tenant=tenant, product_variant=variant, quantity=Decimal('10'), cost_price=Decimal('100'), created_by=owner,
    )
    customer = CounterpartyFactory(tenant=tenant, target_tenant=destination)
    sale = SaleService.create_sale(
        tenant=tenant, user=owner, items_data=[
            {'product_variant_id': variant.pk, 'quantity': '5.000', 'unit_price': '200.00'},
        ], payment_type='debt', counterparty=customer,
    )[0]
    return sale, sale.items.get(), variant, customer, destination, recipient, category


def path(sale, suffix):
    return f'/api/v1/sales/b2b/{sale.pk}/{suffix}/'


def accept(item, category, quantity='1.250'):
    return {'operation_id': str(uuid4()), 'items': [{
        'sale_item_id': item.pk, 'accepted_quantity': quantity, 'target_category_id': category.pk,
    }]}


def test_capability_lists_detail_and_account_scope(transfer, tenant, owner):
    sale, item, _, _, destination, recipient, _ = transfer
    source, target = client(owner, tenant), client(recipient, destination)
    assert source.get('/api/v1/sales/b2b/capabilities/').data['b2b_mutations'] == 1
    assert source.get('/api/v1/sales/b2b/outgoing/', {'page': 1}).data['results'][0]['id'] == sale.pk
    incoming = target.get('/api/v1/sales/b2b/inbox/', {'page': 1, 'all_statuses': 'true'})
    assert incoming.data['count'] == 1
    detail = target.get(f'/api/v1/sales/b2b/{sale.pk}/')
    assert detail.data['direction'] == 'incoming'
    assert detail.data['sale']['items'][0]['id'] == item.pk
    assert 'cost_price' not in detail.data['sale']['items'][0]
    foreign_owner = OwnerFactory()
    foreign = TenantFactory(owner=foreign_owner)
    EmployeeFactory(tenant=foreign, user=foreign_owner, is_owner=True)
    assert client(foreign_owner, foreign).get(f'/api/v1/sales/b2b/{sale.pk}/').status_code == 404
    assert source.get('/api/v1/sales/b2b/outgoing/', {'status': 'invalid'}).status_code == 400


def test_partial_accept_original_key_replay_changes_stock_once(transfer):
    sale, item, _, _, destination, recipient, category = transfer
    target = client(recipient, destination)
    payload = accept(item, category)
    first = target.post(path(sale, 'accept'), payload, format='json')
    assert first.status_code == 200
    again = target.post(path(sale, 'accept'), payload, format='json')
    assert again.status_code == 200 and first.data['b2b_operation'] == again.data['b2b_operation']
    item.refresh_from_db()
    assert item.b2b_accepted_quantity == Decimal('1.250')
    assert Stock.objects.get(product_variant=item.b2b_target_variant).quantity == Decimal('1.250')
    assert B2BMutationReceipt.objects.count() == 1
    assert target.post(path(sale, 'accept'), accept(item, category), format='json').status_code == 200
    item.refresh_from_db()
    assert item.b2b_accepted_quantity == Decimal('2.500')


def test_completed_accept_replays_original_ack_and_resolved_inbox_is_available(transfer):
    sale, item, _, _, destination, recipient, category = transfer
    target = client(recipient, destination)
    payload = accept(item, category, '5.000')
    assert target.post(path(sale, 'accept'), payload, format='json').status_code == 200
    assert target.post(path(sale, 'accept'), payload, format='json').status_code == 200
    assert target.get('/api/v1/sales/b2b/inbox/').data == []
    assert len(target.get('/api/v1/sales/b2b/inbox/', {'all_statuses': 'true'}).data) == 1
    assert B2BMutationReceipt.objects.count() == 1


def test_same_key_rejects_changed_payload_and_another_actor(transfer):
    from apps.permissions.models import Permission
    sale, item, _, _, destination, recipient, category = transfer
    target = client(recipient, destination)
    payload = accept(item, category)
    assert target.post(path(sale, 'accept'), payload, format='json').status_code == 200
    changed = {**payload, 'items': [{**payload['items'][0], 'accepted_quantity': '2.000'}]}
    assert target.post(path(sale, 'accept'), changed, format='json').status_code == 409
    staff = StaffFactory()
    membership = EmployeeFactory(tenant=destination, user=staff, is_active=True)
    membership.permissions.add(Permission.objects.get(category='sales', codename='manage_b2b'))
    assert client(staff, destination).post(path(sale, 'accept'), payload, format='json').status_code == 409
    item.refresh_from_db()
    assert item.b2b_accepted_quantity == Decimal('1.250')


def test_receipt_failure_rolls_back_accept_stock_and_notifications(transfer):
    sale, item, _, _, destination, recipient, category = transfer
    from apps.sales.models import Notification
    before = Notification.objects.count()
    with patch('api.v1.sales.b2b_idempotency.B2BMutationReceipt.objects.create', side_effect=RuntimeError('receipt')):
        with pytest.raises(RuntimeError):
            client(recipient, destination).post(path(sale, 'accept'), accept(item, category), format='json')
    item.refresh_from_db()
    assert item.b2b_accepted_quantity == 0
    assert not Stock.objects.filter(tenant=destination).exists()
    assert Notification.objects.count() == before


def test_reject_physical_return_and_discrepancy_replay_finances_once(transfer, tenant, owner):
    sale, item, variant, customer, destination, recipient, _ = transfer
    target, source = client(recipient, destination), client(owner, tenant)
    reject = {'operation_id': str(uuid4()), 'reason': 'Qaytadi'}
    assert target.post(path(sale, 'reject'), reject, format='json').status_code == 200
    assert target.post(path(sale, 'reject'), reject, format='json').status_code == 200
    for action in ['returns/receive', 'returns/close-discrepancy']:
        key = str(uuid4())
        payload = {'operation_id': key, 'idempotency_key': key, 'reason': 'Tekshirildi', 'items': [{
            'sale_item_id': item.pk, 'quantity': '1.250',
        }]}
        first = source.post(path(sale, action), payload, format='json')
        again = source.post(path(sale, action), payload, format='json')
        assert first.status_code == again.status_code == 200
        assert first.data['b2b_operation'] == again.data['b2b_operation']
    item.refresh_from_db()
    sale.refresh_from_db()
    customer.refresh_from_db()
    assert item.b2b_return_pending_quantity == Decimal('2.500')
    assert item.b2b_rejected_quantity == item.b2b_discrepancy_closed_quantity == Decimal('1.250')
    assert Stock.objects.get(product_variant=variant).quantity == Decimal('6.250')
    assert sale.refunded_amount == Decimal('500.00')
    assert customer.debt_balance_uzs == Decimal('500.00')
    assert DebtPayment.objects.filter(counterparty=customer, is_correction=True).count() == 2
    assert B2BMutationReceipt.objects.count() == 3


def test_invalid_operation_uuid_does_not_mutate_or_record(transfer):
    sale, item, _, _, destination, recipient, category = transfer
    payload = {**accept(item, category), 'operation_id': 'bad'}
    assert client(recipient, destination).post(path(sale, 'accept'), payload, format='json').status_code == 400
    assert not B2BMutationReceipt.objects.exists()
    item.refresh_from_db()
    assert item.b2b_accepted_quantity == 0


def test_mapping_is_tenant_currency_unit_scoped_and_never_exposes_prices(transfer):
    from apps.permissions.models import Permission
    _, _, _, _, destination, _, category = transfer
    staff = StaffFactory()
    membership = EmployeeFactory(tenant=destination, user=staff, is_active=True)
    membership.permissions.add(Permission.objects.get(category='sales', codename='manage_b2b'))
    local = ProductVariantFactory(
        tenant=destination, product__tenant=destination, product__category=category,
        unit='kg', price_recommended='250.00',
    )
    ProductVariantFactory(tenant=destination, product__tenant=destination, product__category=category, unit='dona')
    foreign = ProductVariantFactory(unit='kg')
    target = client(staff, destination)
    response = target.get('/api/v1/sales/b2b/mapping/variants/', {'currency': 'UZS', 'unit': 'kg', 'page': 1})
    assert response.status_code == 200
    assert [row['id'] for row in response.data['results']] == [local.pk]
    assert foreign.pk != local.pk
    assert set(response.data['results'][0]) == {'id', 'name', 'currency', 'unit'}
    categories = target.get('/api/v1/sales/b2b/mapping/categories/', {'currency': 'UZS'})
    assert categories.status_code == 200 and categories.data['results'][0]['id'] == category.pk
    assert target.get('/api/v1/sales/b2b/mapping/variants/', {'currency': 'bad'}).status_code == 400


@pytest.mark.django_db(transaction=True)
def test_simultaneous_same_key_acceptance_is_applied_once(transfer):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections

    sale, item, _, _, destination, recipient, category = transfer
    payload = accept(item, category)
    barrier = Barrier(2)

    def send():
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            response = client(recipient, destination).post(path(sale, 'accept'), payload, format='json')
            return response.status_code, response.data.get('b2b_operation')
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(send)
        second = pool.submit(send)
        results = [first.result(timeout=20), second.result(timeout=20)]
    assert results[0][0] == results[1][0] == 200
    assert results[0][1] == results[1][1]
    item.refresh_from_db()
    assert item.b2b_accepted_quantity == Decimal('1.250')
    assert Stock.objects.get(product_variant=item.b2b_target_variant).quantity == Decimal('1.250')
    assert B2BMutationReceipt.objects.count() == 1
