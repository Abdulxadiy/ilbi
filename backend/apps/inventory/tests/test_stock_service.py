from decimal import Decimal

import pytest

from apps.inventory.models import Stock, StockMovement
from apps.inventory.services import StockService, StockServiceError
from tests.factories import ProductVariantFactory, StaffFactory, TenantFactory

pytestmark = pytest.mark.django_db


class TestIntake:
    def test_intake_creates_stock_row_lazily(self, tenant):
        variant = ProductVariantFactory(tenant=tenant)
        assert not Stock.objects.filter(product_variant=variant).exists()

        StockService.intake(
            tenant=tenant, product_variant=variant, quantity=Decimal("10"),
            cost_price=Decimal("5000"), created_by=StaffFactory(),
        )

        stock = Stock.objects.get(product_variant=variant)
        assert stock.quantity == Decimal("10.000")
        assert stock.last_cost_price == Decimal("5000.00")

    def test_intake_without_cost_price_is_rejected(self, tenant):
        variant = ProductVariantFactory(tenant=tenant)
        with pytest.raises(StockServiceError):
            StockService.intake(
                tenant=tenant, product_variant=variant, quantity=Decimal("10"),
                cost_price=None, created_by=StaffFactory(),
            )

    def test_second_intake_updates_last_cost_price_only_to_the_newest(self, tenant):
        variant = ProductVariantFactory(tenant=tenant)
        user = StaffFactory()
        StockService.intake(tenant=tenant, product_variant=variant, quantity=Decimal("10"), cost_price=Decimal("5000"), created_by=user)
        StockService.intake(tenant=tenant, product_variant=variant, quantity=Decimal("5"), cost_price=Decimal("6000"), created_by=user)

        stock = Stock.objects.get(product_variant=variant)
        assert stock.quantity == Decimal("15.000")
        assert stock.last_cost_price == Decimal("6000.00")  # newest wins, not an average

    def test_intake_writes_an_immutable_movement_row(self, tenant):
        variant = ProductVariantFactory(tenant=tenant)
        user = StaffFactory()
        movement = StockService.intake(tenant=tenant, product_variant=variant, quantity=Decimal("10"), cost_price=Decimal("5000"), created_by=user)

        assert movement.type == StockMovement.TYPE_KIRIM
        assert movement.direction == StockMovement.DIRECTION_IN
        assert movement.cost_price == Decimal("5000.00")
        assert movement.created_by == user

    def test_variant_from_a_different_tenant_is_rejected(self, tenant):
        foreign_variant = ProductVariantFactory()  # its own fresh tenant
        with pytest.raises(StockServiceError):
            StockService.intake(
                tenant=tenant, product_variant=foreign_variant, quantity=Decimal("1"),
                cost_price=Decimal("1"), created_by=StaffFactory(),
            )


class TestOutgoingMovementsBlockNegativeStock:
    def test_write_off_more_than_available_is_rejected(self, tenant):
        variant = ProductVariantFactory(tenant=tenant)
        user = StaffFactory()
        StockService.intake(tenant=tenant, product_variant=variant, quantity=Decimal("3"), cost_price=Decimal("1000"), created_by=user)

        with pytest.raises(StockServiceError):
            StockService.write_off(tenant=tenant, product_variant=variant, quantity=Decimal("5"), created_by=user)

        # Rejected atomically -- quantity must be untouched.
        assert Stock.objects.get(product_variant=variant).quantity == Decimal("3.000")

    def test_supplier_return_exactly_at_balance_succeeds(self, tenant):
        variant = ProductVariantFactory(tenant=tenant)
        user = StaffFactory()
        StockService.intake(tenant=tenant, product_variant=variant, quantity=Decimal("3"), cost_price=Decimal("1000"), created_by=user)

        StockService.supplier_return(tenant=tenant, product_variant=variant, quantity=Decimal("3"), created_by=user)

        assert Stock.objects.get(product_variant=variant).quantity == Decimal("0.000")

    def test_adjust_out_more_than_available_is_rejected(self, tenant):
        variant = ProductVariantFactory(tenant=tenant)
        user = StaffFactory()
        with pytest.raises(StockServiceError):
            StockService.adjust(
                tenant=tenant, product_variant=variant, quantity=Decimal("1"),
                direction=StockMovement.DIRECTION_OUT, created_by=user,
            )


class TestCustomerReturnAndAdjust:
    def test_customer_return_increases_stock_without_cost_price(self, tenant):
        variant = ProductVariantFactory(tenant=tenant)
        user = StaffFactory()
        movement = StockService.customer_return(tenant=tenant, product_variant=variant, quantity=Decimal("2"), created_by=user)

        assert movement.cost_price is None
        assert Stock.objects.get(product_variant=variant).quantity == Decimal("2.000")

    def test_adjust_requires_an_explicit_direction(self, tenant):
        variant = ProductVariantFactory(tenant=tenant)
        with pytest.raises(StockServiceError):
            StockService.adjust(
                tenant=tenant, product_variant=variant, quantity=Decimal("1"),
                direction="sideways", created_by=StaffFactory(),
            )

    def test_adjust_in_direction_increases_stock(self, tenant):
        variant = ProductVariantFactory(tenant=tenant)
        StockService.adjust(
            tenant=tenant, product_variant=variant, quantity=Decimal("4"),
            direction=StockMovement.DIRECTION_IN, created_by=StaffFactory(),
        )
        assert Stock.objects.get(product_variant=variant).quantity == Decimal("4.000")
