"""Tenant settings mutations stay authorized and leave a value-free audit trail."""

from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from apps.core.models import AuditAction, AuditLog
from tests.factories import EmployeeFactory, StaffFactory

pytestmark = pytest.mark.django_db
BASE = "/api/v1/tenants/current/"
TEST_TELEGRAM = f"{BASE}test-telegram/"
DAILY_REPORT = f"{BASE}send-report-now/"
LOW_STOCK_REPORT = f"{BASE}send-low-stock-report-now/"


def test_staff_cannot_trigger_telegram_or_report_mutations(tenant):
    staff = StaffFactory()
    EmployeeFactory(user=staff, tenant=tenant)
    client = APIClient()
    client.force_authenticate(user=staff)

    with patch("apps.tg_bot.services.send_telegram_message") as send_message, patch(
        "apps.cashbox.tasks.send_daily_report_for_tenant_task"
    ) as send_daily, patch(
        "apps.inventory.tasks.send_low_stock_report_for_tenant_task"
    ) as send_low_stock:
        assert client.post(TEST_TELEGRAM, {"telegram_group_id": "-10000001"}).status_code == 403
        assert client.post(DAILY_REPORT).status_code == 403
        assert client.post(LOW_STOCK_REPORT).status_code == 403
        send_message.assert_not_called()
        send_daily.assert_not_called()
        send_low_stock.assert_not_called()


def test_platform_admin_can_target_a_tenant_for_operational_messages(tenant, platform_admin):
    client = APIClient()
    client.force_authenticate(user=platform_admin)
    payload = {"tenant_id": tenant.id}

    with patch("apps.tg_bot.services.send_telegram_message", return_value=True) as send_message, patch(
        "apps.cashbox.tasks.send_daily_report_for_tenant_task", return_value=True
    ) as send_daily, patch(
        "apps.inventory.tasks.send_low_stock_report_for_tenant_task", return_value={"success": True, "count": 2}
    ) as send_low_stock:
        test = client.post(TEST_TELEGRAM, {**payload, "telegram_group_id": "-10000001"})
        daily = client.post(DAILY_REPORT, payload)
        low_stock = client.post(LOW_STOCK_REPORT, payload)

    assert test.status_code == daily.status_code == low_stock.status_code == 200
    send_message.assert_called()
    send_daily.assert_called_once_with(tenant.id)
    send_low_stock.assert_called_once_with(tenant.id)


def test_owner_can_send_low_stock_report(tenant, owner):
    client = APIClient()
    client.force_authenticate(user=owner)
    with patch(
        "apps.inventory.tasks.send_low_stock_report_for_tenant_task", return_value={"success": True, "count": 2}
    ) as send_low_stock:
        response = client.post(LOW_STOCK_REPORT)

    assert response.status_code == 200
    send_low_stock.assert_called_once_with(tenant.id)


def test_tenant_settings_patch_is_audited_without_private_values(tenant, owner, platform_admin):
    client = APIClient()
    client.force_authenticate(user=platform_admin)
    secret_group = "-100111222333"
    response = client.patch(
        f"{BASE}?tenant_id={tenant.id}",
        {"telegram_group_id": secret_group, "usd_rate": "13100.00"},
        format="json",
    )

    assert response.status_code == 200
    log = AuditLog.objects.get(
        tenant=tenant, actor=platform_admin, action=AuditAction.TENANT_UPDATE,
    )
    assert log.target_model == "Tenant"
    assert log.target_id == str(tenant.id)
    assert log.changes == {"fields": ["telegram_group_id", "usd_rate"]}
    assert secret_group not in str(log.changes) + log.description
    assert "13100" not in str(log.changes) + log.description

    # A no-op PATCH does not invent another change event.
    same = client.patch(
        f"{BASE}?tenant_id={tenant.id}",
        {"telegram_group_id": secret_group, "usd_rate": "13100.00"},
        format="json",
    )
    assert same.status_code == 200
    assert AuditLog.objects.filter(tenant=tenant, action=AuditAction.TENANT_UPDATE).count() == 1

    client.force_authenticate(user=owner)
    own_change = client.patch(BASE, {"notify_on_sale": True}, format="json")
    assert own_change.status_code == 200
    assert AuditLog.objects.filter(
        tenant=tenant, actor=owner, action=AuditAction.TENANT_UPDATE,
        changes={"fields": ["notify_on_sale"]},
    ).exists()


def test_tenant_detail_patch_uses_the_same_audit_policy(tenant, platform_admin):
    client = APIClient()
    client.force_authenticate(user=platform_admin)
    response = client.patch(
        f"/api/v1/tenants/{tenant.id}/",
        {"name": "Yangi nom", "description": "Maxfiy tavsif"},
        format="json",
    )

    assert response.status_code == 200
    log = AuditLog.objects.get(
        tenant=tenant, actor=platform_admin, action=AuditAction.TENANT_UPDATE,
    )
    assert log.changes == {"fields": ["description", "name"]}
    assert "Maxfiy tavsif" not in str(log.changes) + log.description
