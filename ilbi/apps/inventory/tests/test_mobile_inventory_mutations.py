from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.catalog.models import Category
from apps.inventory.models import InventoryMutationReceipt, Stock, StockBatch, StockMovement, TenantTransfer
from apps.inventory.services.stock_service import StockService
from apps.permissions.models import Permission
from apps.tenants.models import SellerProfile
from tests.factories import EmployeeFactory, ProductVariantFactory, StaffFactory, TenantFactory

pytestmark = pytest.mark.django_db
BASE = '/api/v1/inventory/'


def client(user, tenant):
    api = APIClient(); api.force_authenticate(user=user)
    api.credentials(HTTP_X_TENANT_ID=str(tenant.pk))
    return api


def movement_payload(variant, **extra):
    return {'product_variant_id': variant.pk, 'quantity': '1.250', 'note': 'Isolated inventory check', 'idempotency_key': str(uuid4()), **extra}


def test_capability_requires_tenant_permission(owner, tenant):
    assert client(owner, tenant).get(BASE + 'operations/capabilities/').json()['protocol'] == 'ilbi-inventory-idempotency-v1'
    staff = StaffFactory(); EmployeeFactory(user=staff, tenant=tenant)
    assert client(staff, tenant).get(BASE + 'operations/capabilities/').status_code == 403


def test_multi_line_intake_replay_keeps_original_movements_batches_cost_and_supplier(owner, tenant):
    one, two = ProductVariantFactory(tenant=tenant), ProductVariantFactory(tenant=tenant)
    api = client(owner, tenant)
    body = {'idempotency_key': str(uuid4()), 'supplier': 'Isolated supplier', 'faktura_number': 'TEST-ONLY', 'items': [
        {'product_variant_id': one.pk, 'quantity': '1.250', 'cost_price': '7.50', 'batch_code': 'B-1', 'expires_on': '2028-01-01'},
        {'product_variant_id': two.pk, 'quantity': '2.500', 'cost_price': '3.25', 'batch_code': 'B-2'},
    ]}
    first = api.post(BASE + 'intake/batch/', body, format='json'); assert first.status_code == 201, first.data
    replay = api.post(BASE + 'intake/batch/', body, format='json'); assert replay.status_code == 201, replay.data
    assert [row['id'] for row in replay.data] == [row['id'] for row in first.data]
    assert Stock.objects.get(product_variant=one).quantity == Decimal('1.250')
    assert Stock.objects.get(product_variant=two).last_cost_price == Decimal('3.25')
    assert StockMovement.objects.filter(tenant=tenant).count() == 2
    assert StockBatch.objects.get(product_variant=one).batch_code == 'B-1'
    assert StockBatch.objects.get(product_variant=one).supplier == 'Isolated supplier'
    assert InventoryMutationReceipt.objects.count() == 1
    changed = {**body, 'faktura_number': 'DIFFERENT'}
    assert api.post(BASE + 'intake/batch/', changed, format='json').status_code == 409
    assert StockMovement.objects.filter(tenant=tenant).count() == 2


@pytest.mark.parametrize('endpoint,direction,kind', [
    ('customer-return/', 'in', 'mijoz_qaytardi'),
    ('supplier-return/', 'out', 'yetkazib_beruvchiga_qaytarish'),
    ('write-off/', 'out', 'isrofgarchilik'),
    ('adjust/', 'out', 'tuzatish'),
])
def test_distinct_stock_operations_replay_once(endpoint, direction, kind, owner, tenant):
    variant = ProductVariantFactory(tenant=tenant)
    StockService.intake(tenant=tenant, product_variant=variant, quantity=Decimal('10'), cost_price=Decimal('5'), created_by=owner)
    body = movement_payload(variant, **({'direction': direction} if endpoint == 'adjust/' else {}))
    api = client(owner, tenant)
    first = api.post(BASE + endpoint, body, format='json'); assert first.status_code == 201, first.data
    replay = api.post(BASE + endpoint, body, format='json'); assert replay.status_code == 201, replay.data
    assert replay.data['id'] == first.data['id'] and replay.data['type'] == kind
    assert Stock.objects.get(product_variant=variant).quantity == (Decimal('11.250') if direction == 'in' else Decimal('8.750'))
    assert Stock.objects.get(product_variant=variant).last_cost_price == Decimal('5')
    assert StockMovement.objects.filter(tenant=tenant, type=kind).count() == 1


def test_rejected_write_rolls_back_receipt_and_stock(owner, tenant):
    variant = ProductVariantFactory(tenant=tenant)
    StockService.intake(tenant=tenant, product_variant=variant, quantity=Decimal('1'), cost_price=Decimal('5'), created_by=owner)
    api = client(owner, tenant); body = movement_payload(variant, quantity='2')
    assert api.post(BASE + 'write-off/', body, format='json').status_code == 400
    assert not InventoryMutationReceipt.objects.exists()
    assert Stock.objects.get(product_variant=variant).quantity == Decimal('1')
    assert StockMovement.objects.count() == 1


def test_batch_failure_is_atomic_and_foreign_variant_cannot_enter_stock(owner, tenant):
    own = ProductVariantFactory(tenant=tenant); foreign = ProductVariantFactory()
    body = {'idempotency_key': str(uuid4()), 'items': [
        {'product_variant_id': own.pk, 'quantity': '1', 'cost_price': '2'},
        {'product_variant_id': foreign.pk, 'quantity': '1', 'cost_price': '2'},
    ]}
    response = client(owner, tenant).post(BASE + 'intake/batch/', body, format='json')
    assert response.status_code == 400
    assert not InventoryMutationReceipt.objects.exists() and not StockMovement.objects.exists()


def test_key_cannot_cross_actor_or_operation_and_replay_reapplies_sensitive_field_permissions(owner, tenant):
    staff = StaffFactory(); member = EmployeeFactory(user=staff, tenant=tenant)
    member.permissions.add(Permission.objects.get(category='inventory', codename='add_stock_intake'))
    member.permissions.add(Permission.objects.get(category='catalog', codename='view_cost_price'))
    # Migration rollback tests can rebuild the older test permission seeds.
    supplier_permission, _ = Permission.objects.get_or_create(category='inventory', codename='view_supplier', defaults={'name': 'Yetkazib beruvchini ko‘rish'})
    member.permissions.add(supplier_permission)
    variant = ProductVariantFactory(tenant=tenant); body = movement_payload(variant, cost_price='2.50', supplier='Private supplier')
    api = client(staff, tenant); first = api.post(BASE + 'intake/', body, format='json'); assert first.status_code == 201, first.data
    assert first.data['cost_price'] == '2.50' and first.data['supplier'] == 'Private supplier'
    member.permissions.remove(*Permission.objects.filter(codename__in=['view_cost_price', 'view_supplier']))
    replay = api.post(BASE + 'intake/', body, format='json'); assert replay.status_code == 201, replay.data
    assert 'cost_price' not in replay.data and 'supplier' not in replay.data
    assert client(owner, tenant).post(BASE + 'intake/', body, format='json').status_code == 409
    assert client(owner, tenant).post(BASE + 'customer-return/', body, format='json').status_code == 409
    assert Stock.objects.get(product_variant=variant).quantity == Decimal('1.250')


def shops(owner, tenant):
    profile = SellerProfile.objects.create(owner=owner, legal_form='ytt', official_name='Isolated shop', tax_identifier='123456789', status='approved', expires_at=timezone.now() + timedelta(days=30))
    tenant.seller_profile = profile; tenant.save(update_fields=['seller_profile'])
    destination = TenantFactory(owner=owner, seller_profile=profile)
    EmployeeFactory(user=owner, tenant=destination, is_owner=True)
    target_category = Category.objects.create(tenant=destination, name='Target', kod='TARGET', currency='UZS')
    variant = ProductVariantFactory(tenant=tenant)
    StockService.intake(tenant=tenant, product_variant=variant, quantity=Decimal('10'), cost_price=Decimal('5'), created_by=owner)
    return destination, target_category, variant


def test_owner_transfer_and_physical_return_replay_without_duplicate_stock(owner, tenant):
    destination, category, variant = shops(owner, tenant)
    api = client(owner, tenant); identity = str(uuid4())
    body = {'idempotency_key': identity, 'request_key': identity, 'destination_tenant_id': destination.pk, 'items': [{'source_variant_id': variant.pk, 'quantity': '3', 'destination_category_id': category.pk}], 'note': 'Isolated transfer'}
    first = api.post(BASE + 'transfers/', body, format='json'); assert first.status_code == 201, first.data
    replay = api.post(BASE + 'transfers/', body, format='json'); assert replay.status_code == 201
    assert first.data['id'] == replay.data['id'] and replay.data['status'] == 'delivered_owner'
    assert Stock.objects.get(product_variant=variant).quantity == Decimal('7')
    line = TenantTransfer.objects.get(pk=first.data['id']).items.get()
    key = str(uuid4()); returned = {'idempotency_key': key, 'request_key': key, 'items': [{'original_item_id': line.pk, 'quantity': '1'}], 'note': 'Physical return'}
    receiver = client(owner, destination)
    result = receiver.post(BASE + f"transfers/{first.data['id']}/return/", returned, format='json'); assert result.status_code == 201, result.data
    again = receiver.post(BASE + f"transfers/{first.data['id']}/return/", returned, format='json'); assert again.status_code == 201
    assert result.data['id'] == again.data['id'] and result.data['kind'] == 'return'
    assert Stock.objects.get(product_variant=variant).quantity == Decimal('8')
    assert Stock.objects.get(product_variant=line.destination_variant).quantity == Decimal('2')
    paged = api.get(BASE + 'transfers/?page=1&page_size=1')
    assert paged.status_code == 200 and paged.data['count'] == 2 and len(paged.data['results']) == 1


def test_staff_partial_receive_discrepancy_close_and_replays(owner, tenant):
    destination, category, variant = shops(owner, tenant)
    sender = StaffFactory(); receiver = StaffFactory()
    for user, shop in [(sender, tenant), (receiver, destination)]:
        member = EmployeeFactory(user=user, tenant=shop)
        member.permissions.add(Permission.objects.get(category='inventory', codename='transfer_stock'))
    key = str(uuid4()); body = {'idempotency_key': key, 'request_key': key, 'destination_tenant_id': destination.pk, 'items': [{'source_variant_id': variant.pk, 'quantity': '3'}]}
    sent = client(sender, tenant).post(BASE + 'transfers/', body, format='json'); assert sent.status_code == 201, sent.data
    transfer = TenantTransfer.objects.get(pk=sent.data['id']); line = transfer.items.get()
    receive = {'idempotency_key': str(uuid4()), 'items': [{'item_id': line.pk, 'received_quantity': '2', 'destination_category_id': category.pk, 'discrepancy_reason': 'One missing'}]}
    api = client(receiver, destination); endpoint = BASE + f'transfers/{transfer.pk}/receive/'
    result = api.post(endpoint, receive, format='json'); assert result.status_code == 200, result.data
    assert api.post(endpoint, receive, format='json').status_code == 200
    assert Stock.objects.get(tenant=destination).quantity == Decimal('2')

    close = {'idempotency_key': str(uuid4()), 'reason': 'Checked and resolved'}; close_endpoint = BASE + f'transfers/{transfer.pk}/close-discrepancy/'
    assert client(sender, tenant).post(close_endpoint, close, format='json').status_code == 400
    assert client(owner, tenant).post(close_endpoint, close, format='json').status_code == 200
    assert client(owner, tenant).post(close_endpoint, close, format='json').status_code == 200
    transfer.refresh_from_db(); assert transfer.status == 'closed'
    assert Stock.objects.get(product_variant=variant).quantity == Decimal('7')
    assert Stock.objects.get(tenant=destination).quantity == Decimal('2')


def test_transfer_mapping_options_are_scoped_and_hide_other_store_categories_from_staff(owner, tenant):
    destination, category, _ = shops(owner, tenant)
    owner_data = client(owner, tenant).get(BASE + 'operations/transfer-options/').json()
    assert owner_data['targets'][0]['id'] == destination.pk
    assert category.pk in [row['id'] for row in owner_data['targets'][0]['categories']]
    staff = StaffFactory(); member = EmployeeFactory(user=staff, tenant=tenant)
    member.permissions.add(Permission.objects.get(category='inventory', codename='transfer_stock'))
    data = client(staff, tenant).get(BASE + 'operations/transfer-options/').json()
    assert data['targets'][0]['categories'] == []
    assert all(set(row) == {'id', 'name', 'currency'} for row in data['categories'])


def test_receipt_completion_failure_rolls_back_stock_and_batches(owner, tenant, monkeypatch):
    variant = ProductVariantFactory(tenant=tenant)
    original = InventoryMutationReceipt.save

    def fail_completed_receipt(receipt, *args, **kwargs):
        if receipt.resource_ids:
            raise RuntimeError('Isolated receipt write failure')
        return original(receipt, *args, **kwargs)

    monkeypatch.setattr(InventoryMutationReceipt, 'save', fail_completed_receipt)
    with pytest.raises(RuntimeError, match='receipt write failure'):
        client(owner, tenant).post(BASE + 'intake/', movement_payload(variant, cost_price='2.50'), format='json')
    assert not StockMovement.objects.exists()
    assert not StockBatch.objects.exists()
    assert not Stock.objects.filter(product_variant=variant).exists()
    assert not InventoryMutationReceipt.objects.exists()


@pytest.mark.django_db(transaction=True)
def test_concurrent_same_key_creates_one_stock_movement(owner, tenant):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from django.db import close_old_connections
    variant = ProductVariantFactory(tenant=tenant)
    body = movement_payload(variant, cost_price='2.50')
    barrier = Barrier(2)

    def send():
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            response = client(owner, tenant).post(BASE + 'intake/', body, format='json')
            return response.status_code, response.data
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: send(), range(2)))
    assert [code for code, _ in results] == [201, 201], results
    assert results[0][1]['id'] == results[1][1]['id']
    assert StockMovement.objects.filter(tenant=tenant).count() == 1
    assert Stock.objects.get(product_variant=variant).quantity == Decimal('1.250')
    assert InventoryMutationReceipt.objects.count() == 1
