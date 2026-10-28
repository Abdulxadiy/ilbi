"""Debt entry is assignable; owner-only corrections must remain non-assignable."""

from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.accounts.services.permission_service import PermissionService
from apps.permissions.constants import OWNER_ONLY_PERMISSIONS
from apps.permissions.models import Permission
from apps.sales.models import DebtPayment
from apps.sales.services.debt_service import DebtService, DebtServiceError
from tests.factories import CounterpartyFactory, EmployeeFactory, StaffFactory

pytestmark = pytest.mark.django_db


def client_for(user, tenant):
    client = APIClient()
    client.force_authenticate(user=user)
    client.credentials(HTTP_X_TENANT_ID=str(tenant.pk))
    return client


def recorder_for(tenant, *, forged=False):
    staff = StaffFactory()
    member = EmployeeFactory(user=staff, tenant=tenant, is_owner=False)
    member.permissions.add(Permission.objects.get(category="sales", codename="record_debt_payment"))
    if forged:
        permission, _ = Permission.objects.get_or_create(
            category="sales", codename="correct_debt_payment", defaults={"name": "Legacy owner-only grant"},
        )
        member.permissions.add(permission)
    return staff


@pytest.mark.parametrize("forged", [False, True])
def test_cashier_cannot_call_correction_api_even_with_legacy_owner_only_grant(tenant, forged):
    cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs="100.00")
    staff = recorder_for(tenant, forged=forged)
    response = client_for(staff, tenant).post(
        f"/api/v1/sales/counterparties/{cp.pk}/payments/correct/",
        {"amount": "5.00", "currency": "UZS", "payment_type": "none", "note": "Unauthorized correction"},
        format="json",
    )
    assert response.status_code == 403
    cp.refresh_from_db()
    assert cp.debt_balance_uzs == Decimal("100.00")
    assert not DebtPayment.objects.filter(counterparty=cp).exists()


@pytest.mark.parametrize("forged", [False, True])
def test_direct_service_correction_rejects_cashier_before_financial_changes(tenant, forged):
    cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs="100.00")
    staff = recorder_for(tenant, forged=forged)
    with pytest.raises(DebtServiceError, match="Tuzatish"):
        DebtService.record_payment(
            counterparty=cp, amount=Decimal("5.00"), currency="UZS", recorded_by=staff,
            is_correction=True, payment_type="none", note="Unauthorized correction",
        )
    cp.refresh_from_db()
    assert cp.debt_balance_uzs == Decimal("100.00")
    assert not DebtPayment.objects.filter(counterparty=cp).exists()


@pytest.mark.parametrize("code", sorted(OWNER_ONLY_PERMISSIONS))
def test_owner_only_permission_cannot_be_reenabled_by_old_staff_grant(tenant, code):
    staff = recorder_for(tenant)
    member = staff.employments.get(tenant=tenant)
    category, codename = code.split(".", 1)
    grant, _ = Permission.objects.get_or_create(category=category, codename=codename, defaults={"name": code})
    member.permissions.add(grant)
    assert PermissionService.has_permission(staff, code, tenant=tenant, employee=member) is False


def test_cashier_can_still_collect_normal_quoted_debt_payment(tenant):
    cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs="100.00")
    staff = recorder_for(tenant)
    client = client_for(staff, tenant)
    path = f"/api/v1/sales/counterparties/{cp.pk}/payments/"
    quote = client.get(path + "quote/", {"amount": "5.00", "currency": "UZS", "payment_type": "cash"})
    assert quote.status_code == 200
    response = client.post(path, {
        "amount": "5.00", "currency": "UZS", "payment_type": "cash",
        "idempotency_key": "permitted-cashier-payment", "expected_quote": quote.data["expected_quote"],
    }, format="json")
    assert response.status_code == 201
    cp.refresh_from_db()
    assert cp.debt_balance_uzs == Decimal("95.00")


def test_actual_owner_can_correct_with_reason(owner, tenant):
    cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs="100.00")
    response = client_for(owner, tenant).post(
        f"/api/v1/sales/counterparties/{cp.pk}/payments/correct/",
        {"amount": "-5.00", "currency": "UZS", "payment_type": "none", "note": "Audited owner correction"},
        format="json",
    )
    assert response.status_code == 201
    assert response.data["is_correction"] is True
    cp.refresh_from_db()
    assert cp.debt_balance_uzs == Decimal("105.00")


def test_platform_admin_stays_outside_retail_correction_api(platform_admin, tenant):
    cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs="100.00")
    response = client_for(platform_admin, tenant).post(
        f"/api/v1/sales/counterparties/{cp.pk}/payments/correct/",
        {"amount": "5.00", "currency": "UZS", "payment_type": "none", "note": "Retail access denied"},
        format="json",
    )
    assert response.status_code == 403
    assert not DebtPayment.objects.filter(counterparty=cp).exists()
