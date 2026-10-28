from decimal import Decimal
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.catalog.models import ProductVariant
from apps.inventory.models import Stock
from apps.inventory.services.deficit_service import DeficitService
from apps.inventory.tasks import (
    check_and_send_low_stock_reports_task,
    send_low_stock_report_for_tenant_task,
)
from apps.permissions.models import Permission
from apps.sales.models import Notification, Sale, SaleItem
from tests.factories import (
    EmployeeFactory,
    ProductVariantFactory,
    SaleFactory,
    SaleItemFactory,
    StaffFactory,
    TenantFactory,
)

pytestmark = pytest.mark.django_db

DEFICITS_URL = "/api/v1/inventory/deficits/"
SEND_NOW_URL = "/api/v1/tenants/current/send-low-stock-report-now/"


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def inventory_staff(tenant):
    user = StaffFactory()
    employee = EmployeeFactory(user=user, tenant=tenant, is_active=True)
    employee.permissions.set(Permission.objects.filter(category="inventory"))
    return user


class TestDeficitService:
    def test_deficit_service_criteria_and_dynamic_resolution(self, tenant):
        # Variant A: Sold 12 in last 30 days, stock = 3 -> DEFICIT
        variant_a = ProductVariantFactory(tenant=tenant, name="Qizil", code="VAR-A")
        Stock.objects.create(tenant=tenant, product_variant=variant_a, quantity=Decimal("3.000"))

        sale_a = SaleFactory(tenant=tenant, status=Sale.STATUS_COMPLETED)
        SaleItemFactory(
            sale=sale_a,
            product_variant=variant_a,
            quantity=Decimal("12.000"),
            voided_quantity=Decimal("0.000"),
        )

        # Variant B: Sold 15 in last 30 days, stock = 10 -> NOT deficit (sufficient stock)
        variant_b = ProductVariantFactory(tenant=tenant, name="Ko'k", code="VAR-B")
        Stock.objects.create(tenant=tenant, product_variant=variant_b, quantity=Decimal("10.000"))

        sale_b = SaleFactory(tenant=tenant, status=Sale.STATUS_COMPLETED)
        SaleItemFactory(
            sale=sale_b,
            product_variant=variant_b,
            quantity=Decimal("15.000"),
        )

        # Variant C: Sold 5 in last 30 days (less than 10), stock = 2 -> NOT deficit (not high demand)
        variant_c = ProductVariantFactory(tenant=tenant, name="Yashil", code="VAR-C")
        Stock.objects.create(tenant=tenant, product_variant=variant_c, quantity=Decimal("2.000"))

        sale_c = SaleFactory(tenant=tenant, status=Sale.STATUS_COMPLETED)
        SaleItemFactory(
            sale=sale_c,
            product_variant=variant_c,
            quantity=Decimal("5.000"),
        )

        # Variant D: Sold 10 in last 30 days, stock = 5 -> DEFICIT (boundary condition stock <= 5)
        variant_d = ProductVariantFactory(tenant=tenant, name="Oq", code="VAR-D")
        Stock.objects.create(tenant=tenant, product_variant=variant_d, quantity=Decimal("5.000"))

        sale_d = SaleFactory(tenant=tenant, status=Sale.STATUS_COMPLETED)
        SaleItemFactory(
            sale=sale_d,
            product_variant=variant_d,
            quantity=Decimal("10.000"),
        )

        deficits = DeficitService.get_deficit_variants(tenant)
        deficit_ids = [d["product_variant_id"] for d in deficits]

        assert variant_a.id in deficit_ids
        assert variant_d.id in deficit_ids
        assert variant_b.id not in deficit_ids
        assert variant_c.id not in deficit_ids
        assert len(deficits) == 2

        # Dynamic Restock: Intake on variant_a bringing stock to 15 (> 5)
        stock_a = Stock.objects.get(product_variant=variant_a)
        stock_a.quantity = Decimal("15.000")
        stock_a.save()

        deficits_after = DeficitService.get_deficit_variants(tenant)
        deficit_ids_after = [d["product_variant_id"] for d in deficits_after]

        assert variant_a.id not in deficit_ids_after
        assert variant_d.id in deficit_ids_after
        assert len(deficits_after) == 1

    def test_format_telegram_deficit_report(self, tenant):
        variant = ProductVariantFactory(tenant=tenant, name="M-Razmer")
        deficit_items = [
            {
                "id": variant.id,
                "full_name": "Futbolka (M-Razmer)",
                "code": "FUT-01",
                "unit": "dona",
                "total_sold_last_month": 25.0,
                "current_stock": 2.0,
                "status": "critical",
            }
        ]
        msg = DeficitService.format_telegram_deficit_report(tenant, deficit_items)
        assert "KAMAYIB QOLGAN TOVARLAR" in msg
        assert "Futbolka (M-Razmer)" in msg
        assert "25 dona" in msg
        assert "2 dona" in msg


class TestDeficitStockListView:
    def test_list_deficits_endpoint(self, api_client, inventory_staff, tenant):
        variant = ProductVariantFactory(tenant=tenant, name="Poyabzal")
        Stock.objects.create(tenant=tenant, product_variant=variant, quantity=Decimal("1.000"))

        sale = SaleFactory(tenant=tenant, status=Sale.STATUS_COMPLETED)
        SaleItemFactory(
            sale=sale,
            product_variant=variant,
            quantity=Decimal("20.000"),
        )

        api_client.force_authenticate(user=inventory_staff)
        res = api_client.get(DEFICITS_URL)
        assert res.status_code == 200
        data = res.json()
        assert len(data) == 1
        assert data[0]["product_variant_id"] == variant.id
        assert data[0]["current_stock"] == 1.0
        assert data[0]["total_sold_last_month"] == 20.0

    def test_search_deficit_endpoint(self, api_client, inventory_staff, tenant):
        v1 = ProductVariantFactory(tenant=tenant, name="Olma")
        Stock.objects.create(tenant=tenant, product_variant=v1, quantity=Decimal("2.000"))
        s1 = SaleFactory(tenant=tenant, status=Sale.STATUS_COMPLETED)
        SaleItemFactory(sale=s1, product_variant=v1, quantity=Decimal("12.000"))

        v2 = ProductVariantFactory(tenant=tenant, name="Nok")
        Stock.objects.create(tenant=tenant, product_variant=v2, quantity=Decimal("2.000"))
        s2 = SaleFactory(tenant=tenant, status=Sale.STATUS_COMPLETED)
        SaleItemFactory(sale=s2, product_variant=v2, quantity=Decimal("15.000"))

        api_client.force_authenticate(user=inventory_staff)
        res = api_client.get(f"{DEFICITS_URL}?search=Olma")
        assert res.status_code == 200
        data = res.json()
        assert len(data) == 1
        assert data[0]["product_variant_id"] == v1.id


class TestLowStockReportTasksAndTriggerNow:
    def test_send_now_endpoint_as_owner(self, api_client, tenant):
        # Seed a deficit item
        v = ProductVariantFactory(tenant=tenant, name="Choy")
        Stock.objects.create(tenant=tenant, product_variant=v, quantity=Decimal("3.000"))
        s = SaleFactory(tenant=tenant, status=Sale.STATUS_COMPLETED)
        SaleItemFactory(sale=s, product_variant=v, quantity=Decimal("10.000"))

        api_client.force_authenticate(user=tenant.owner)

        with patch("apps.inventory.tasks.send_async_telegram_message_task") as mock_tg:
            res = api_client.post(SEND_NOW_URL)
            assert res.status_code == 200
            data = res.json()
            assert data["success"] is True
            assert data["count"] == 1

        # In-app notification created
        notif = Notification.objects.filter(tenant=tenant, type=Notification.TYPE_LOW_STOCK_ALERT).first()
        assert notif is not None
        assert "1 ta" in notif.title

    def test_send_low_stock_report_for_tenant_task(self, tenant):
        tenant.telegram_group_id = "-100123456789"
        tenant.notify_web_low_stock = True
        tenant.low_stock_report_target = "both"
        tenant.save()

        v = ProductVariantFactory(tenant=tenant, name="Non")
        Stock.objects.create(tenant=tenant, product_variant=v, quantity=Decimal("2.000"))
        s = SaleFactory(tenant=tenant, status=Sale.STATUS_COMPLETED)
        SaleItemFactory(sale=s, product_variant=v, quantity=Decimal("15.000"))

        with patch("apps.inventory.tasks.send_async_telegram_message_task") as mock_tg:
            result = send_low_stock_report_for_tenant_task(tenant.id)
            assert result["success"] is True
            assert result["count"] == 1
            # Mock called for group and owner
            assert mock_tg.delay.called

        tenant.refresh_from_db()
        assert tenant.last_low_stock_report_sent_at is not None

    def test_check_and_send_periodic_runner(self, tenant):
        now = timezone.localtime()
        tenant.low_stock_report_time = now.time()
        tenant.low_stock_frequency = "daily"
        tenant.low_stock_report_target = "user"
        tenant.save()

        with patch("apps.inventory.tasks.send_low_stock_report_for_tenant_task.delay") as mock_send:
            res = check_and_send_low_stock_reports_task()
            assert res >= 1
            mock_send.assert_called_with(tenant.id)
