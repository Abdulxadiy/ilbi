import pytest
from decimal import Decimal
from datetime import timedelta
from django.utils import timezone
from django.test import override_settings

from apps.catalog.models import Category, Product, ProductVariant
from apps.inventory.services import StockService, StockServiceError
from apps.inventory.models import StockMovement
from apps.sales.models import Sale, SaleItem, Notification
from apps.sales.services import SaleService, SaleServiceError
from apps.tenants.models import SellerProfile
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
def uzs_variant(tenant, owner):
    cat = CategoryFactory(tenant=tenant, currency="UZS")
    prod = ProductFactory(tenant=tenant, category=cat)
    var = ProductVariantFactory(
        tenant=tenant,
        product=prod,
        price_partner=Decimal("8000.00"),
        price_min=Decimal("10000.00"),
        price_recommended=Decimal("12000.00"),
    )
    StockService.intake(
        tenant=tenant,
        product_variant=var,
        quantity=Decimal("50.000"),
        cost_price=Decimal("7000.00"),
        created_by=owner,
    )
    return var


@pytest.fixture
def usd_variant(tenant, owner):
    cat = CategoryFactory(tenant=tenant, currency="USD")
    prod = ProductFactory(tenant=tenant, category=cat)
    var = ProductVariantFactory(
        tenant=tenant,
        product=prod,
        price_partner=Decimal("15.00"),
        price_min=Decimal("18.00"),
        price_recommended=Decimal("20.00"),
    )
    StockService.intake(
        tenant=tenant,
        product_variant=var,
        quantity=Decimal("30.000"),
        cost_price=Decimal("12.00"),
        created_by=owner,
    )
    return var


class TestSaleServiceCreation:
    @override_settings(DEBUG=False)
    def test_production_pos_is_closed_without_fiscal_integration(self, tenant, staff, uzs_variant):
        with pytest.raises(SaleServiceError, match="fiskal provayder integratsiyasi tayyor emas"):
            SaleService.create_sale(
                tenant=tenant, user=staff,
                items_data=[{"product_variant_id": uzs_variant.id, "quantity": "1"}],
                payment_type="cash",
            )

    def test_pos_rejects_tenant_without_seller_profile(self, tenant, staff, uzs_variant):
        tenant.seller_profile = None
        tenant.save(update_fields=["seller_profile"])

        with pytest.raises(SaleServiceError, match="sotuvchi profili kerak"):
            SaleService.create_sale(
                tenant=tenant, user=staff,
                items_data=[{"product_variant_id": uzs_variant.id, "quantity": "1"}],
                payment_type="cash",
            )

    def test_pos_requires_a_currently_approved_seller_profile(self, tenant, staff, uzs_variant):
        tenant.seller_profile.status = SellerProfile.STATUS_PENDING
        tenant.seller_profile.save(update_fields=["status"])

        with pytest.raises(SaleServiceError, match="tekshiruvdan o‘tgan"):
            SaleService.create_sale(
                tenant=tenant, user=staff,
                items_data=[{"product_variant_id": uzs_variant.id, "quantity": "1"}],
                payment_type="cash",
            )

    def test_pos_rejects_expired_seller_profile(self, tenant, staff, uzs_variant):
        tenant.seller_profile.expires_at = timezone.now() - timedelta(seconds=1)
        tenant.seller_profile.save(update_fields=["expires_at"])

        with pytest.raises(SaleServiceError, match="muddati tugagan"):
            SaleService.create_sale(
                tenant=tenant, user=staff,
                items_data=[{"product_variant_id": uzs_variant.id, "quantity": "1"}],
                payment_type="cash",
            )

    def test_single_currency_sale_creates_one_receipt(self, tenant, staff, uzs_variant):
        sales = SaleService.create_sale(
            tenant=tenant,
            user=staff,
            items_data=[
                {
                    "product_variant_id": uzs_variant.id,
                    "quantity": "2",
                    "unit_price": "12000.00",
                }
            ],
            payment_type="cash",
        )

        assert len(sales) == 1
        sale = sales[0]
        assert sale.currency == "UZS"
        assert sale.total_amount == Decimal("24000.00")
        assert sale.status == Sale.STATUS_COMPLETED
        assert sale.receipt_number.startswith("POS-")
        assert sale.items.count() == 1

        item = sale.items.first()
        assert item.quantity == Decimal("2.000")
        assert item.unit_price == Decimal("12000.00")
        assert item.cost_price == Decimal("7000.00")
        assert item.total_price == Decimal("24000.00")

        # Check stock movement
        movement = StockMovement.objects.filter(sale=sale).first()
        assert movement is not None
        assert movement.type == StockMovement.TYPE_SOTUV
        assert movement.quantity == Decimal("2.000")
        uzs_variant.stock.refresh_from_db()
        assert uzs_variant.stock.quantity == Decimal("48.000")

    def test_usd_category_cannot_be_sold_at_pos(self, tenant, staff, uzs_variant, usd_variant):
        with pytest.raises(SaleServiceError, match="POS savdosi faqat UZS"):
            SaleService.create_sale(
                tenant=tenant,
                user=staff,
                items_data=[
                    {"product_variant_id": uzs_variant.id, "quantity": "3", "unit_price": "12000.00"},
                    {"product_variant_id": usd_variant.id, "quantity": "1", "unit_price": "20.00"},
                ],
                payment_type="cash",
            )
        assert not Sale.objects.filter(tenant=tenant).exists()
        uzs_variant.stock.refresh_from_db()
        usd_variant.stock.refresh_from_db()
        assert uzs_variant.stock.quantity == Decimal("50.000")
        assert usd_variant.stock.quantity == Decimal("30.000")

    def test_empty_cart_fails(self, tenant, staff):
        with pytest.raises(SaleServiceError, match="kamida bitta tovar"):
            SaleService.create_sale(
                tenant=tenant,
                user=staff,
                items_data=[],
            )

    def test_cart_exceeds_100_items_fails(self, tenant, staff, uzs_variant):
        items = [{"product_variant_id": uzs_variant.id, "quantity": "1"}] * 101
        with pytest.raises(SaleServiceError, match="ko'pi bilan 100 ta tovar"):
            SaleService.create_sale(
                tenant=tenant,
                user=staff,
                items_data=items,
            )

    def test_debt_sale_without_counterparty_fails(self, tenant, staff, uzs_variant):
        with pytest.raises(SaleServiceError, match="kontragent tanlanishi shart"):
            SaleService.create_sale(
                tenant=tenant,
                user=staff,
                items_data=[{"product_variant_id": uzs_variant.id, "quantity": "1"}],
                payment_type="debt",
                counterparty=None,
            )

    def test_debt_sale_updates_uzs_counterparty_balance(self, tenant, staff, uzs_variant):
        cp = CounterpartyFactory(tenant=tenant)
        sales = SaleService.create_sale(
            tenant=tenant,
            user=staff,
            items_data=[
                {"product_variant_id": uzs_variant.id, "quantity": "2", "unit_price": "10000.00"},
            ],
            payment_type="debt",
            counterparty=cp,
        )
        assert len(sales) == 1
        cp.refresh_from_db()
        assert cp.debt_balance_uzs == Decimal("20000.00")
        assert cp.debt_balance_usd == Decimal("0.00")

    def test_partner_sale_enforces_1_narx(self, tenant, staff, uzs_variant):
        # When 1-narx is 0, fails
        uzs_variant.price_partner = Decimal("0.00")
        uzs_variant.save(update_fields=["price_partner"])

        with pytest.raises(SaleServiceError, match="1-narx belgilanmagan"):
            SaleService.create_sale(
                tenant=tenant,
                user=staff,
                items_data=[{"product_variant_id": uzs_variant.id, "quantity": "1"}],
                is_partner_sale=True,
            )

    def test_partner_sale_uses_partner_price(self, tenant, staff, uzs_variant):
        uzs_variant.price_partner = Decimal("8500.00")
        uzs_variant.save(update_fields=["price_partner"])

        sales = SaleService.create_sale(
            tenant=tenant,
            user=staff,
            items_data=[{"product_variant_id": uzs_variant.id, "quantity": "2"}],
            is_partner_sale=True,
        )
        sale = sales[0]
        assert sale.is_partner_sale is True
        assert sale.items.first().unit_price == Decimal("8500.00")
        assert sale.total_amount == Decimal("17000.00")

    def test_insufficient_stock_fails(self, tenant, staff, uzs_variant):
        # Current stock is 50.000, request 100.000
        with pytest.raises(StockServiceError, match="Not enough stock"):
            SaleService.create_sale(
                tenant=tenant,
                user=staff,
                items_data=[{"product_variant_id": uzs_variant.id, "quantity": "100"}],
            )
        assert Sale.objects.filter(tenant=tenant).count() == 0

    def test_idempotency_key_returns_existing_sales(self, tenant, staff, uzs_variant):
        key = "idemp-key-12345"
        sales1 = SaleService.create_sale(
            tenant=tenant,
            user=staff,
            items_data=[{"product_variant_id": uzs_variant.id, "quantity": "1", "unit_price": "10000"}],
            idempotency_key=key,
        )
        sales2 = SaleService.create_sale(
            tenant=tenant,
            user=staff,
            items_data=[{"product_variant_id": uzs_variant.id, "quantity": "1", "unit_price": "10000"}],
            idempotency_key=key,
        )

        assert len(sales1) == 1
        assert len(sales2) == 1
        assert sales1[0].id == sales2[0].id
        # Stock should only have been deducted ONCE (50 - 1 = 49)
        uzs_variant.stock.refresh_from_db()
        assert uzs_variant.stock.quantity == Decimal("49.000")

    def test_b2b_sale_sets_status_pending_and_notifies_receiver(self, tenant, staff, uzs_variant):
        b_owner = OwnerFactory()
        b_tenant = TenantFactory(owner=b_owner)
        cp = CounterpartyFactory(tenant=tenant, target_tenant=b_tenant)

        sales = SaleService.create_sale(
            tenant=tenant,
            user=staff,
            items_data=[{"product_variant_id": uzs_variant.id, "quantity": "5", "unit_price": "10000"}],
            counterparty=cp,
        )
        sale = sales[0]
        assert sale.status == Sale.STATUS_B2B_PENDING
        assert sale.b2b_target_tenant == b_tenant
        assert sale.b2b_expires_at is not None

        # Notification to B's owner
        notif = Notification.objects.filter(
            tenant=b_tenant,
            recipient=b_owner,
            type=Notification.TYPE_B2B_REQUEST,
        ).first()
        assert notif is not None
        assert "B2B tovar o'tkazmasi" in notif.title
