from decimal import Decimal

import pytest

from api.v1.sales.serializers import PublicReceiptSerializer, SaleOutputSerializer
from apps.analytics.services.analytics_service import AnalyticsService
from apps.inventory.services import StockService
from apps.sales.models import Sale
from apps.sales.services.sale_service import SaleService, SaleServiceError
from apps.sales.services.void_service import VoidService
from apps.sales.taxes import calculate_line
from apps.tenants.receipt_settings import receipt_settings
from tests.factories import CategoryFactory, CounterpartyFactory, ProductFactory, ProductVariantFactory

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize(
    "included,rate,price,net,tax,total",
    [
        (True, "12", "112000", "100000", "12000", "112000"),
        (False, "12", "100000", "100000", "12000", "112000"),
        (True, "0", "100000", "100000", "0", "100000"),
        (False, "6", "100000", "100000", "6000", "106000"),
        (False, "12", "0.05", "0.05", "0.01", "0.06"),
    ],
)
def test_line_tax_arithmetic(included, rate, price, net, tax, total):
    assert calculate_line(
        quantity=1, unit_price=price, is_vat_payer=True, vat_rate=rate, price_includes_vat=included
    ) == tuple(Decimal(v) for v in (net, tax, total))


@pytest.fixture
def stocked(tenant, owner):
    category = CategoryFactory(tenant=tenant, currency="UZS")
    product = ProductFactory(tenant=tenant, category=category)
    variant = ProductVariantFactory(tenant=tenant, product=product, price_recommended="100000.00")
    StockService.intake(tenant=tenant, product_variant=variant, quantity=10, cost_price=50000, created_by=owner)
    return variant


def configure(tenant, **values):
    for key, value in values.items():
        setattr(tenant, key, value)
    tenant.save(update_fields=list(values))


def create(tenant, owner, stocked, **kwargs):
    return SaleService.create_sale(
        tenant=tenant,
        user=owner,
        items_data=[{"product_variant_id": stocked.pk, "quantity": "2", "unit_price": "100000.00"}],
        **kwargs,
    )[0]


def test_exclusive_vat_is_charged_and_preserved_on_refund(tenant, owner, stocked):
    configure(tenant, tax_regime="general", is_vat_payer=True, vat_rate=Decimal("12"), price_includes_vat=False)
    cp = CounterpartyFactory(tenant=tenant)
    sale = create(tenant, owner, stocked, payment_type="debt", counterparty=cp)
    assert (sale.subtotal_amount, sale.tax_amount, sale.total_amount) == (200000, 24000, 224000)
    cp.refresh_from_db()
    assert cp.debt_balance_uzs == 224000
    item = sale.items.get()
    assert (item.unit_price, item.tax_rate, item.tax_amount, item.total_price) == (100000, 12, 24000, 224000)
    dashboard = AnalyticsService.get_dashboard_summary(tenant=tenant)
    assert dashboard["kpi"]["debt_sales_uzs"] == "224000.00"
    assert dashboard["kpi"]["net_profit_uzs"] == "100000.00"
    VoidService.void_sale_item(sale_item=item, user=owner, quantity=Decimal("1"), reason="Return")
    sale.refresh_from_db()
    cp.refresh_from_db()
    assert sale.refunded_amount == cp.debt_balance_uzs == 112000
    item.refresh_from_db()
    VoidService.void_sale_item(sale_item=item, user=owner, quantity=Decimal("1"), reason="Rest")
    sale.refresh_from_db()
    assert sale.refunded_amount == sale.total_amount


def test_snapshot_and_replay_ignore_later_settings_changes(tenant, owner, stocked):
    configure(
        tenant,
        tax_regime="general",
        is_vat_payer=True,
        vat_rate=Decimal("12"),
        receipt_header="Original header",
        address="Original address",
    )
    expectation = {key: receipt_settings(tenant)[key] for key in ("is_vat_payer", "vat_rate", "price_includes_vat")}
    sale = create(tenant, owner, stocked, idempotency_key="tax-replay", expected_tax_settings=expectation)
    original = dict(sale.receipt_snapshot)
    configure(tenant, vat_rate=Decimal("6"), receipt_header="Changed", address="New address")
    sale.refresh_from_db()
    assert sale.receipt_snapshot == original
    assert original["vat_rate"] == "12.00"
    assert original["receipt_header"] == "Original header"
    assert create(tenant, owner, stocked, idempotency_key="tax-replay", expected_tax_settings=expectation).pk == sale.pk
    assert PublicReceiptSerializer(sale).data["receipt_snapshot"] == {
        key: value for key, value in original.items() if key != "document_parties"
    }
    assert "document_parties" not in PublicReceiptSerializer(sale).data["receipt_snapshot"]
    assert SaleOutputSerializer(sale).data["tax_amount"] == "21428.57"
    with pytest.raises(SaleServiceError, match="Soliq sozlamalari o‘zgardi"):
        create(tenant, owner, stocked, expected_tax_settings=expectation)
    assert Sale.objects.filter(tenant=tenant).count() == 1


@pytest.mark.parametrize("regime,profit", [("turnover", False), ("general", True)])
def test_seller_taxes_do_not_add_to_customer_bill(tenant, owner, stocked, regime, profit):
    configure(
        tenant,
        tax_regime=regime,
        is_vat_payer=False,
        turnover_tax_rate=Decimal("4"),
        profit_tax_enabled=profit,
        profit_tax_rate=Decimal("15"),
    )
    sale = create(tenant, owner, stocked)
    assert sale.total_amount == sale.subtotal_amount == 200000
    assert sale.tax_amount == 0
    assert sale.items.get().tax_rate is None


def test_legacy_sales_have_unknown_tax_without_recalculation(tenant, owner):
    sale = Sale.objects.create(tenant=tenant, sold_by=owner, receipt_number="LEGACY", total_amount=100)
    configure(tenant, tax_regime="general", is_vat_payer=True)
    data = PublicReceiptSerializer(sale).data
    assert data["receipt_snapshot"] == {}
    assert data["tax_amount"] is None
