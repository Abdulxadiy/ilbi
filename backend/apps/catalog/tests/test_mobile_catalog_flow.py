"""Mobile-sized catalog requests against real serializers and isolated PostgreSQL."""
from decimal import Decimal

import pytest
from rest_framework.test import APIClient
from django.test import override_settings

from apps.inventory.services import StockService
from apps.catalog.models import ProductVariant

pytestmark = pytest.mark.django_db


def test_mobile_product_variant_prices_and_lifecycle(owner, tenant):
    client = APIClient()
    client.force_authenticate(user=owner)
    client.credentials(HTTP_X_TENANT_ID=str(tenant.id))
    category = client.post('/api/v1/catalog/categories/', {'name': 'Mobile flow food'}, format='json')
    assert category.status_code == 201, category.data
    prices = {'price_recommended': '11.50', 'price_min': '10.00', 'price_partner': '9.75'}
    created = client.post('/api/v1/catalog/products/', {
        'name': 'Mobile rice', 'category_id': category.data['id'], 'variant_name': 'Small', 'unit': 'kg',
        'code': '000123', 'barcode': '4780000000123', 'mxik': '00000000000000001', 'package_code': '0000123', **prices,
    }, format='json')
    assert created.status_code == 201, created.data
    product_id = created.data['id']
    first = created.data['variants'][0]
    assert first['product'] == product_id
    assert first['mxik'] == '00000000000000001' and first['package_code'] == '0000123'
    assert first['code'] == '000123' and first['price_recommended'] == '11.50'
    second = client.post(f'/api/v1/catalog/products/{product_id}/variants/', {'name': 'Large', 'unit': 'kg', **prices}, format='json')
    assert second.status_code == 201, second.data
    changed = client.patch(f'/api/v1/catalog/variants/{first["id"]}/', {'price_recommended': '12.25', 'name': 'Small edited'}, format='json')
    assert changed.status_code == 200, changed.data
    assert changed.data['price_recommended'] == '12.25'
    assert ProductVariant.objects.get(pk=second.data['id']).price_recommended == Decimal('11.50')
    listed = client.get('/api/v1/catalog/variants/', {'page': 1, 'category': category.data['id'], 'barcode': first['barcode']})
    assert [v['id'] for v in listed.data['results']] == [first['id']]
    for kind, identifier in (('variants', second.data['id']), ('products', product_id)):
        archived = client.post(f'/api/v1/catalog/{kind}/{identifier}/archive/', {}, format='json')
        assert archived.status_code == 200 and archived.data['is_active'] is False
        unavailable = client.get('/api/v1/catalog/variants/', {'ids': identifier if kind == 'variants' else first['id']})
        assert unavailable.data == []
        restored = client.post(f'/api/v1/catalog/{kind}/{identifier}/unarchive/', {}, format='json')
        assert restored.status_code == 200 and restored.data['is_active'] is True
    variant = ProductVariant.objects.get(pk=first['id'])
    StockService.intake(tenant=tenant, product_variant=variant, quantity=Decimal('1.125'), cost_price=Decimal('5'), created_by=owner)
    archived_with_history = client.delete(f'/api/v1/catalog/products/{product_id}/')
    assert archived_with_history.status_code == 204, archived_with_history.data
    detail = client.get(f'/api/v1/catalog/products/{product_id}/')
    assert detail.status_code == 200 and len(detail.data['variants']) == 2
    assert detail.data['is_active'] is False
    assert all(v['is_active'] is False for v in detail.data['variants'])
    assert detail.data['variants'][0]['stock_quantity'] == '1.125'


@override_settings(DEBUG=True)
def test_mobile_catalog_edits_preserve_negotiated_receipt_and_history(owner, tenant):
    """Explicit local nonfiscal sandbox; production fiscal gate stays enabled."""
    from tests.factories import CategoryFactory, ProductFactory, ProductVariantFactory
    category = CategoryFactory(tenant=tenant)
    product = ProductFactory(tenant=tenant, category=category, name='Original name')
    variant = ProductVariantFactory(tenant=tenant, product=product, name='Original variant', price_min=Decimal('10'), price_partner=Decimal('9'), price_recommended=Decimal('12'))
    StockService.intake(tenant=tenant, product_variant=variant, quantity=Decimal('5'), cost_price=Decimal('1'), created_by=owner)
    client = APIClient()
    client.force_authenticate(user=owner)
    client.credentials(HTTP_X_TENANT_ID=str(tenant.id))
    sold = client.post('/api/v1/sales/', {'items': [{'product_variant_id': variant.id, 'quantity': '0.125', 'unit_price': '2.00'}], 'payment_type': 'cash', 'idempotency_key': 'mobile-below-advisory-price'}, format='json')
    assert sold.status_code == 201, sold.data
    sale_id = sold.data[0]['id']
    assert client.patch(f'/api/v1/catalog/products/{product.id}/', {'name': 'New catalog name'}, format='json').status_code == 200
    assert client.patch(f'/api/v1/catalog/variants/{variant.id}/', {'name': 'New variant', 'price_min': '50.00', 'price_recommended': '60.00'}, format='json').status_code == 200
    assert client.delete(f'/api/v1/catalog/products/{product.id}/').status_code == 204
    receipt = client.get(f'/api/v1/sales/{sale_id}/')
    assert receipt.status_code == 200, receipt.data
    line = receipt.data['items'][0]
    assert line['product_name'] == 'Original name' and line['product_variant_name'] == 'Original variant'
    assert line['unit_price'] == '2.00' and line['total_price'] == '0.25'
    restored = client.post(f'/api/v1/catalog/products/{product.id}/unarchive/', {}, format='json')
    assert restored.status_code == 200 and restored.data['is_active'] is True
