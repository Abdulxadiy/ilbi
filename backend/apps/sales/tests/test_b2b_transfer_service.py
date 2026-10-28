from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.catalog.models import Product, ProductVariant
from apps.core.models import AuditAction, AuditLog
from apps.inventory.services import StockService
from apps.sales.models import DebtPayment, Notification, Sale, SaleItem
from apps.sales.services import B2BTransferService, B2BTransferServiceError, SaleService
from apps.sales.services.debt_service import DebtService
from apps.sales.services.void_service import VoidService, VoidServiceError
from tests.factories import (
    CategoryFactory,
    CounterpartyFactory,
    EmployeeFactory,
    OwnerFactory,
    ProductFactory,
    ProductVariantFactory,
    TenantFactory,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def b2b_setup(tenant, owner):
    # Tenant A (sender)
    cat_a = CategoryFactory(tenant=tenant, currency="UZS")
    prod_a = ProductFactory(tenant=tenant, category=cat_a, name="Futbolka")
    var_a = ProductVariantFactory(
        tenant=tenant,
        product=prod_a,
        name="Qora L",
        price_partner=Decimal("50000.00"),
    )
    StockService.intake(
        tenant=tenant,
        product_variant=var_a,
        quantity=Decimal("20.000"),
        cost_price=Decimal("40000.00"),
        created_by=owner,
    )

    # Tenant B (receiver)
    b_owner = OwnerFactory()
    b_tenant = TenantFactory(owner=b_owner)
    EmployeeFactory(user=b_owner, tenant=b_tenant, is_owner=True)
    cat_b = CategoryFactory(tenant=b_tenant, currency="UZS", name="Kiyimlar")

    # Counterparty in A pointing to B
    cp_b = CounterpartyFactory(tenant=tenant, target_tenant=b_tenant)

    # Send B2B sale
    sales = SaleService.create_sale(
        tenant=tenant,
        user=owner,
        items_data=[{"product_variant_id": var_a.id, "quantity": "10", "unit_price": "50000.00"}],
        payment_type="debt",
        counterparty=cp_b,
    )
    b2b_sale = sales[0]

    return {
        "tenant_a": tenant,
        "owner_a": owner,
        "variant_a": var_a,
        "tenant_b": b_tenant,
        "counterparty": cp_b,
        "owner_b": b_owner,
        "category_b": cat_b,
        "b2b_sale": b2b_sale,
    }


class TestB2BAcceptTransfer:
    def test_accept_transfer_with_category_selection(self, b2b_setup):
        b2b_sale = b2b_setup["b2b_sale"]
        owner_b = b2b_setup["owner_b"]
        tenant_b = b2b_setup["tenant_b"]
        cat_b = b2b_setup["category_b"]
        item = b2b_sale.items.first()

        accepted_sale = B2BTransferService.accept_transfer(
            sale=b2b_sale,
            tenant=tenant_b,
            accepting_user=owner_b,
            items_payload=[
                {
                    "sale_item_id": item.id,
                    "accepted_quantity": Decimal("10.000"),
                    "target_category_id": cat_b.id,
                }
            ],
        )

        assert accepted_sale.status == Sale.STATUS_B2B_ACCEPTED
        item.refresh_from_db()
        assert item.status == SaleItem.STATUS_B2B_ACCEPTED
        assert item.b2b_accepted_quantity == Decimal("10.000")
        assert item.b2b_rejected_quantity == Decimal("0.000")

        # Product & Variant created in B
        b_product = Product.objects.filter(tenant=tenant_b, name="Futbolka").first()
        assert b_product is not None
        assert b_product.category == cat_b

        b_variant = ProductVariant.objects.filter(tenant=tenant_b, product=b_product).first()
        assert b_variant is not None
        assert b_variant.price_partner == Decimal("0.00")
        assert b_variant.price_recommended == Decimal("0.00")

        # Stock intake in B
        b_variant.stock.refresh_from_db()
        assert b_variant.stock.quantity == Decimal("10.000")
        assert b_variant.stock.last_cost_price == Decimal("50000.00")

        # Notification sent to A
        notif = Notification.objects.filter(
            tenant=b2b_setup["tenant_a"],
            recipient=b2b_setup["owner_a"],
            type=Notification.TYPE_B2B_ACCEPTED,
        ).first()
        assert notif is not None
        assert "qabul qilindi" in notif.title

    def test_accept_transfer_with_existing_variant(self, b2b_setup):
        b2b_sale = b2b_setup["b2b_sale"]
        owner_b = b2b_setup["owner_b"]
        tenant_b = b2b_setup["tenant_b"]
        cat_b = b2b_setup["category_b"]
        item = b2b_sale.items.first()

        # Existing variant in B
        b_prod = ProductFactory(tenant=tenant_b, category=cat_b)
        b_var = ProductVariantFactory(tenant=tenant_b, product=b_prod)

        B2BTransferService.accept_transfer(
            sale=b2b_sale,
            tenant=tenant_b,
            accepting_user=owner_b,
            items_payload=[
                {
                    "sale_item_id": item.id,
                    "accepted_quantity": Decimal("10.000"),
                    "target_variant_id": b_var.id,
                }
            ],
        )

        b_var.stock.refresh_from_db()
        assert b_var.stock.quantity == Decimal("10.000")

    def test_accept_transfer_partial_quantity(self, b2b_setup):
        b2b_sale = b2b_setup["b2b_sale"]
        owner_b = b2b_setup["owner_b"]
        cat_b = b2b_setup["category_b"]
        item = b2b_sale.items.first()

        # Accept 6 out of 10
        accepted_sale = B2BTransferService.accept_transfer(
            sale=b2b_sale,
            tenant=b2b_setup["tenant_b"],
            accepting_user=owner_b,
            items_payload=[
                {
                    "sale_item_id": item.id,
                    "accepted_quantity": Decimal("6.000"),
                    "target_category_id": cat_b.id,
                }
            ],
        )

        assert accepted_sale.status == Sale.STATUS_B2B_PARTIALLY_ACCEPTED
        item.refresh_from_db()
        assert item.b2b_accepted_quantity == Decimal("6.000")
        assert item.b2b_rejected_quantity == Decimal("0.000")
        assert item.b2b_return_pending_quantity == Decimal("0.000")

    def test_partial_acceptance_reuses_same_destination_variant(self, b2b_setup):
        sale = b2b_setup["b2b_sale"]
        item = sale.items.first()
        tenant_b = b2b_setup["tenant_b"]
        owner_b = b2b_setup["owner_b"]
        category_b = b2b_setup["category_b"]

        B2BTransferService.accept_transfer(
            sale=sale,
            tenant=tenant_b,
            accepting_user=owner_b,
            items_payload=[
                {
                    "sale_item_id": item.id,
                    "accepted_quantity": Decimal("3.000"),
                    "target_category_id": category_b.id,
                }
            ],
        )
        item.refresh_from_db()
        target_variant_id = item.b2b_target_variant_id

        B2BTransferService.accept_transfer(
            sale=sale,
            tenant=tenant_b,
            accepting_user=owner_b,
            items_payload=[
                {
                    "sale_item_id": item.id,
                    "accepted_quantity": Decimal("2.000"),
                    "target_category_id": category_b.id,
                }
            ],
        )

        item.refresh_from_db()
        assert item.b2b_target_variant_id == target_variant_id
        assert ProductVariant.objects.filter(tenant=tenant_b, product__name="Futbolka").count() == 1
        target_variant = ProductVariant.objects.get(pk=target_variant_id)
        target_variant.stock.refresh_from_db()
        assert target_variant.stock.quantity == Decimal("5.000")

    def test_matching_destination_barcode_avoids_duplicate_product(self, b2b_setup):
        sale = b2b_setup["b2b_sale"]
        item = sale.items.first()
        source_variant = b2b_setup["variant_a"]
        source_variant.barcode = "0123456789012"
        source_variant.save(update_fields=["barcode"])
        tenant_b = b2b_setup["tenant_b"]
        existing_product = ProductFactory(
            tenant=tenant_b,
            category=b2b_setup["category_b"],
            name="Mahalliy tovar",
        )
        existing_variant = ProductVariantFactory(
            tenant=tenant_b,
            product=existing_product,
            barcode="0123456789012",
        )

        B2BTransferService.accept_transfer(
            sale=sale,
            tenant=tenant_b,
            accepting_user=b2b_setup["owner_b"],
            items_payload=[
                {
                    "sale_item_id": item.id,
                    "accepted_quantity": Decimal("10.000"),
                }
            ],
        )

        item.refresh_from_db()
        assert item.b2b_target_variant_id == existing_variant.id
        assert Product.objects.filter(tenant=tenant_b).count() == 1
        existing_variant.stock.refresh_from_db()
        assert existing_variant.stock.quantity == Decimal("10.000")

    def test_accept_with_mismatched_currency_fails(self, b2b_setup):
        b2b_sale = b2b_setup["b2b_sale"]
        owner_b = b2b_setup["owner_b"]
        tenant_b = b2b_setup["tenant_b"]
        item = b2b_sale.items.first()

        # USD category in B while sale is UZS
        usd_cat_b = CategoryFactory(tenant=tenant_b, currency="USD")

        with pytest.raises(B2BTransferServiceError, match="valyutasi transfer valyutasiga mos kelmaydi"):
            B2BTransferService.accept_transfer(
                sale=b2b_sale,
                tenant=tenant_b,
                accepting_user=owner_b,
                items_payload=[
                    {
                        "sale_item_id": item.id,
                        "accepted_quantity": Decimal("10.000"),
                        "target_category_id": usd_cat_b.id,
                    }
                ],
            )

    def test_accept_by_unauthorized_user_fails(self, b2b_setup, staff):
        b2b_sale = b2b_setup["b2b_sale"]
        item = b2b_sale.items.first()
        cat_b = b2b_setup["category_b"]

        with pytest.raises(B2BTransferServiceError, match="faol xodimlik"):
            B2BTransferService.accept_transfer(
                sale=b2b_sale,
                tenant=b2b_setup["tenant_b"],
                accepting_user=staff,
                items_payload=[
                    {
                        "sale_item_id": item.id,
                        "accepted_quantity": Decimal("10.000"),
                        "target_category_id": cat_b.id,
                    }
                ],
            )

    def test_accept_expired_transfer_fails(self, b2b_setup):
        b2b_sale = b2b_setup["b2b_sale"]
        owner_b = b2b_setup["owner_b"]
        cat_b = b2b_setup["category_b"]
        item = b2b_sale.items.first()

        # Simulate expiration
        b2b_sale.b2b_expires_at = timezone.now() - timedelta(minutes=5)
        b2b_sale.save(update_fields=["b2b_expires_at"])

        with pytest.raises(B2BTransferServiceError, match="muddati tugagan"):
            B2BTransferService.accept_transfer(
                sale=b2b_sale,
                tenant=b2b_setup["tenant_b"],
                accepting_user=owner_b,
                items_payload=[
                    {
                        "sale_item_id": item.id,
                        "accepted_quantity": Decimal("10.000"),
                        "target_category_id": cat_b.id,
                    }
                ],
            )

    def test_auto_expire_transfers(self, b2b_setup):
        b2b_sale = b2b_setup["b2b_sale"]
        b2b_sale.b2b_expires_at = timezone.now() - timedelta(hours=1)
        b2b_sale.save(update_fields=["b2b_expires_at"])

        expired_count = B2BTransferService.auto_expire_transfers()
        assert expired_count == 1

        b2b_sale.refresh_from_db()
        assert b2b_sale.status == Sale.STATUS_B2B_RETURN_PENDING
        assert "muddati tugadi" in b2b_sale.b2b_reject_reason
        item = b2b_sale.items.get()
        assert item.b2b_return_pending_quantity == Decimal("10.000")
        b2b_setup["variant_a"].stock.refresh_from_db()
        assert b2b_setup["variant_a"].stock.quantity == Decimal("10.000")


class TestB2BRejectTransfer:
    def test_reject_transfer_with_reason(self, b2b_setup):
        b2b_sale = b2b_setup["b2b_sale"]
        owner_b = b2b_setup["owner_b"]

        rejected_sale = B2BTransferService.reject_transfer(
            sale=b2b_sale,
            tenant=b2b_setup["tenant_b"],
            rejecting_user=owner_b,
            reason="Tovarlar sifatsiz va narxi qimmat",
        )

        assert rejected_sale.status == Sale.STATUS_B2B_RETURN_PENDING
        assert rejected_sale.b2b_reject_reason == "Tovarlar sifatsiz va narxi qimmat"

        # No stock/debt change until the sender physically receives the return.
        var_a = b2b_setup["variant_a"]
        var_a.stock.refresh_from_db()
        assert var_a.stock.quantity == Decimal("10.000")
        item = b2b_sale.items.get()
        assert item.b2b_return_pending_quantity == Decimal("10.000")
        assert item.b2b_rejected_quantity == Decimal("0.000")
        b2b_setup["counterparty"].refresh_from_db()
        assert b2b_setup["counterparty"].debt_balance_uzs == Decimal("500000.00")

        # Notification sent to A
        notif = Notification.objects.filter(
            tenant=b2b_setup["tenant_a"],
            recipient=b2b_setup["owner_a"],
            type=Notification.TYPE_B2B_REJECTED,
        ).first()
        assert notif is not None
        assert "qaytarish kutilmoqda" in notif.title
        assert "Tovarlar sifatsiz" in notif.message

    def test_receive_physical_return_restores_only_received_stock_and_debt(self, b2b_setup):
        sale = B2BTransferService.reject_transfer(
            sale=b2b_setup["b2b_sale"],
            tenant=b2b_setup["tenant_b"],
            rejecting_user=b2b_setup["owner_b"],
            reason="Qaytarish",
        )
        item = sale.items.get()
        receipt = B2BTransferService.receive_return(
            sale=sale,
            tenant=b2b_setup["tenant_a"],
            receiving_user=b2b_setup["owner_a"],
            items_payload=[{"sale_item_id": item.id, "quantity": Decimal("4.000")}],
            reason="4 dona jismonan qaytdi",
            idempotency_key="return-key-1",
        )

        assert receipt.items.get().amount == Decimal("200000.00")
        item.refresh_from_db()
        assert item.b2b_return_pending_quantity == Decimal("6.000")
        assert item.b2b_rejected_quantity == Decimal("4.000")
        b2b_setup["variant_a"].stock.refresh_from_db()
        assert b2b_setup["variant_a"].stock.quantity == Decimal("14.000")
        b2b_setup["counterparty"].refresh_from_db()
        assert b2b_setup["counterparty"].debt_balance_uzs == Decimal("300000.00")

    def test_receive_return_idempotency_prevents_duplicate_stock_and_debt(self, b2b_setup):
        sale = B2BTransferService.reject_transfer(
            sale=b2b_setup["b2b_sale"],
            tenant=b2b_setup["tenant_b"],
            rejecting_user=b2b_setup["owner_b"],
            reason="Qaytarish",
        )
        item = sale.items.get()
        payload = [{"sale_item_id": item.id, "quantity": Decimal("4.000")}]
        kwargs = {
            "sale": sale,
            "tenant": b2b_setup["tenant_a"],
            "receiving_user": b2b_setup["owner_a"],
            "items_payload": payload,
            "reason": "Qaytgan tovar",
            "idempotency_key": "return-key-replay",
        }
        first = B2BTransferService.receive_return(**kwargs)
        replay = B2BTransferService.receive_return(**kwargs)
        assert replay.id == first.id
        b2b_setup["variant_a"].stock.refresh_from_db()
        assert b2b_setup["variant_a"].stock.quantity == Decimal("14.000")
        b2b_setup["counterparty"].refresh_from_db()
        assert b2b_setup["counterparty"].debt_balance_uzs == Decimal("300000.00")

        with pytest.raises(B2BTransferServiceError, match="boshqa qaytarish uchun"):
            B2BTransferService.receive_return(
                **{
                    **kwargs,
                    "items_payload": [{"sale_item_id": item.id, "quantity": Decimal("3.000")}],
                }
            )

    def test_b2b_cannot_use_regular_void_to_restore_stock_or_debt(self, b2b_setup):
        sale = b2b_setup["b2b_sale"]
        with pytest.raises(VoidServiceError, match="B2B transfer"):
            VoidService.void_sale(sale=sale, user=b2b_setup["owner_a"], reason="Noto‘g‘ri bekor qilish")
        b2b_setup["variant_a"].stock.refresh_from_db()
        assert b2b_setup["variant_a"].stock.quantity == Decimal("10.000")

    def test_paid_b2b_return_becomes_counterparty_credit(self, b2b_setup):
        sale = B2BTransferService.reject_transfer(
            sale=b2b_setup["b2b_sale"],
            tenant=b2b_setup["tenant_b"],
            rejecting_user=b2b_setup["owner_b"],
            reason="To‘liq qaytarish",
        )
        counterparty = b2b_setup["counterparty"]
        DebtService.record_payment(
            counterparty=counterparty,
            amount=Decimal("500000.00"),
            currency="UZS",
            recorded_by=b2b_setup["owner_a"],
        )
        line = sale.items.get()
        B2BTransferService.receive_return(
            sale=sale,
            tenant=b2b_setup["tenant_a"],
            receiving_user=b2b_setup["owner_a"],
            items_payload=[{"sale_item_id": line.id, "quantity": Decimal("10.000")}],
            reason="To‘liq qabul qilindi",
            idempotency_key="paid-b2b-return",
        )
        counterparty.refresh_from_db()
        assert counterparty.debt_balance_uzs == Decimal("-500000.00")
        credit_entry = DebtPayment.objects.filter(counterparty=counterparty, is_correction=True).get()
        assert credit_entry.amount == Decimal("500000.00")
        assert "B2B qaytish krediti" in credit_entry.note

    def test_close_return_discrepancy_adjusts_sale_and_debt_without_stock(self, b2b_setup):
        sale = B2BTransferService.reject_transfer(
            sale=b2b_setup["b2b_sale"],
            tenant=b2b_setup["tenant_b"],
            rejecting_user=b2b_setup["owner_b"],
            reason="Qaytarish",
        )
        item = sale.items.get()
        closure = B2BTransferService.close_return_discrepancy(
            sale=sale,
            tenant=b2b_setup["tenant_a"],
            closing_user=b2b_setup["owner_a"],
            items_payload=[{"sale_item_id": item.id, "quantity": Decimal("4.000")}],
            reason="Yo‘lda 4 dona yo‘qolgan",
            idempotency_key="discrepancy-close-1",
        )

        assert closure.items.get().amount == Decimal("200000.00")
        sale.refresh_from_db()
        assert sale.refunded_amount == Decimal("200000.00")
        item.refresh_from_db()
        assert item.b2b_return_pending_quantity == Decimal("6.000")
        assert item.b2b_discrepancy_closed_quantity == Decimal("4.000")
        b2b_setup["variant_a"].stock.refresh_from_db()
        assert b2b_setup["variant_a"].stock.quantity == Decimal("10.000")
        b2b_setup["counterparty"].refresh_from_db()
        assert b2b_setup["counterparty"].debt_balance_uzs == Decimal("300000.00")
        adjustment = DebtPayment.objects.get(counterparty=b2b_setup["counterparty"], is_correction=True)
        assert adjustment.amount == Decimal("200000.00")
        assert AuditLog.objects.filter(
            action=AuditAction.B2B_RETURN_DISCREPANCY_CLOSE,
            target_id=str(closure.id),
        ).exists()

    def test_paid_return_discrepancy_becomes_partner_credit(self, b2b_setup):
        sale = B2BTransferService.reject_transfer(
            sale=b2b_setup["b2b_sale"],
            tenant=b2b_setup["tenant_b"],
            rejecting_user=b2b_setup["owner_b"],
            reason="Qaytarish",
        )
        counterparty = b2b_setup["counterparty"]
        DebtService.record_payment(
            counterparty=counterparty,
            amount=Decimal("500000.00"),
            currency="UZS",
            recorded_by=b2b_setup["owner_a"],
        )
        item = sale.items.get()
        kwargs = {
            "sale": sale,
            "tenant": b2b_setup["tenant_a"],
            "closing_user": b2b_setup["owner_a"],
            "items_payload": [{"sale_item_id": item.id, "quantity": Decimal("10.000")}],
            "reason": "Qaytmagan tovar yo‘qolgan",
            "idempotency_key": "paid-discrepancy-close",
        }
        closure = B2BTransferService.close_return_discrepancy(**kwargs)
        replay = B2BTransferService.close_return_discrepancy(**kwargs)
        assert replay.id == closure.id

        counterparty.refresh_from_db()
        assert counterparty.debt_balance_uzs == Decimal("-500000.00")
        assert DebtPayment.objects.filter(counterparty=counterparty, is_correction=True).count() == 1
        b2b_setup["variant_a"].stock.refresh_from_db()
        assert b2b_setup["variant_a"].stock.quantity == Decimal("10.000")

    def test_physical_return_and_discrepancy_close_do_not_overlap(self, b2b_setup):
        sale = B2BTransferService.reject_transfer(
            sale=b2b_setup["b2b_sale"],
            tenant=b2b_setup["tenant_b"],
            rejecting_user=b2b_setup["owner_b"],
            reason="Qaytarish",
        )
        item = sale.items.get()
        B2BTransferService.close_return_discrepancy(
            sale=sale,
            tenant=b2b_setup["tenant_a"],
            closing_user=b2b_setup["owner_a"],
            items_payload=[{"sale_item_id": item.id, "quantity": Decimal("3.000")}],
            reason="3 dona yo‘qolgan",
            idempotency_key="mixed-resolution-close",
        )
        B2BTransferService.receive_return(
            sale=sale,
            tenant=b2b_setup["tenant_a"],
            receiving_user=b2b_setup["owner_a"],
            items_payload=[{"sale_item_id": item.id, "quantity": Decimal("7.000")}],
            reason="7 dona jismonan qaytdi",
            idempotency_key="mixed-resolution-receive",
        )

        sale.refresh_from_db()
        item.refresh_from_db()
        assert sale.refunded_amount == Decimal("500000.00")
        assert item.b2b_return_pending_quantity == Decimal("0.000")
        assert item.b2b_discrepancy_closed_quantity == Decimal("3.000")
        assert item.b2b_rejected_quantity == Decimal("7.000")
        b2b_setup["variant_a"].stock.refresh_from_db()
        assert b2b_setup["variant_a"].stock.quantity == Decimal("17.000")
        b2b_setup["counterparty"].refresh_from_db()
        assert b2b_setup["counterparty"].debt_balance_uzs == Decimal("0.00")

    def test_only_owner_can_close_return_discrepancy(self, b2b_setup):
        sale = B2BTransferService.reject_transfer(
            sale=b2b_setup["b2b_sale"],
            tenant=b2b_setup["tenant_b"],
            rejecting_user=b2b_setup["owner_b"],
            reason="Qaytarish",
        )
        staff = EmployeeFactory(tenant=b2b_setup["tenant_a"], is_owner=False).user
        item = sale.items.get()
        with pytest.raises(B2BTransferServiceError, match="faqat do‘kon egasi"):
            B2BTransferService.close_return_discrepancy(
                sale=sale,
                tenant=b2b_setup["tenant_a"],
                closing_user=staff,
                items_payload=[{"sale_item_id": item.id, "quantity": Decimal("1.000")}],
                reason="Tekshiruv",
                idempotency_key="staff-discrepancy-close",
            )

    def test_return_discrepancy_rejects_overclose_and_conflicting_replay(self, b2b_setup):
        sale = B2BTransferService.reject_transfer(
            sale=b2b_setup["b2b_sale"],
            tenant=b2b_setup["tenant_b"],
            rejecting_user=b2b_setup["owner_b"],
            reason="Qaytarish",
        )
        item = sale.items.get()
        kwargs = {
            "sale": sale,
            "tenant": b2b_setup["tenant_a"],
            "closing_user": b2b_setup["owner_a"],
            "items_payload": [{"sale_item_id": item.id, "quantity": Decimal("2.000")}],
            "reason": "Tafovut",
            "idempotency_key": "discrepancy-conflict",
        }
        B2BTransferService.close_return_discrepancy(**kwargs)
        with pytest.raises(B2BTransferServiceError, match="boshqa tafovutni yopishda"):
            B2BTransferService.close_return_discrepancy(
                **{
                    **kwargs,
                    "items_payload": [{"sale_item_id": item.id, "quantity": Decimal("1.000")}],
                }
            )
        with pytest.raises(B2BTransferServiceError, match="yopiladigan miqdor"):
            B2BTransferService.close_return_discrepancy(
                **{
                    **kwargs,
                    "idempotency_key": "discrepancy-overclose",
                    "items_payload": [{"sale_item_id": item.id, "quantity": Decimal("9.000")}],
                }
            )

    def test_partial_accept_then_expiry_keeps_return_separate(self, b2b_setup):
        sale = b2b_setup["b2b_sale"]
        item = sale.items.get()
        B2BTransferService.accept_transfer(
            sale=sale,
            tenant=b2b_setup["tenant_b"],
            accepting_user=b2b_setup["owner_b"],
            items_payload=[
                {
                    "sale_item_id": item.id,
                    "accepted_quantity": Decimal("3.000"),
                    "target_category_id": b2b_setup["category_b"].id,
                }
            ],
        )
        sale.refresh_from_db()
        sale.b2b_expires_at = timezone.now() - timedelta(minutes=1)
        sale.save(update_fields=["b2b_expires_at"])
        assert B2BTransferService.expire_due_transfers() == 1
        item.refresh_from_db()
        assert item.b2b_accepted_quantity == Decimal("3.000")
        assert item.b2b_return_pending_quantity == Decimal("7.000")
        b2b_setup["variant_a"].stock.refresh_from_db()
        assert b2b_setup["variant_a"].stock.quantity == Decimal("10.000")

    def test_reject_without_reason_fails(self, b2b_setup):
        b2b_sale = b2b_setup["b2b_sale"]
        owner_b = b2b_setup["owner_b"]

        with pytest.raises(B2BTransferServiceError, match="sababi kiritilishi shart"):
            B2BTransferService.reject_transfer(
                sale=b2b_sale,
                tenant=b2b_setup["tenant_b"],
                rejecting_user=owner_b,
                reason="   ",
            )
