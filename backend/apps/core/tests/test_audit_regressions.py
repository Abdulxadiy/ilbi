from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from decimal import Decimal as D
from threading import Barrier
from unittest.mock import patch
from uuid import uuid4

import pytest
from django.db import close_old_connections
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.analytics.services.analytics_service import AnalyticsService
from apps.cashbox.services.cashbox_service import CashboxService
from apps.catalog.models import Product
from apps.inventory.models import Stock
from apps.inventory.services import StockService, StockServiceError
from apps.inventory.services.deficit_service import DeficitService
from apps.inventory.services.transfer_service import TenantTransferService, TenantTransferError
from apps.permissions.models import Permission
from apps.sales.models import Sale, SaleItem
from apps.sales.services.sale_service import SaleService, SaleServiceError
from tests.factories import (CategoryFactory, EmployeeFactory, OwnerFactory, ProductFactory,
                            ProductVariantFactory, SaleFactory, SaleItemFactory,
                            StaffFactory, TenantFactory)

pytestmark = pytest.mark.django_db

def context(staff=False):
    owner = OwnerFactory(password="InitialStrongPassword42!")
    tenant = TenantFactory(owner=owner, shift_report_target="none")
    EmployeeFactory(user=owner, tenant=tenant, is_owner=True)
    user = StaffFactory() if staff else owner
    employee = EmployeeFactory(user=user, tenant=tenant) if staff else None
    client = APIClient()
    client.force_authenticate(user)
    client.credentials(HTTP_X_TENANT_ID=str(tenant.id))
    return owner, tenant, user, employee, client

def grant(employee, category, codename):
    permission, _ = Permission.objects.get_or_create(category=category, codename=codename,
                                                    defaults={"name": codename})
    employee.permissions.add(permission)

def product_payload(category):
    return {"name": "Audit product", "category_id": category.id, "price_partner": "80",
            "price_min": "90", "price_recommended": "100", "initial_quantity": "2",
            "initial_cost_price": "60"}

def test_regression_staff_without_permissions_can_write_cashbox():
    _, _, _, employee, client = context(staff=True)
    assert employee.permissions.count() == 0
    response = client.post("/api/v1/cashbox/expenses/", {"amount": "100", "category": "Audit"}, format="json")
    assert response.status_code == 403

def test_regression_catalog_permission_alone_grants_initial_stock():
    _, tenant, _, employee, client = context(staff=True)
    grant(employee, "catalog", "add_product")
    category = CategoryFactory(tenant=tenant)
    response = client.post("/api/v1/catalog/products/", product_payload(category), format="json")
    assert response.status_code == 403
    assert not Stock.objects.filter(tenant=tenant).exists()

def test_regression_web_notifications_disabled_breaks_shift_close():
    owner, tenant, *_ = context()
    tenant.notify_web_reports = False
    tenant.shift_report_target = "personal"
    tenant.save(update_fields=["notify_web_reports", "shift_report_target"])
    report = CashboxService.close_shift(tenant=tenant, user=owner, actual_cash_uzs=D("0"), actual_cash_usd=D("0"))
    assert report.shift.closed_at is not None

def test_regression_b2b_return_overstates_analytics():
    owner, tenant, *_ = context()
    variant = ProductVariantFactory(product=ProductFactory(category=CategoryFactory(tenant=tenant)))
    sale = SaleFactory(tenant=tenant, sold_by=owner, status=Sale.STATUS_B2B_PARTIALLY_ACCEPTED,
                       total_amount=D("1000"), refunded_amount=D("400"))
    SaleItemFactory(sale=sale, product_variant=variant, quantity=D("10"), unit_price=D("100"),
                    cost_price=D("60"), total_price=D("1000"), b2b_accepted_quantity=D("6"),
                    b2b_rejected_quantity=D("4"), status=SaleItem.STATUS_B2B_PARTIALLY_ACCEPTED)
    result = AnalyticsService.get_dashboard_summary(tenant=tenant)
    assert result["total_sales_uzs"] == "600.00"
    assert result["net_profit_uzs"] == "240.00"
    assert sale.net_amount == D("600")

def test_regression_partial_b2b_item_missing_from_deficit():
    owner, tenant, *_ = context()
    variant = ProductVariantFactory(product=ProductFactory(category=CategoryFactory(tenant=tenant)))
    Stock.objects.create(tenant=tenant, product_variant=variant, quantity=D("1"))
    sale = SaleFactory(tenant=tenant, sold_by=owner, status=Sale.STATUS_B2B_PARTIALLY_ACCEPTED)
    SaleItemFactory(sale=sale, product_variant=variant, quantity=D("12"),
                    b2b_accepted_quantity=D("11"), b2b_rejected_quantity=D("1"),
                    status=SaleItem.STATUS_B2B_PARTIALLY_ACCEPTED)
    assert len(DeficitService.get_deficit_variants(tenant)) == 1

def test_regression_internal_transfer_loses_cost_and_allows_incompatible_units():
    owner, source, *_ = context()
    destination = TenantFactory(owner=owner, seller_profile=source.seller_profile)
    EmployeeFactory(user=owner, tenant=destination, is_owner=True)
    source_variant = ProductVariantFactory(product=ProductFactory(category=CategoryFactory(tenant=source)), unit="kg")
    target_variant = ProductVariantFactory(product=ProductFactory(category=CategoryFactory(tenant=destination, currency="USD")), unit="dona")
    Stock.objects.create(tenant=source, product_variant=source_variant, quantity=D("10"), last_cost_price=D("60"))
    with pytest.raises(TenantTransferError):
        TenantTransferService.dispatch(source=source, destination_id=destination.id, actor=owner,
            request_key=uuid4(), items=[{"source_variant_id": source_variant.id,
            "quantity": D("2"), "destination_variant_id": target_variant.id}])
    target_variant = ProductVariantFactory(product=ProductFactory(category=CategoryFactory(tenant=destination)), unit="kg")
    TenantTransferService.dispatch(source=source, destination_id=destination.id, actor=owner,
        request_key=uuid4(), items=[{"source_variant_id": source_variant.id,
        "quantity": D("2"), "destination_variant_id": target_variant.id}])
    target_stock = Stock.objects.get(product_variant=target_variant)
    assert target_stock.quantity == D("2")
    assert target_stock.last_cost_price == D("60")

def test_regression_invalid_variant_id_updates_first_variant():
    _, tenant, _, _, client = context()
    variant = ProductVariantFactory(product=ProductFactory(category=CategoryFactory(tenant=tenant)))
    response = client.patch(f"/api/v1/catalog/products/{variant.product_id}/",
                            {"variant_id": 2147483647, "price_min": "1"}, format="json")
    assert response.status_code == 404
    variant.refresh_from_db()
    assert variant.price_min == D("10000")

def test_regression_failed_initial_stock_leaves_product_committed():
    _, tenant, _, _, client = context()
    category = CategoryFactory(tenant=tenant)
    with patch.object(StockService, "intake", side_effect=StockServiceError("Audit forced intake failure")):
        response = client.post("/api/v1/catalog/products/", product_payload(category), format="json")
    assert response.status_code == 400
    assert not Product.objects.filter(tenant=tenant, name="Audit product").exists()

def test_regression_profile_accepts_weak_password():
    owner, _, _, _, client = context()
    response = client.post("/api/v1/auth/change-password/",
                           {"old_password": "InitialStrongPassword42!", "new_password": "12345678"}, format="json")
    assert response.status_code == 400
    owner.refresh_from_db()
    assert owner.check_password("InitialStrongPassword42!")

def test_regression_reset_delivery_failure_reported_as_success():
    with patch("apps.accounts.services.password_reset_service.request_password_reset_with_hint",
               return_value=(False, "email_send_failed", None)):
        response = APIClient().post("/api/v1/auth/password-reset/request/", {"login": "audit"}, format="json")
    assert response.status_code == 502

def test_regression_stale_profile_save_restores_revoked_account():
    owner, _, _, _, client = context()
    old_version = owner.token_version
    User.objects.filter(pk=owner.pk).update(is_active=False, token_version=old_version + 1)
    response = client.patch("/api/v1/auth/profile/", {"first_name": "Audit"}, format="json")
    assert response.status_code == 200
    owner.refresh_from_db()
    assert owner.is_active is False
    assert owner.token_version == old_version + 1

def test_regression_same_idempotency_key_rejects_different_cart():
    owner, tenant, *_ = context()
    variant = ProductVariantFactory(product=ProductFactory(category=CategoryFactory(tenant=tenant)))
    Stock.objects.create(tenant=tenant, product_variant=variant, quantity=D("10"), last_cost_price=D("60"))
    with override_settings(DEBUG=True):
        first = SaleService.create_sale(tenant=tenant, user=owner, idempotency_key="audit",
                                       items_data=[{"product_variant_id": variant.id, "quantity": "1", "unit_price": "100"}])
        with pytest.raises(SaleServiceError, match="boshqa savat"):
            SaleService.create_sale(tenant=tenant, user=owner, idempotency_key="audit",
                items_data=[{"product_variant_id": variant.id, "quantity": "3", "unit_price": "100"}])
    assert first[0].items.get().quantity == D("1")

@pytest.mark.django_db(transaction=True)
def test_regression_parallel_idempotency_creates_one_sale():
    owner, tenant, *_ = context()
    variant = ProductVariantFactory(product=ProductFactory(category=CategoryFactory(tenant=tenant)))
    Stock.objects.create(tenant=tenant, product_variant=variant, quantity=D("10"), last_cost_price=D("60"))
    barrier = Barrier(2)
    def checkout():
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            return SaleService.create_sale(tenant=tenant, user=owner, idempotency_key="parallel-audit",
                                          items_data=[{"product_variant_id": variant.id, "quantity": "1", "unit_price": "100"}])[0].id
        finally:
            close_old_connections()
    with override_settings(DEBUG=True):
        with ThreadPoolExecutor(max_workers=2) as pool:
            ids = list(pool.map(lambda _: checkout(), range(2)))
    assert len(set(ids)) == 1
    assert Sale.objects.filter(tenant=tenant, idempotency_key="parallel-audit").count() == 1


def test_cashbox_permissions_can_be_granted_for_one_shop():
    _, tenant, _, employee, client = context(staff=True)
    grant(employee, "cashbox", "record_income")
    assert client.post("/api/v1/cashbox/income/", {"amount": "100", "source": "Test"}, format="json").status_code == 201
    assert client.post("/api/v1/cashbox/expenses/", {"amount": "10", "category": "Test"}, format="json").status_code == 403
    other = TenantFactory()
    employee.is_active = False
    employee.save(update_fields=["is_active"])
    EmployeeFactory(user=employee.user, tenant=other)
    client.credentials(HTTP_X_TENANT_ID=str(other.pk))
    assert client.post("/api/v1/cashbox/income/", {"amount": "100", "source": "Test"}, format="json").status_code == 403


def test_cash_debt_card_and_cross_shift_refund_balance():
    from apps.sales.services import DebtService, VoidService
    from tests.factories import CounterpartyFactory
    from apps.cashbox.models import CashShift
    owner, tenant, *_ = context()
    shift = CashShift.objects.get(tenant=tenant, closed_at__isnull=True)
    shift.opening_cash_uzs = D("100")
    shift.save(update_fields=["opening_cash_uzs"])
    cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs=D("1000"))
    cash = DebtService.record_payment(counterparty=cp, recorded_by=owner, amount=D("30"), currency="UZS", payment_type="cash", idempotency_key="cash-1")
    replay = DebtService.record_payment(counterparty=cp, recorded_by=owner, amount=D("30"), currency="UZS", payment_type="cash", idempotency_key="cash-1")
    assert replay.pk == cash.pk
    DebtService.record_payment(counterparty=cp, recorded_by=owner, amount=D("40"), currency="UZS", payment_type="card")
    variant = ProductVariantFactory(product=ProductFactory(category=CategoryFactory(tenant=tenant)))
    Stock.objects.create(tenant=tenant, product_variant=variant, quantity=D("10"), last_cost_price=D("60"))
    with override_settings(DEBUG=True):
        sale = SaleService.create_sale(tenant=tenant, user=owner, items_data=[{"product_variant_id": variant.pk, "quantity": "2", "unit_price": "100"}])[0]
    assert CashboxService.get_current_shift_status(tenant)["expected_cash_uzs"] == D("330")
    report = CashboxService.close_shift(tenant=tenant, user=owner, actual_cash_uzs=D("330"), actual_cash_usd=D("0"), shift_id=shift.pk)
    assert report.collected_debt_cash_uzs == D("30")
    assert CashboxService.get_current_shift_status(tenant)["suggested_opening_cash_uzs"] == D("330")
    new_shift = CashboxService.open_shift(tenant=tenant, user=owner, opening_cash_uzs=D("330"))
    assert CashboxService.close_shift(tenant=tenant, user=owner, actual_cash_uzs=D("330"), actual_cash_usd=D("0"), shift_id=shift.pk).pk == report.pk
    new_shift.refresh_from_db()
    assert new_shift.closed_at is None
    VoidService.void_sale_item(sale_item=sale.items.get(), quantity=D("1"), user=owner, reason="Qaytarildi")
    sale.refresh_from_db()
    assert sale.total_amount == D("200") and sale.refunded_amount == D("100") and sale.net_amount == D("100")
    assert CashboxService.get_current_shift_status(tenant)["expected_cash_uzs"] == D("230")
    VoidService.void_sale(sale=sale, user=owner, reason="Qolganini qaytarish")
    assert CashboxService.get_current_shift_status(tenant)["expected_cash_uzs"] == D("130")
    new_report = CashboxService.close_shift(tenant=tenant, user=owner, actual_cash_uzs=D("130"), actual_cash_usd=D("0"))
    assert new_report.refund_cash_uzs == D("200")
    CashboxService.open_shift(tenant=tenant, user=owner, opening_cash_uzs=D("0"))
    assert CashboxService.get_current_shift_status(tenant)["expected_cash_uzs"] == D("0")


def test_revoked_refresh_cannot_issue_new_access():
    from api.v1.accounts.views.misc import issue_tokens
    owner, *_ = context()
    tokens = issue_tokens(owner)
    User.objects.filter(pk=owner.pk).update(token_version=owner.token_version + 1)
    assert APIClient().post("/api/v1/auth/token/refresh/", {"refresh": tokens["refresh"]}, format="json").status_code == 401


def test_sensitive_cost_requires_its_own_permission():
    _, tenant, _, employee, client = context(staff=True)
    grant(employee, "inventory", "view_stock")
    variant = ProductVariantFactory(product=ProductFactory(category=CategoryFactory(tenant=tenant)))
    Stock.objects.create(tenant=tenant, product_variant=variant, quantity=D("1"), last_cost_price=D("60"))
    result = client.get("/api/v1/inventory/stock/")
    assert result.status_code == 200 and "last_cost_price" not in result.data[0]
    grant(employee, "catalog", "view_cost_price")
    assert client.get("/api/v1/inventory/stock/").data[0]["last_cost_price"] == "60.00"


def test_counterparty_links_only_explicit_shop_code():
    from apps.sales.services.counterparty_service import CounterpartyService
    _, tenant, *_ = context()
    target = TenantFactory()
    cp = CounterpartyService.create(tenant=tenant, name="Hamkor", phone_number="+998909991122", target_tenant_code=target.public_code)
    assert cp.target_tenant_id == target.pk


def test_daily_report_is_queued_once_per_local_day():
    from apps.cashbox.tasks import check_and_send_daily_reports_task
    _, tenant, *_ = context()
    tenant.daily_report_target = "personal"
    tenant.daily_report_time = timezone.localtime().time().replace(second=0, microsecond=0, tzinfo=None)
    tenant.save(update_fields=["daily_report_target", "daily_report_time"])
    with patch("apps.cashbox.tasks.send_daily_report_for_tenant_task.delay") as queued:
        assert check_and_send_daily_reports_task() == 1
        assert check_and_send_daily_reports_task() == 0
        queued.assert_called_once_with(tenant.pk)


def test_telegram_false_result_activates_retry():
    from celery.exceptions import Retry
    from apps.sales.tasks import send_async_telegram_message_task
    with patch("apps.sales.tasks.send_telegram_message", return_value=False):
        with pytest.raises(Retry):
            send_async_telegram_message_task.apply(args=["123", "test"], throw=True)


def test_cash_b2b_split_return_rounding_matches_receipt_and_cashbox():
    from apps.sales.services.b2b_transfer_service import B2BTransferService
    from tests.factories import CounterpartyFactory
    owner, tenant, *_ = context()
    target = TenantFactory()
    EmployeeFactory(user=target.owner, tenant=target, is_owner=True)
    cp = CounterpartyFactory(tenant=tenant, target_tenant=target)
    variant = ProductVariantFactory(product=ProductFactory(category=CategoryFactory(tenant=tenant)))
    Stock.objects.create(tenant=tenant, product_variant=variant, quantity=D("1"), last_cost_price=D("0"))
    with override_settings(DEBUG=True):
        sale = SaleService.create_sale(tenant=tenant, user=owner, counterparty=cp, payment_type="cash", items_data=[{"product_variant_id": variant.pk, "quantity": "1", "unit_price": "0.03"}])[0]
    B2BTransferService.reject_transfer(sale=sale, rejecting_user=target.owner, tenant=target, reason="Qaytarish")
    item = sale.items.get()
    for key in ("part-1", "part-2"):
        B2BTransferService.receive_return(sale=sale, receiving_user=owner, tenant=tenant,
            reason="Qabul qilindi", idempotency_key=key, items_payload=[{"sale_item_id": item.pk, "quantity": "0.5"}])
    sale.refresh_from_db()
    cp.refresh_from_db()
    assert sale.refunded_amount == D("0.03") and sale.net_amount == D("0")
    assert cp.debt_balance_uzs == D("0")
    assert CashboxService.get_current_shift_status(tenant)["expected_cash_uzs"] == D("0")


def test_inventory_zero_cost_is_not_replaced_with_a_retail_price():
    _, tenant, *_ = context()
    variant = ProductVariantFactory(product=ProductFactory(category=CategoryFactory(tenant=tenant)))
    Stock.objects.create(tenant=tenant, product_variant=variant, quantity=D("2"), last_cost_price=D("0"))
    result = AnalyticsService.get_dashboard_summary(tenant=tenant)
    assert result["store_overview"]["inventory_cost_value_uzs"] == "0.00"


def test_avatar_rejects_html_and_reencodes_valid_images(tmp_path):
    import io
    from PIL import Image
    from django.core.files.uploadedfile import SimpleUploadedFile
    owner, _, _, _, client = context()
    with override_settings(MEDIA_ROOT=tmp_path):
        response = client.post('/api/v1/auth/profile/avatar/', {'avatar': SimpleUploadedFile('avatar.html', b'<script>alert(1)</script>', content_type='text/html')}, format='multipart')
        assert response.status_code == 400
        owner.refresh_from_db()
        assert not owner.avatar
        source = io.BytesIO()
        Image.new('RGB', (4, 4), 'blue').save(source, format='PNG')
        response = client.post('/api/v1/auth/profile/avatar/', {'avatar': SimpleUploadedFile('photo.png', source.getvalue(), content_type='image/png')}, format='multipart')
        assert response.status_code == 200
        owner.refresh_from_db()
        assert owner.avatar.name.endswith('.webp')


def test_head_and_options_use_the_read_permission():
    _, _, _, employee, client = context(staff=True)
    grant(employee, 'catalog', 'view_product')
    assert client.head('/api/v1/catalog/products/').status_code == 200
    assert client.options('/api/v1/catalog/products/').status_code == 200
    assert client.post('/api/v1/catalog/products/', {'name': 'Denied'}, format='json').status_code == 403


def test_login_aliases_share_throttle_and_permanent_ban_revokes_tokens():
    from apps.accounts.services import login_throttle
    owner, *_ = context()
    owner.email = 'alias-test@example.com'
    owner.save(update_fields=['email'])
    version = owner.token_version
    try:
        keys = [login_throttle._attempts_key(value) for value in (owner.username, owner.phone_number, owner.email)]
        assert len(set(keys)) == 1
        login_throttle.register_failure(owner.username)
        login_throttle.register_failure(owner.phone_number)
        login_throttle.register_failure(owner.email)
        assert login_throttle.redis_client.get(keys[0]) == '3'
        login_throttle.register_success(owner.email)
        login_throttle.redis_client.set(login_throttle._stage_key(owner.phone_number), 2)
        login_throttle.redis_client.set(login_throttle._strikes_key(owner.email), 2)
        login_throttle.register_failure(owner.phone_number)
        owner.refresh_from_db()
        assert owner.is_active is False and owner.token_version == version + 1
    finally:
        login_throttle.register_success(owner.username)
