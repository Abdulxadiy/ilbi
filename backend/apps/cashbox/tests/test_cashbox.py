from decimal import Decimal

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from apps.cashbox.models import CashExpense, CashIncome
from apps.cashbox.services.cashbox_service import CashboxService, CashboxServiceError
from apps.sales.models import Notification, Sale
from tests.factories import (
    EmployeeFactory,
    OwnerFactory,
    TenantFactory,
)

pytestmark = pytest.mark.django_db

EXPENSES_URL = "/api/v1/cashbox/expenses/"
INCOME_URL = "/api/v1/cashbox/income/"
SHIFT_CURRENT_URL = "/api/v1/cashbox/shift/current/"
SHIFT_CLOSE_URL = "/api/v1/cashbox/shift/close/"
REPORTS_URL = "/api/v1/cashbox/reports/"


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


def test_record_expense_and_income_validation(tenant, owner):
    # Valid expense
    exp = CashboxService.record_expense(
        tenant=tenant,
        user=owner,
        amount=Decimal("15000.00"),
        currency="UZS",
        category="Xo'jalik",
        note="Choy va qand",
    )
    assert exp.id is not None
    assert exp.amount == Decimal("15000.00")
    assert exp.category == "Xo'jalik"

    # Valid income
    inc = CashboxService.record_income(
        tenant=tenant,
        user=owner,
        amount=Decimal("20000.00"),
        currency="UZS",
        source="Paynet",
    )
    assert inc.id is not None
    assert inc.amount == Decimal("20000.00")
    assert inc.source == "Paynet"

    # Validation errors
    with pytest.raises(CashboxServiceError, match="musbat bo'lishi kerak"):
        CashboxService.record_expense(tenant=tenant, user=owner, amount=Decimal("0.00"), category="X")

    with pytest.raises(CashboxServiceError, match="Noto'g'ri valyuta"):
        CashboxService.record_expense(tenant=tenant, user=owner, amount=Decimal("100.00"), currency="EUR", category="X")

    with pytest.raises(CashboxServiceError, match="kategoriyasi kiritilishi shart"):
        CashboxService.record_expense(tenant=tenant, user=owner, amount=Decimal("100.00"), category="")

    with pytest.raises(CashboxServiceError, match="manbasi kiritilishi shart"):
        CashboxService.record_income(tenant=tenant, user=owner, amount=Decimal("100.00"), source="")


def test_shift_flow_and_discrepancy_handling(tenant, owner):
    # 1. Sales
    Sale.objects.create(
        tenant=tenant,
        sold_by=owner,
        receipt_number="R1",
        payment_type=Sale.PAYMENT_CASH,
        currency=Sale.CURRENCY_UZS,
        total_amount=Decimal("100000.00"),
        status=Sale.STATUS_COMPLETED,
    )
    Sale.objects.create(
        tenant=tenant,
        sold_by=owner,
        receipt_number="R2",
        payment_type=Sale.PAYMENT_CARD,
        currency=Sale.CURRENCY_UZS,
        total_amount=Decimal("50000.00"),
        status=Sale.STATUS_COMPLETED,
    )
    Sale.objects.create(
        tenant=tenant,
        sold_by=owner,
        receipt_number="R3",
        payment_type=Sale.PAYMENT_CASH,
        currency=Sale.CURRENCY_USD,
        total_amount=Decimal("30.00"),
        status=Sale.STATUS_COMPLETED,
    )

    # 2. Income & Expense
    CashboxService.record_income(
        tenant=tenant,
        user=owner,
        amount=Decimal("10000.00"),
        currency="UZS",
        source="Paynet",
    )
    CashboxService.record_expense(
        tenant=tenant,
        user=owner,
        amount=Decimal("15000.00"),
        currency="UZS",
        category="Suv",
    )

    # 3. Check status
    shift_status = CashboxService.get_current_shift_status(tenant)
    assert shift_status["total_sale_cash_uzs"] == Decimal("100000.00")
    assert shift_status["total_sale_card_uzs"] == Decimal("50000.00")
    assert shift_status["total_sale_cash_usd"] == Decimal("30.00")
    assert shift_status["total_extra_income_uzs"] == Decimal("10000.00")
    assert shift_status["total_expenses_uzs"] == Decimal("15000.00")
    # Expected cash: 100k + 10k - 15k = 95k UZS, and 30 USD
    assert shift_status["expected_cash_uzs"] == Decimal("95000.00")
    assert shift_status["expected_cash_usd"] == Decimal("30.00")

    # 4. Close shift with discrepancy and EMPTY reason
    report = CashboxService.close_shift(
        tenant=tenant,
        user=owner,
        actual_cash_uzs=Decimal("90000.00"),  # 5,000 UZS short!
        actual_cash_usd=Decimal("30.00"),
        discrepancy_reason="",
        staff_notes="Bugun smena tinch o'tdi",
    )

    assert report.is_closed is True
    assert report.discrepancy_uzs == Decimal("-5000.00")
    assert report.discrepancy_usd == Decimal("0.00")
    # Prompt empty -> system fallback message
    assert report.discrepancy_reason == "Smenani yopgan xodim tafovut farqining sababini bilmaydi"
    assert report.staff_notes == "Bugun smena tinch o'tdi"

    # Notification created for owner
    notif = Notification.objects.filter(tenant=tenant, recipient=owner, type="daily_z_report").first()
    assert notif is not None
    assert "KUNLIK Z-HISOBOT" in notif.message

    # Income and expense now linked to this report
    assert CashExpense.objects.filter(tenant=tenant, shift_report=report).count() == 1
    assert CashIncome.objects.filter(tenant=tenant, shift_report=report).count() == 1

    # 5. After close, shift status resets
    new_status = CashboxService.get_current_shift_status(tenant)
    assert new_status["total_extra_income_uzs"] == Decimal("0.00")
    assert new_status["total_expenses_uzs"] == Decimal("0.00")
    assert new_status["expected_cash_uzs"] == Decimal("0.00")


def test_cashbox_api_views(api_client, tenant, owner, platform_admin):
    api_client.force_authenticate(user=owner)

    # 1. Create expense
    exp_resp = api_client.post(EXPENSES_URL, {
        "amount": "25000.00",
        "currency": "UZS",
        "category": "Tushlik",
        "note": "Xodimlar uchun tushlik",
    })
    assert exp_resp.status_code == status.HTTP_201_CREATED
    assert exp_resp.data["category"] == "Tushlik"

    # 2. Create income
    inc_resp = api_client.post(INCOME_URL, {
        "amount": "12000.00",
        "currency": "UZS",
        "source": "Kopya",
        "note": "Hujjat chop etish",
    })
    assert inc_resp.status_code == status.HTTP_201_CREATED
    assert inc_resp.data["source"] == "Kopya"

    # 3. Current shift status
    status_resp = api_client.get(SHIFT_CURRENT_URL)
    assert status_resp.status_code == status.HTTP_200_OK
    assert status_resp.data["total_expenses_uzs"] == "25000.00"
    assert status_resp.data["total_extra_income_uzs"] == "12000.00"

    # 4. Close shift
    close_resp = api_client.post(SHIFT_CLOSE_URL, {
        "actual_cash_uzs": "0.00",
        "actual_cash_usd": "0.00",
        "discrepancy_reason": "Kassada pul yo'q edi",
        "staff_notes": "Kassa bo'shatildi",
    })
    assert close_resp.status_code == status.HTTP_201_CREATED
    report_id = close_resp.data["id"]

    # 5. List and Detail reports
    list_resp = api_client.get(REPORTS_URL)
    assert list_resp.status_code == status.HTTP_200_OK
    assert len(list_resp.data) == 1

    detail_resp = api_client.get(f"{REPORTS_URL}{report_id}/")
    assert detail_resp.status_code == status.HTTP_200_OK
    assert detail_resp.data["discrepancy_reason"] == "Kassada pul yo'q edi"
