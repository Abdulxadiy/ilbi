from decimal import Decimal

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from tests.factories import CategoryFactory, EmployeeFactory, OwnerFactory, ProductFactory, ProductVariantFactory, TenantFactory


@pytest.mark.django_db(transaction=True)
def test_legacy_partial_void_and_duplicate_keys_survive_migration():
    owner = OwnerFactory()
    tenant = TenantFactory(owner=owner)
    EmployeeFactory(user=owner, tenant=tenant, is_owner=True)
    variant = ProductVariantFactory(product=ProductFactory(category=CategoryFactory(tenant=tenant)))
    executor = MigrationExecutor(connection)
    leaves = executor.loader.graph.leaf_nodes()
    old_target = [('sales', '0012_debtpayment_branch')]
    try:
        executor.migrate(old_target)
        historical = executor.loader.project_state(old_target).apps
        Sale = historical.get_model('sales', 'Sale')
        Item = historical.get_model('sales', 'SaleItem')
        Log = historical.get_model('sales', 'SaleVoidLog')
        first = Sale.objects.create(tenant_id=tenant.pk, sold_by_id=owner.pk, receipt_number='legacy-1', public_token='legacy-public-1',
                                    currency='UZS', total_amount=100, status='partially_voided', idempotency_key='same')
        second = Sale.objects.create(tenant_id=tenant.pk, sold_by_id=owner.pk, receipt_number='legacy-2', public_token='legacy-public-2',
                                     currency='UZS', total_amount=0, status='completed', idempotency_key='same')
        item = Item.objects.create(tenant_id=tenant.pk, sale_id=first.pk, product_variant_id=variant.pk,
                                   quantity=2, voided_quantity=1, unit_price=100, total_price=200, cost_price=60,
                                   status='partially_voided')
        Log.objects.create(tenant_id=tenant.pk, sale_item_id=item.pk, quantity=1, reason='Legacy return', voided_by_id=owner.pk)
        executor = MigrationExecutor(connection)
        executor.migrate(leaves)
        from apps.sales.models import Sale as CurrentSale, SaleRefund
        from apps.cashbox.services.cashbox_service import CashboxService
        first = CurrentSale.objects.get(pk=first.pk)
        assert first.total_amount == Decimal('200')
        assert first.refunded_amount == Decimal('100')
        assert first.net_amount == Decimal('100')
        assert SaleRefund.objects.get(sale=first).amount == Decimal('100')
        assert CurrentSale.objects.get(pk=second.pk).idempotency_key is None
        assert CashboxService.get_current_shift_status(tenant)['expected_cash_uzs'] == Decimal('100')
    finally:
        MigrationExecutor(connection).migrate(leaves)
