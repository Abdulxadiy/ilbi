from datetime import timedelta
from decimal import Decimal
import pytest
from django.utils import timezone

from apps.inventory.services import StockService
from apps.inventory.models import StockMovement
from apps.sales.models import Sale, SaleItem, SaleVoidLog, Notification
from apps.sales.services import SaleService, VoidService, VoidServiceError
from tests.factories import (
    TenantFactory,
    OwnerFactory,
    StaffFactory,
    CategoryFactory,
    ProductFactory,
    ProductVariantFactory,
    CounterpartyFactory,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def stocked_variant(tenant, owner):
    cat = CategoryFactory(tenant=tenant, currency="UZS")
    prod = ProductFactory(tenant=tenant, category=cat)
    var = ProductVariantFactory(
        tenant=tenant,
        product=prod,
        price_recommended=Decimal("15000.00"),
    )
    StockService.intake(
        tenant=tenant,
        product_variant=var,
        quantity=Decimal("100.000"),
        cost_price=Decimal("10000.00"),
        created_by=owner,
    )
    return var


class TestVoidSale:
    def test_void_entire_sale_success(self, tenant, staff, stocked_variant):
        sales = SaleService.create_sale(
            tenant=tenant,
            user=staff,
            items_data=[{"product_variant_id": stocked_variant.id, "quantity": "10", "unit_price": "15000.00"}],
            payment_type="cash",
        )
        sale = sales[0]
        stocked_variant.stock.refresh_from_db()
        assert stocked_variant.stock.quantity == Decimal("90.000")

        voided_sale = VoidService.void_sale(
            sale=sale,
            user=staff,
            reason="Mijoz qaytarib berdi, yaroqsiz chiqdi",
        )

        assert voided_sale.status == Sale.STATUS_VOIDED
        assert voided_sale.void_reason == "Mijoz qaytarib berdi, yaroqsiz chiqdi"
        assert voided_sale.voided_by == staff
        assert voided_sale.voided_at is not None

        # Stock returned
        stocked_variant.stock.refresh_from_db()
        assert stocked_variant.stock.quantity == Decimal("100.000")

        # Void log created
        assert SaleVoidLog.objects.filter(sale_item__sale=sale).count() == 1
        item = voided_sale.items.first()
        assert item.status == SaleItem.STATUS_VOIDED
        assert item.voided_quantity == Decimal("10.000")

    def test_void_requires_reason(self, tenant, staff, stocked_variant):
        sales = SaleService.create_sale(
            tenant=tenant,
            user=staff,
            items_data=[{"product_variant_id": stocked_variant.id, "quantity": "1"}],
        )
        sale = sales[0]

        with pytest.raises(VoidServiceError, match="sababi kiritilishi shart"):
            VoidService.void_sale(sale=sale, user=staff, reason="   ")

    def test_void_after_7_days_fails(self, tenant, staff, stocked_variant):
        sales = SaleService.create_sale(
            tenant=tenant,
            user=staff,
            items_data=[{"product_variant_id": stocked_variant.id, "quantity": "1"}],
        )
        sale = sales[0]
        # Simulate 8 days ago
        sale.created_at = timezone.now() - timedelta(days=8)
        sale.save(update_fields=["created_at"])

        with pytest.raises(VoidServiceError, match="1 haftadan"):
            VoidService.void_sale(sale=sale, user=staff, reason="Kechikkan qaytarish")

    def test_void_already_voided_sale_fails(self, tenant, staff, stocked_variant):
        sales = SaleService.create_sale(
            tenant=tenant,
            user=staff,
            items_data=[{"product_variant_id": stocked_variant.id, "quantity": "1"}],
        )
        sale = sales[0]
        VoidService.void_sale(sale=sale, user=staff, reason="Birinchi marta")

        with pytest.raises(VoidServiceError, match="allaqachon bekor qilingan"):
            VoidService.void_sale(sale=sale, user=staff, reason="Ikkinchi marta")

    def test_void_accepted_b2b_fails(self, tenant, staff, stocked_variant):
        sales = SaleService.create_sale(
            tenant=tenant,
            user=staff,
            items_data=[{"product_variant_id": stocked_variant.id, "quantity": "1"}],
        )
        sale = sales[0]
        sale.status = Sale.STATUS_B2B_ACCEPTED
        sale.save(update_fields=["status"])

        with pytest.raises(VoidServiceError, match="Qabul qilingan B2B transferni bekor qilib bo'lmaydi"):
            VoidService.void_sale(sale=sale, user=staff, reason="B2B ni bekor qilish")

    def test_void_debt_sale_reduces_counterparty_debt(self, tenant, staff, stocked_variant):
        cp = CounterpartyFactory(tenant=tenant)
        sales = SaleService.create_sale(
            tenant=tenant,
            user=staff,
            items_data=[{"product_variant_id": stocked_variant.id, "quantity": "2", "unit_price": "15000.00"}],
            payment_type="debt",
            counterparty=cp,
        )
        sale = sales[0]
        cp.refresh_from_db()
        assert cp.debt_balance_uzs == Decimal("30000.00")

        VoidService.void_sale(sale=sale, user=staff, reason="Mijoz to'lolmay qaytardi")
        cp.refresh_from_db()
        assert cp.debt_balance_uzs == Decimal("0.00")


class TestVoidSaleItem:
    def test_void_sale_item_partial_quantity(self, tenant, staff, stocked_variant):
        sales = SaleService.create_sale(
            tenant=tenant,
            user=staff,
            items_data=[{"product_variant_id": stocked_variant.id, "quantity": "5", "unit_price": "15000.00"}],
            payment_type="cash",
        )
        sale = sales[0]
        item = sale.items.first()
        stocked_variant.stock.refresh_from_db()
        assert stocked_variant.stock.quantity == Decimal("95.000")

        # Void 2 out of 5
        updated_item = VoidService.void_sale_item(
            sale_item=item,
            user=staff,
            quantity=Decimal("2.000"),
            reason="2 dona ortiqcha olingan ekan",
        )

        assert updated_item.status == SaleItem.STATUS_PARTIALLY_VOIDED
        assert updated_item.voided_quantity == Decimal("2.000")

        sale.refresh_from_db()
        assert sale.status == Sale.STATUS_PARTIALLY_VOIDED

        # Stock increased by 2
        stocked_variant.stock.refresh_from_db()
        assert stocked_variant.stock.quantity == Decimal("97.000")

    def test_void_sale_item_remaining_completes_sale_void(self, tenant, staff, stocked_variant):
        sales = SaleService.create_sale(
            tenant=tenant,
            user=staff,
            items_data=[{"product_variant_id": stocked_variant.id, "quantity": "4", "unit_price": "15000.00"}],
        )
        sale = sales[0]
        item = sale.items.first()

        VoidService.void_sale_item(
            sale_item=item,
            user=staff,
            quantity=Decimal("4.000"),
            reason="Hammasi qaytarildi",
        )

        item.refresh_from_db()
        sale.refresh_from_db()
        assert item.status == SaleItem.STATUS_VOIDED
        assert sale.status == Sale.STATUS_VOIDED

    def test_void_quantity_exceeds_available_fails(self, tenant, staff, stocked_variant):
        sales = SaleService.create_sale(
            tenant=tenant,
            user=staff,
            items_data=[{"product_variant_id": stocked_variant.id, "quantity": "3", "unit_price": "15000.00"}],
        )
        sale = sales[0]
        item = sale.items.first()

        with pytest.raises(VoidServiceError, match="katta bo'lishi mumkin emas"):
            VoidService.void_sale_item(
                sale_item=item,
                user=staff,
                quantity=Decimal("5.000"),
                reason="Ko'proq qaytarish",
            )
