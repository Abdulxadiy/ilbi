"""Mobile section saves use real tenant APIs with atomic stale-write protection."""

from decimal import Decimal
from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from apps.core.models import AuditAction, AuditLog
from apps.permissions.models import Permission
from apps.tenants.models import Tenant
from tests.factories import EmployeeFactory, ProductVariantFactory, StaffFactory, TenantFactory

pytestmark = pytest.mark.django_db
URL = '/api/v1/tenants/current/'


def client_for(user, tenant):
    client = APIClient()
    client.force_authenticate(user)
    client.credentials(HTTP_X_TENANT_ID=str(tenant.pk))
    return client


def revision(client):
    response = client.get(URL)
    assert response.status_code == 200
    value = response.data['settings_revision']
    assert len(value) == 64
    return f'"{value}"'


def test_section_patch_preserves_other_values_and_rejects_stale_revision(tenant, owner):
    tenant.telegram_group_id = '-10012345678'
    tenant.low_stock_weekday = 5
    tenant.save(update_fields=['telegram_group_id', 'low_stock_weekday'])
    client = client_for(owner, tenant)
    original = revision(client)
    first = client.patch(URL, {'receipt_footer': 'New footer'}, format='json', HTTP_IF_MATCH=original)
    assert first.status_code == 200 and first.data['settings_revision'] != original.strip('"')
    stale = client.patch(URL, {'vat_rate': '7'}, format='json', HTTP_IF_MATCH=original)
    assert stale.status_code == 412
    tenant.refresh_from_db()
    assert tenant.receipt_footer == 'New footer' and tenant.vat_rate == Decimal('12')
    assert tenant.telegram_group_id == '-10012345678' and tenant.low_stock_weekday == 5
    assert AuditLog.objects.filter(tenant=tenant, action=AuditAction.TENANT_UPDATE).count() == 1
    # Existing web/desktop clients retain the optional-header contract.
    assert client.patch(URL, {'notify_web_reports': False}, format='json').status_code == 200


def test_revision_is_tenant_bound_and_noop_does_not_change_it(tenant, owner):
    client = client_for(owner, tenant)
    original = revision(client)
    same = client.patch(URL, {'receipt_footer': tenant.receipt_footer}, format='json', HTTP_IF_MATCH=original)
    assert same.status_code == 200 and f'"{same.data["settings_revision"]}"' == original
    other = TenantFactory(owner=owner)
    EmployeeFactory(user=owner, tenant=other, is_owner=True)
    other_client = client_for(owner, other)
    assert other_client.patch(URL, {'receipt_footer': 'Cross-tenant revision'}, format='json', HTTP_IF_MATCH=original).status_code == 412
    other.refresh_from_db()
    assert other.receipt_footer != 'Cross-tenant revision'


@pytest.mark.parametrize('payload,field', [
    ({'low_stock_weekday': 0}, 'low_stock_weekday'),
    ({'low_stock_weekday': 8}, 'low_stock_weekday'),
    ({'low_stock_day_of_month': 0}, 'low_stock_day_of_month'),
    ({'low_stock_day_of_month': 32}, 'low_stock_day_of_month'),
    ({'telegram_group_id': 'https://t.me/invalid'}, 'telegram_group_id'),
    ({'daily_report_time': '25:01'}, 'daily_report_time'),
])
def test_invalid_operational_settings_return_field_errors(tenant, owner, payload, field):
    response = client_for(owner, tenant).patch(URL, payload, format='json')
    assert response.status_code == 400 and field in response.data.get('error', {}).get('details', response.data)


def test_delegated_settings_scope_and_revocation_remain_authoritative(tenant):
    staff = StaffFactory()
    employee = EmployeeFactory(user=staff, tenant=tenant)
    client = client_for(staff, tenant)
    assert client.patch(URL, {'address': 'No permission'}, format='json').status_code == 403
    employee.permissions.add(Permission.objects.get(category='tenants', codename='manage_settings'))
    current = client.get(URL)
    assert current.status_code == 200 and 'owner_details' not in current.data
    assert client.patch(URL, {'address': 'Allowed'}, format='json', HTTP_IF_MATCH=revision(client)).status_code == 200
    employee.permissions.clear()
    assert client.patch(URL, {'address': 'Revoked'}, format='json').status_code == 403
    tenant.refresh_from_db()
    assert tenant.address == 'Allowed'


def test_loading_and_saving_preferences_never_sends_a_message(tenant, owner):
    client = client_for(owner, tenant)
    with patch('apps.tg_bot.services.send_telegram_message') as send, patch('apps.cashbox.tasks.send_daily_report_for_tenant_task') as daily, patch('apps.inventory.tasks.send_low_stock_report_for_tenant_task') as stock:
        assert client.get(URL).status_code == 200
        result = client.patch(URL, {'telegram_group_id': '@ilbi_test_group', 'notify_on_sale': True, 'low_stock_frequency': 'weekly', 'low_stock_weekday': 7}, format='json', HTTP_IF_MATCH=revision(client))
        assert result.status_code == 200
        send.assert_not_called(); daily.assert_not_called(); stock.assert_not_called()


def test_receipt_settings_patch_preserves_old_sale_snapshot(tenant, owner, settings):
    from apps.inventory.services import StockService
    from apps.sales.services import SaleService

    settings.DEBUG = True  # Explicit local non-fiscal sales sandbox; production guard stays intact.
    variant = ProductVariantFactory(tenant=tenant, product__tenant=tenant, product__category__tenant=tenant, price_recommended='200.00')
    StockService.intake(tenant=tenant, product_variant=variant, quantity=Decimal('10'), cost_price=Decimal('100'), created_by=owner)
    def sale():
        return SaleService.create_sale(tenant=tenant, user=owner, items_data=[{'product_variant_id': variant.pk, 'quantity': '1', 'unit_price': '200'}], payment_type='cash')[0]
    original = sale()
    snapshot = dict(original.receipt_snapshot)
    client = client_for(owner, tenant)
    result = client.patch(URL, {'receipt_footer': 'New receipt only', 'tax_regime': 'general', 'is_vat_payer': True, 'vat_rate': '6.00', 'price_includes_vat': False}, format='json', HTTP_IF_MATCH=revision(client))
    assert result.status_code == 200
    original.refresh_from_db(); tenant.refresh_from_db()
    assert original.receipt_snapshot == snapshot and original.total_amount == Decimal('200.00')
    new = sale()
    assert new.receipt_snapshot['receipt_footer'] == 'New receipt only'
    assert new.total_amount == Decimal('212.00')


@pytest.mark.django_db(transaction=True)
def test_concurrent_same_revision_has_one_winner(tenant, owner, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from celery.app.task import Task
    from django.contrib.auth import get_user_model
    from django.db import close_old_connections, connections

    monkeypatch.setattr(Task, 'apply_async', lambda *args, **kwargs: None)
    original = revision(client_for(owner, tenant))
    owner_id, tenant_id = owner.pk, tenant.pk
    def save(footer):
        close_old_connections()
        try:
            actor = get_user_model().objects.get(pk=owner_id)
            shop = Tenant.objects.get(pk=tenant_id)
            return client_for(actor, shop).patch(URL, {'receipt_footer': footer}, format='json', HTTP_IF_MATCH=original).status_code
        finally:
            connections.close_all()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(save, ['First footer', 'Second footer']))
    assert sorted(results) == [200, 412]
    assert AuditLog.objects.filter(tenant=tenant, action=AuditAction.TENANT_UPDATE).count() == 1
