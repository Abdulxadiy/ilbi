from django.db import connection
from django.test.utils import CaptureQueriesContext
import pytest
from rest_framework.test import APIClient
from apps.cashbox.models import CashExpense, CashIncome, DailyCashReport

pytestmark = pytest.mark.django_db

@pytest.fixture
def client(owner, tenant):
    client = APIClient()
    client.force_authenticate(owner)
    return client

@pytest.mark.parametrize('kind', ['expenses', 'income', 'reports'])
def test_cashbox_bounded_pages_and_queries(client, tenant, owner, kind):
    for index in range(25):
        if kind == 'expenses':
            CashExpense.objects.create(tenant=tenant, recorded_by=owner, amount=index+1, category=f'Entry {index}')
        elif kind == 'income':
            CashIncome.objects.create(tenant=tenant, recorded_by=owner, amount=index+1, source=f'Entry {index}')
        else:
            DailyCashReport.objects.create(tenant=tenant, closed_by=owner, staff_notes=f'Entry {index}')
    url = f'/api/v1/cashbox/{kind}/'
    with CaptureQueriesContext(connection) as small:
        response = client.get(url, {'page':1, 'page_size':1})
    assert response.status_code == 200
    with CaptureQueriesContext(connection) as large:
        first = client.get(url, {'page':1, 'page_size':20})
    assert len(small) == len(large)
    assert first.data['count'] == 25
    assert len(first.data['results']) == 20
    second = client.get(url, {'page':2, 'page_size':20})
    assert len(second.data['results']) == 5
    assert not ({r['id'] for r in first.data['results']} & {r['id'] for r in second.data['results']})
    assert client.get(url, {'page':1, 'search':'Entry 24'}).data['count'] == 1
    if kind == 'reports':
        assert 'expenses' not in first.data['results'][0]
        detail = client.get(f"{url}{first.data['results'][0]['id']}/")
        assert 'expenses' in detail.data and 'incomes' in detail.data


def test_dashboard_inventory_queries_and_totals(tenant):
    from apps.analytics.services.analytics_service import AnalyticsService
    from apps.inventory.models import Stock
    from tests.factories import CategoryFactory, ProductFactory, ProductVariantFactory
    with CaptureQueriesContext(connection) as empty:
        AnalyticsService.get_dashboard_summary(tenant=tenant)
    category = CategoryFactory(tenant=tenant)
    for _ in range(20):
        product = ProductFactory(tenant=tenant, category=category)
        variant = ProductVariantFactory(product=product, price_partner=8, price_min=10, price_recommended=20)
        Stock.objects.create(tenant=tenant, product_variant=variant, quantity=2, last_cost_price=5)
    with CaptureQueriesContext(connection) as populated:
        summary = AnalyticsService.get_dashboard_summary(tenant=tenant)
    assert len(empty) == len(populated)
    assert summary['store_overview']['inventory_cost_value_uzs'] == '200.00'
    assert summary['store_overview']['inventory_retail_value_uzs'] == '800.00'
    assert summary['store_overview']['inventory_total_qty'] == '40'


def test_sales_tenant_join_has_constant_queries(client, tenant, owner):
    from tests.factories import SaleFactory
    SaleFactory.create_batch(21, tenant=tenant, sold_by=owner)
    with CaptureQueriesContext(connection) as small:
        client.get('/api/v1/sales/', {'page':1, 'page_size':1})
    with CaptureQueriesContext(connection) as large:
        response = client.get('/api/v1/sales/', {'page':1, 'page_size':20})
    assert response.status_code == 200
    assert len(response.data['results']) == 20
    assert response.data['results'][0]['tenant_name'] == tenant.name
    assert len(small) == len(large)


def test_debt_pages_summary_and_latest_payment(client, tenant, owner):
    from unittest.mock import patch
    from api.v1.sales.serializers import CounterpartyOutputSerializer
    from tests.factories import CounterpartyFactory, DebtPaymentFactory, SaleFactory
    cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs=100)
    CounterpartyFactory.create_batch(24, tenant=tenant, debt_balance_uzs=10)
    DebtPaymentFactory.create_batch(100, counterparty=cp, recorded_by=owner)
    loaded = []
    original = CounterpartyOutputSerializer.get_last_payment
    def track(serializer, obj):
        loaded.append(len(obj.prefetched_payments))
        return original(serializer, obj)
    with patch.object(CounterpartyOutputSerializer, 'get_last_payment', track):
        response = client.get('/api/v1/sales/counterparties/', {'page':1, 'search':cp.phone_number})
    assert response.status_code == 200
    assert loaded == [1]
    assert response.data['count'] == 1
    assert response.data['summary']['total_count'] == 25
    assert response.data['summary']['total_debt_uzs'] == 340
    SaleFactory.create_batch(25, tenant=tenant, sold_by=owner, counterparty=cp, total_amount=10, payment_type='debt')
    url = f'/api/v1/sales/counterparties/{cp.pk}/'
    sales = client.get(url+'sales/', {'page':2, 'page_size':20, 'payment_type':'debt'})
    assert sales.status_code == 200
    assert len(sales.data['results']) == 5
    assert sales.data['summary']['total_spent_uzs'] == 250
    assert sales.data['summary']['total_sales_count'] == 25
    payments = client.get(url+'payments/', {'page':2, 'page_size':20})
    assert payments.data['count'] == 100
    assert len(payments.data['results']) == 20
    assert client.get('/api/v1/sales/counterparties/', {'page':1, 'balance_status':'settled'}).data['count'] == 0
    export = client.get('/api/v1/sales/counterparties/export/', {'search': cp.phone_number})
    assert export.status_code == 200


def test_b2b_pages_and_bulk_barcode_scope(client, tenant, owner):
    from tests.factories import SaleFactory, TenantFactory, ProductVariantFactory
    source = TenantFactory()
    SaleFactory.create_batch(25, tenant=source, sold_by=source.owner, b2b_target_tenant=tenant, status='b2b_pending')
    incoming = client.get('/api/v1/sales/b2b/inbox/', {'page':2, 'page_size':20})
    assert incoming.status_code == 200
    assert incoming.data['count'] == 25
    assert len(incoming.data['results']) == 5
    SaleFactory.create_batch(25, tenant=tenant, sold_by=owner, b2b_target_tenant=source)
    outgoing = client.get('/api/v1/sales/', {'page':2, 'b2b_only':'true'})
    assert len(outgoing.data['results']) == 5
    assert outgoing.data['summary']['total_count'] == 25
    assert client.get('/api/v1/sales/b2b/inbox/', {'page':1,'search':'not-existing-source'}).data['count'] == 0
    first = ProductVariantFactory(tenant=tenant, barcode='bulk-1')
    second = ProductVariantFactory(tenant=tenant, barcode='bulk-2')
    ProductVariantFactory(tenant=source, barcode='bulk-foreign')
    result = client.get('/api/v1/catalog/variants/', {'barcodes':'bulk-1,bulk-2,bulk-foreign'})
    assert {v['id'] for v in result.data} == {first.pk, second.pk}


def test_compact_shift_and_notification_history(client, tenant, owner):
    from apps.sales.models import Notification
    from tests.factories import TenantFactory
    CashIncome.objects.create(tenant=tenant, recorded_by=owner, amount=7, source='test')
    compact = client.get('/api/v1/cashbox/shift/current/', {'compact':'true'})
    assert compact.status_code == 200
    assert 'incomes' not in compact.data and 'expenses' not in compact.data
    full = client.get('/api/v1/cashbox/shift/current/')
    assert 'incomes' in full.data
    assert compact.data['expected_cash_uzs'] == full.data['expected_cash_uzs']
    for i in range(45):
        Notification.objects.create(tenant=tenant, recipient=owner, type='low_stock_alert', title=f'Alert {i}', message='audit')
    other = Notification.objects.create(tenant=TenantFactory(), recipient=owner, type='low_stock_alert', title='Other', message='audit')
    first = client.get('/api/v1/sales/notifications/', {'page':1,'page_size':20})
    assert len(first.data['results']) == 20
    assert first.data['unread_count'] == 45
    cursor = first.data['next_before_id']
    older = client.get('/api/v1/sales/notifications/', {'page':1,'before_id':cursor})
    assert len(older.data['results']) == 20
    assert not ({n['id'] for n in first.data['results']} & {n['id'] for n in older.data['results']})
    newest = max(n['id'] for n in first.data['results'])
    empty = client.get('/api/v1/sales/notifications/', {'page':1,'after_id':newest})
    assert empty.data['results'] == [] and empty.data['unread_count'] == 45
    assert client.post('/api/v1/sales/notifications/read-all/').status_code == 200
    assert Notification.objects.filter(tenant=tenant, recipient=owner, is_read=False).count() == 0
    other.refresh_from_db()
    assert not other.is_read


def test_admin_tenant_pages_search_and_global_counts(client, platform_admin):
    from tests.factories import TenantFactory
    client.force_authenticate(platform_admin)
    entries = TenantFactory.create_batch(25)
    last = entries[0]
    last.name = 'Search outside first page'
    last.is_active = False
    last.save(update_fields=['name','is_active'])
    first = client.get('/api/v1/tenants/', {'page':1,'page_size':20})
    assert first.status_code == 200
    assert len(first.data['results']) == 20
    assert last.pk not in {row['id'] for row in first.data['results']}
    second = client.get('/api/v1/tenants/', {'page':2,'page_size':20})
    assert last.pk in {row['id'] for row in second.data['results']}
    found = client.get('/api/v1/tenants/', {'search':last.name,'compact':'true','page':1})
    assert found.data['count'] == 1
    assert found.data['results'] == [{'id':last.pk,'name':last.name,'is_active':False}]
    assert found.data['summary'] == first.data['summary']
    assert found.data['summary']['inactive_count'] == 1
    selected = client.get('/api/v1/tenants/', {'id':last.pk, 'compact':'true','page':1,'page_size':1})
    assert selected.data['results'][0]['id'] == last.pk
    assert client.get('/api/v1/tenants/', {'id':'bad'}).status_code == 400
