from tests.factories import EmployeeFactory
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.inventory.services import StockService
from apps.permissions.models import Permission
from apps.sales.models import Counterparty, Notification, Sale, SaleItem
from tests.factories import (
    CategoryFactory,
    CounterpartyFactory,
    EmployeeFactory,
    OwnerFactory,
    ProductFactory,
    ProductVariantFactory,
    StaffFactory,
    TenantFactory,
)

pytestmark = pytest.mark.django_db

SALES_URL = "/api/v1/sales/"
COUNTERPARTIES_URL = "/api/v1/sales/counterparties/"
NOTIFICATIONS_URL = "/api/v1/sales/notifications/"
B2B_INBOX_URL = "/api/v1/sales/b2b/inbox/"


@pytest.fixture
def api_client():
    return APIClient()


def create_tenant_with_owner(platform_admin):
    owner_user = OwnerFactory()
    t = TenantFactory(owner=owner_user)
    EmployeeFactory(
        user=owner_user,
        tenant=t,
        is_owner=True,
        is_active=True,
        position="Owner",
        hired_by=platform_admin,
    )
    return t, owner_user


@pytest.fixture
def staff_with_sales_permission(tenant):
    user = StaffFactory()
    employee = EmployeeFactory(user=user, tenant=tenant, is_active=True)
    employee.permissions.set(Permission.objects.filter(category="sales"))
    return user


@pytest.fixture
def staff_with_view_only(tenant):
    user = StaffFactory()
    employee = EmployeeFactory(user=user, tenant=tenant, is_active=True)
    employee.permissions.add(Permission.objects.get(category="sales", codename="view_sale"))
    return user


@pytest.fixture
def stocked_variant(tenant, owner):
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


class TestPlatformAdminIsBlocked:
    def test_platform_admin_cannot_list_sales(self, api_client, platform_admin):
        api_client.force_authenticate(user=platform_admin)
        response = api_client.get(SALES_URL)
        assert response.status_code == 403

    def test_platform_admin_cannot_create_sale(self, api_client, platform_admin):
        api_client.force_authenticate(user=platform_admin)
        response = api_client.post(SALES_URL, {"items": []})
        assert response.status_code == 403

    def test_platform_admin_cannot_list_counterparties(self, api_client, platform_admin):
        api_client.force_authenticate(user=platform_admin)
        response = api_client.get(COUNTERPARTIES_URL)
        assert response.status_code == 403


class TestPermissionEnforcement:
    def test_staff_with_no_permission_is_denied(self, api_client, tenant):
        user = StaffFactory()
        EmployeeFactory(user=user, tenant=tenant, is_active=True)
        api_client.force_authenticate(user=user)

        response = api_client.get(SALES_URL)
        assert response.status_code == 403

    def test_view_permission_does_not_grant_create(self, api_client, staff_with_view_only, stocked_variant):
        api_client.force_authenticate(user=staff_with_view_only)

        get_res = api_client.get(SALES_URL)
        assert get_res.status_code == 200

        post_res = api_client.post(
            SALES_URL,
            {
                "items": [{"product_variant_id": stocked_variant.id, "quantity": "1"}],
            },
            format="json",
        )
        assert post_res.status_code == 403

    def test_owner_bypasses_permissions(self, api_client, owner, tenant, stocked_variant):
        api_client.force_authenticate(user=owner)
        res = api_client.post(
            SALES_URL,
            {
                "items": [{"product_variant_id": stocked_variant.id, "quantity": "1"}],
            },
            format="json",
        )
        assert res.status_code == 201


class TestTenantIsolation:
    def test_owner_cannot_see_other_tenant_sales(self, api_client, owner, tenant, stocked_variant, platform_admin):
        other_tenant, other_owner = create_tenant_with_owner(platform_admin)
        other_cat = CategoryFactory(tenant=other_tenant)
        other_prod = ProductFactory(tenant=other_tenant, category=other_cat)
        other_var = ProductVariantFactory(tenant=other_tenant, product=other_prod)
        StockService.intake(
            tenant=other_tenant,
            product_variant=other_var,
            quantity=Decimal("10"),
            cost_price=Decimal("5000"),
            created_by=other_owner,
        )

        # Create sale in other tenant
        api_client.force_authenticate(user=other_owner)
        other_res = api_client.post(
            SALES_URL,
            {
                "items": [{"product_variant_id": other_var.id, "quantity": "1"}],
            },
            format="json",
        )
        assert other_res.status_code == 201
        other_sale_id = other_res.data[0]["id"]

        # Authenticate as first tenant owner
        api_client.force_authenticate(user=owner)
        list_res = api_client.get(SALES_URL)
        sale_ids = [s["id"] for s in list_res.data]
        assert other_sale_id not in sale_ids

        # Direct ID fetch returns 404
        detail_res = api_client.get(f"{SALES_URL}{other_sale_id}/")
        assert detail_res.status_code == 404


class TestSaleEndpoints:
    def test_create_sale_flow(self, api_client, staff_with_sales_permission, stocked_variant):
        api_client.force_authenticate(user=staff_with_sales_permission)

        response = api_client.post(
            SALES_URL,
            {
                "items": [
                    {
                        "product_variant_id": stocked_variant.id,
                        "quantity": "2",
                        "unit_price": "12000.00",
                    }
                ],
                "payment_type": "cash",
            },
            format="json",
        )

        assert response.status_code == 201
        assert len(response.data) == 1
        sale_data = response.data[0]
        assert sale_data["currency"] == "UZS"
        assert sale_data["total_amount"] == "24000.00"
        assert len(sale_data["items"]) == 1

    def test_void_sale_endpoint(self, api_client, staff_with_sales_permission, stocked_variant):
        api_client.force_authenticate(user=staff_with_sales_permission)

        res = api_client.post(
            SALES_URL,
            {
                "items": [{"product_variant_id": stocked_variant.id, "quantity": "2"}],
            },
            format="json",
        )
        sale_id = res.data[0]["id"]

        void_res = api_client.post(
            f"{SALES_URL}{sale_id}/void/",
            {
                "reason": "Mijoz xato mahsulot olgan",
            },
            format="json",
        )

        assert void_res.status_code == 200
        assert void_res.data["status"] == "voided"
        assert void_res.data["void_reason"] == "Mijoz xato mahsulot olgan"

    def test_create_sale_insufficient_stock_returns_400(self, api_client, staff_with_sales_permission, stocked_variant):
        api_client.force_authenticate(user=staff_with_sales_permission)

        # Stocked variant has 50 in stock, request 100
        response = api_client.post(
            SALES_URL,
            {
                "items": [
                    {
                        "product_variant_id": stocked_variant.id,
                        "quantity": "100",
                        "unit_price": "12000.00",
                    }
                ],
                "payment_type": "cash",
            },
            format="json",
        )

        assert response.status_code == 400
        assert "Omborda yetarli mahsulot qoldig'i yo'q" in str(response.data)


class TestCounterpartyEndpoints:
    def test_counterparty_crud(self, api_client, staff_with_sales_permission, tenant):
        api_client.force_authenticate(user=staff_with_sales_permission)

        # Create
        create_res = api_client.post(
            COUNTERPARTIES_URL,
            {
                "name": "Vali",
                "phone_number": "+998901239988",
                "note": "Xaridlar uchun",
            },
            format="json",
        )
        assert create_res.status_code == 201
        cp_id = create_res.data["id"]

        # List
        list_res = api_client.get(COUNTERPARTIES_URL)
        assert list_res.status_code == 200
        assert any(c["id"] == cp_id for c in list_res.data)

        # Detail
        detail_res = api_client.get(f"{COUNTERPARTIES_URL}{cp_id}/")
        assert detail_res.status_code == 200
        assert detail_res.data["name"] == "Vali"

        # Update
        patch_res = api_client.patch(
            f"{COUNTERPARTIES_URL}{cp_id}/",
            {
                "name": "Valijon",
            },
            format="json",
        )
        assert patch_res.status_code == 200
        assert patch_res.data["name"] == "Valijon"

        # Archive
        del_res = api_client.delete(f"{COUNTERPARTIES_URL}{cp_id}/")
        assert del_res.status_code == 200
        cp = Counterparty.objects.get(pk=cp_id)
        assert cp.is_active is False

    def test_get_counterparty_sales_endpoint(self, api_client, owner, tenant, stocked_variant):
        cp = CounterpartyFactory(tenant=tenant)
        api_client.force_authenticate(user=owner)

        # Create a debt sale for this counterparty
        sale_res = api_client.post(
            SALES_URL,
            {
                "items": [{"product_variant_id": stocked_variant.id, "quantity": "2", "unit_price": "15000.00"}],
                "payment_type": "debt",
                "counterparty_id": cp.id,
            },
            format="json",
        )
        assert sale_res.status_code == 201

        # Fetch counterparty sales
        res = api_client.get(f"{COUNTERPARTIES_URL}{cp.id}/sales/")
        assert res.status_code == 200
        assert "sales" in res.data
        assert res.data["total_sales_count"] == 1
        assert res.data["debt_sales_count"] == 1
        assert len(res.data["sales"]) == 1

        sale_item = res.data["sales"][0]["items"][0]
        assert sale_item["product_variant"] == stocked_variant.id
        assert Decimal(sale_item["quantity"]) == Decimal("2.000")
        assert Decimal(sale_item["unit_price"]) == Decimal("15000.00")
        assert Decimal(sale_item["total_price"]) == Decimal("30000.00")
        assert sale_item["unit"] == stocked_variant.unit
        assert res.data["sales"][0]["sold_by_name"] != ""


class TestDebtPaymentEndpoints:
    def test_owner_can_record_payment(self, api_client, owner, tenant):
        cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs=Decimal("100000.00"))
        api_client.force_authenticate(user=owner)

        res = api_client.post(
            f"{COUNTERPARTIES_URL}{cp.id}/payments/",
            {
                "amount": "40000.00",
                "currency": "UZS",
                "note": "Qarz qisman to'landi",
            },
            format="json",
        )

        assert res.status_code == 201
        assert res.data["amount"] == "40000.00"
        cp.refresh_from_db()
        assert cp.debt_balance_uzs == Decimal("60000.00")

    def test_correction_endpoint(self, api_client, owner, tenant):
        cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs=Decimal("50000.00"))
        api_client.force_authenticate(user=owner)

        res = api_client.post(
            f"{COUNTERPARTIES_URL}{cp.id}/payments/correct/",
            {
                "amount": "-10000.00",
                "currency": "UZS",
                "note": "Noto'g'ri ortiqcha to'lov bekor qilindi",
            },
            format="json",
        )

        assert res.status_code == 201
        assert res.data["is_correction"] is True
        cp.refresh_from_db()
        assert cp.debt_balance_uzs == Decimal("60000.00")

    def test_owner_can_record_payment_with_branch(self, api_client, owner, tenant):
        from tests.factories import TenantFactory
        branch2 = TenantFactory(owner=owner, name="Chilonzor filiali")
        EmployeeFactory(user=owner, tenant=branch2, is_owner=True)
        api_client.credentials(HTTP_X_TENANT_ID=str(tenant.pk))
        cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs=Decimal("80000.00"))
        api_client.force_authenticate(user=owner)

        res = api_client.post(
            f"{COUNTERPARTIES_URL}{cp.id}/payments/",
            {
                "amount": "30000.00",
                "currency": "UZS",
                "branch_id": branch2.id,
                "note": "Filial kassasida to'landi",
            },
            format="json",
        )

        assert res.status_code == 201
        assert res.data["amount"] == "30000.00"
        assert res.data["branch_id"] == branch2.id
        assert res.data["branch_name"] == "Chilonzor filiali"
        cp.refresh_from_db()
        assert cp.debt_balance_uzs == Decimal("50000.00")

    def test_counterparty_list_includes_last_payment(self, api_client, owner, tenant):
        from tests.factories import TenantFactory
        branch2 = TenantFactory(owner=owner, name="Yunusobod filiali")
        EmployeeFactory(user=owner, tenant=branch2, is_owner=True)
        api_client.credentials(HTTP_X_TENANT_ID=str(tenant.pk))
        cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs=Decimal("150000.00"))
        api_client.force_authenticate(user=owner)

        # Pay 25000 to branch2
        api_client.post(
            f"{COUNTERPARTIES_URL}{cp.id}/payments/",
            {
                "amount": "25000.00",
                "currency": "UZS",
                "branch_id": branch2.id,
                "note": "Birinchi to'lov",
            },
            format="json",
        )

        list_res = api_client.get(f"{COUNTERPARTIES_URL}")
        assert list_res.status_code == 200
        cp_data = next((item for item in list_res.data if item["id"] == cp.id), None)
        assert cp_data is not None
        assert cp_data["last_payment"] is not None
        assert cp_data["last_payment"]["amount"] == "25000.00"
        assert cp_data["last_payment"]["currency"] == "UZS"
        assert cp_data["last_payment"]["branch_name"] == "Yunusobod filiali"


class TestB2BEndpoints:
    def test_b2b_inbox_and_accept_flow(self, api_client, tenant, owner, stocked_variant, platform_admin):
        b_tenant, b_owner = create_tenant_with_owner(platform_admin)
        cat_b = CategoryFactory(tenant=b_tenant, currency="UZS")

        cp = CounterpartyFactory(tenant=tenant, target_tenant=b_tenant)

        # Create B2B sale from Tenant A
        api_client.force_authenticate(user=owner)
        sale_res = api_client.post(
            SALES_URL,
            {
                "items": [{"product_variant_id": stocked_variant.id, "quantity": "5", "unit_price": "12000.00"}],
                "payment_type": "debt",
                "counterparty_id": cp.id,
            },
            format="json",
        )
        assert sale_res.status_code == 201
        b2b_sale_id = sale_res.data[0]["id"]
        sale_item_id = sale_res.data[0]["items"][0]["id"]

        # Tenant B checks inbox
        api_client.force_authenticate(user=b_owner)
        inbox_res = api_client.get(B2B_INBOX_URL)
        assert inbox_res.status_code == 200
        inbox_sale = next(s for s in inbox_res.data if s["id"] == b2b_sale_id)
        assert "sold_by_name" not in inbox_sale
        assert "counterparty_phone" not in inbox_sale
        assert "cost_price" not in inbox_sale["items"][0]

        # Tenant B accepts
        accept_res = api_client.post(
            f"/api/v1/sales/b2b/{b2b_sale_id}/accept/",
            {
                "items": [
                    {
                        "sale_item_id": sale_item_id,
                        "accepted_quantity": "5.000",
                        "target_category_id": cat_b.id,
                    }
                ],
            },
            format="json",
        )

        assert accept_res.status_code == 200
        assert accept_res.data["status"] == "b2b_accepted"
        assert "sold_by_name" not in accept_res.data
        assert "cost_price" not in accept_res.data["items"][0]

    def test_b2b_return_is_received_by_sender_through_scoped_endpoint(
        self, api_client, tenant, owner, stocked_variant, platform_admin
    ):
        b_tenant, b_owner = create_tenant_with_owner(platform_admin)
        cp = CounterpartyFactory(tenant=tenant, target_tenant=b_tenant)
        api_client.force_authenticate(user=owner)
        sale_res = api_client.post(
            SALES_URL,
            {
                "items": [{"product_variant_id": stocked_variant.id, "quantity": "2", "unit_price": "12000.00"}],
                "payment_type": "debt",
                "counterparty_id": cp.id,
            },
            format="json",
        )
        assert sale_res.status_code == 201
        sale = sale_res.data[0]
        item_id = sale["items"][0]["id"]

        api_client.force_authenticate(user=b_owner)
        reject = api_client.post(
            f"/api/v1/sales/b2b/{sale['id']}/reject/",
            {
                "reason": "Qaytarish",
            },
            format="json",
        )
        assert reject.status_code == 200
        assert reject.data["status"] == "b2b_return_pending"

        api_client.force_authenticate(user=owner)
        received = api_client.post(
            f"/api/v1/sales/b2b/{sale['id']}/returns/receive/",
            {
                "idempotency_key": "api-return-1",
                "reason": "Jismonan qabul qilindi",
                "items": [{"sale_item_id": item_id, "quantity": "1.000"}],
            },
            format="json",
        )
        assert received.status_code == 200
        assert received.data["sale"]["refunded_amount"] == "12000.00"
        assert received.data["sale"]["items"][0]["b2b_return_pending_quantity"] == "1.000"
        stocked_variant.stock.refresh_from_db()
        assert stocked_variant.stock.quantity == Decimal("49.000")

        # Only the source tenant may acknowledge physical receipt.
        api_client.force_authenticate(user=b_owner)
        forbidden = api_client.post(
            f"/api/v1/sales/b2b/{sale['id']}/returns/receive/",
            {
                "idempotency_key": "api-return-2",
                "reason": "Noto‘g‘ri tenant sinovi",
                "items": [{"sale_item_id": item_id, "quantity": "1.000"}],
            },
            format="json",
        )
        assert forbidden.status_code == 404

    def test_owner_can_close_b2b_return_discrepancy_and_adjust_finances(
        self, api_client, tenant, owner, stocked_variant, platform_admin
    ):
        b_tenant, b_owner = create_tenant_with_owner(platform_admin)
        cp = CounterpartyFactory(tenant=tenant, target_tenant=b_tenant)
        api_client.force_authenticate(user=owner)
        sale_res = api_client.post(
            SALES_URL,
            {
                "items": [{"product_variant_id": stocked_variant.id, "quantity": "2", "unit_price": "12000.00"}],
                "payment_type": "debt",
                "counterparty_id": cp.id,
            },
            format="json",
        )
        sale = sale_res.data[0]
        item_id = sale["items"][0]["id"]
        api_client.force_authenticate(user=b_owner)
        reject = api_client.post(
            f"/api/v1/sales/b2b/{sale['id']}/reject/",
            {"reason": "Qaytarish"},
            format="json",
        )
        assert reject.status_code == 200

        api_client.force_authenticate(user=owner)
        response = api_client.post(
            f"/api/v1/sales/b2b/{sale['id']}/returns/close-discrepancy/",
            {
                "idempotency_key": "api-discrepancy-1",
                "reason": "Tovar yo‘qolgan",
                "items": [{"sale_item_id": item_id, "quantity": "1.000"}],
            },
            format="json",
        )
        assert response.status_code == 200
        assert response.data["sale"]["refunded_amount"] == "12000.00"
        assert response.data["sale"]["items"][0]["b2b_discrepancy_closed_quantity"] == "1.000"
        assert response.data["sale"]["items"][0]["b2b_return_pending_quantity"] == "1.000"
        stocked_variant.stock.refresh_from_db()
        assert stocked_variant.stock.quantity == Decimal("48.000")
        cp.refresh_from_db()
        assert cp.debt_balance_uzs == Decimal("12000.00")

        staff = StaffFactory()
        EmployeeFactory(user=staff, tenant=tenant, is_active=True)
        api_client.force_authenticate(user=staff)
        denied = api_client.post(
            f"/api/v1/sales/b2b/{sale['id']}/returns/close-discrepancy/",
            {
                "idempotency_key": "api-discrepancy-staff",
                "reason": "Sinov",
                "items": [{"sale_item_id": item_id, "quantity": "1.000"}],
            },
            format="json",
        )
        assert denied.status_code == 403


class TestNotificationEndpoints:
    def test_list_and_read_notifications(self, api_client, owner, tenant):
        notif = Notification.objects.create(
            tenant=tenant,
            recipient=owner,
            type=Notification.TYPE_DEBT_WARNING,
            title="Qarz ogohlantirish",
            message="Test xabarnoma",
        )

        api_client.force_authenticate(user=owner)
        list_res = api_client.get(NOTIFICATIONS_URL)
        assert list_res.status_code == 200
        assert len(list_res.data) == 1
        assert list_res.data[0]["is_read"] is False

        # Mark read
        read_res = api_client.post(f"{NOTIFICATIONS_URL}{notif.id}/read/")
        assert read_res.status_code == 200
        notif.refresh_from_db()
        assert notif.is_read is True

    def test_clear_all_notifications(self, api_client, owner, tenant):
        Notification.objects.create(tenant=tenant, recipient=owner, type="info", title="1", message="1")
        Notification.objects.create(tenant=tenant, recipient=owner, type="info", title="2", message="2")
        assert Notification.objects.filter(recipient=owner).count() == 2

        api_client.force_authenticate(user=owner)
        del_res = api_client.delete(NOTIFICATIONS_URL)
        assert del_res.status_code == 204
        assert Notification.objects.filter(recipient=owner).count() == 0

    def test_delete_single_notification(self, api_client, owner, tenant):
        n1 = Notification.objects.create(tenant=tenant, recipient=owner, type="info", title="1", message="1")
        n2 = Notification.objects.create(tenant=tenant, recipient=owner, type="info", title="2", message="2")

        api_client.force_authenticate(user=owner)
        del_res = api_client.delete(f"{NOTIFICATIONS_URL}{n1.id}/")
        assert del_res.status_code == 204
        assert not Notification.objects.filter(id=n1.id).exists()
        assert Notification.objects.filter(id=n2.id).exists()


class TestPublicReceiptApi:
    def test_public_receipt_success_without_auth(
        self, api_client, tenant, staff_with_sales_permission, stocked_variant
    ):
        sale = Sale.objects.create(
            tenant=tenant,
            sold_by=staff_with_sales_permission,
            receipt_number="POS-20261008-9999",
            currency="UZS",
            total_amount=Decimal("50000.00"),
            payment_type="cash",
        )
        SaleItem.objects.create(
            tenant=tenant,
            sale=sale,
            product_variant=stocked_variant,
            quantity=Decimal("2.000"),
            unit_price=Decimal("25000.00"),
            cost_price=Decimal("15000.00"),
            total_price=Decimal("50000.00"),
        )

        # Unauthenticated request (public QR-code scan simulation)
        res = api_client.get(f"/api/v1/sales/public/receipt/{sale.public_token}/")
        assert res.status_code == 200
        data = res.data
        assert data["receipt_number"] == "POS-20261008-9999"
        assert data["store_name"] == tenant.name
        assert "id" not in data
        assert "sold_by_name" not in data
        assert "counterparty_name" not in data
        assert data["total_amount"] == "50000.00"
        assert len(data["items"]) == 1
        item = data["items"][0]
        assert item["product_name"] == stocked_variant.product.name
        assert Decimal(item["quantity"]) == Decimal("2.000")
        assert Decimal(item["unit_price"]) == Decimal("25000.00")
        assert Decimal(item["total_price"]) == Decimal("50000.00")
        # Confidential check:
        assert "cost_price" not in item
        assert "cost_price" not in str(data)

    def test_public_receipt_requires_opaque_token_and_owner_can_rotate_it(
        self, api_client, tenant, owner, staff_with_sales_permission
    ):
        sale = Sale.objects.create(
            tenant=tenant,
            sold_by=staff_with_sales_permission,
            receipt_number="POS-20261008-9998",
            total_amount=Decimal("1000.00"),
        )
        old_token = sale.public_token
        assert len(old_token) >= 40

        api_client.force_authenticate(user=owner)
        res = api_client.post(f"{SALES_URL}{sale.id}/receipt-token/rotate/")
        assert res.status_code == 200
        sale.refresh_from_db()
        assert sale.public_token == res.data["public_token"]
        assert sale.public_token != old_token

        old_res = api_client.get(f"/api/v1/sales/public/receipt/{old_token}/")
        new_res = api_client.get(f"/api/v1/sales/public/receipt/{sale.public_token}/")
        assert old_res.status_code == 404
        assert new_res.status_code == 200

    def test_staff_cannot_rotate_public_receipt_token(self, api_client, tenant, staff_with_sales_permission):
        sale = Sale.objects.create(
            tenant=tenant,
            sold_by=staff_with_sales_permission,
            receipt_number="POS-20261008-9997",
            total_amount=Decimal("1000.00"),
        )
        api_client.force_authenticate(user=staff_with_sales_permission)
        res = api_client.post(f"{SALES_URL}{sale.id}/receipt-token/rotate/")
        assert res.status_code == 403

    def test_public_receipt_not_found(self, api_client):
        res = api_client.get("/api/v1/sales/public/receipt/NOT-A-VALID-TOKEN/")
        assert res.status_code == 404
        assert res.data["detail"] == "Chek topilmadi."
