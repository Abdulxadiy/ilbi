from decimal import Decimal
from unittest.mock import patch
import pytest
from rest_framework.test import APIClient
from apps.tg_bot.models import TelegramContact
from tests.factories import TenantFactory, OwnerFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def api_client():
    return APIClient()

CURRENT_TENANT_URL = "/api/v1/tenants/current/"
TEST_TELEGRAM_URL = "/api/v1/tenants/current/test-telegram/"
SEND_REPORT_NOW_URL = "/api/v1/tenants/current/send-report-now/"


def test_get_current_tenant_unauthenticated(api_client):
    res = api_client.get(CURRENT_TENANT_URL)
    assert res.status_code == 401


def test_get_current_tenant_owner(api_client, owner, tenant):
    api_client.force_authenticate(user=owner)
    res = api_client.get(CURRENT_TENANT_URL)
    assert res.status_code == 200
    assert res.data["id"] == tenant.id
    assert res.data["name"] == tenant.name
    assert "usd_rate" in res.data
    assert "daily_report_target" in res.data
    assert "shift_report_target" in res.data
    assert "notify_web_reports" in res.data
    assert "receipt_footer" in res.data


def test_patch_current_tenant_settings(api_client, owner, tenant):
    api_client.force_authenticate(user=owner)
    payload = {
        "usd_rate": "13100.00",
        "daily_report_target": "group",
        "shift_report_target": "group",
        "telegram_group_id": "-1001234567890",
        "notify_web_reports": False,
        "notify_on_sale": True,
        "receipt_footer": "Bizni tanlaganingiz uchun tashakkur!",
    }
    res = api_client.patch(CURRENT_TENANT_URL, payload)
    assert res.status_code == 200
    assert res.data["usd_rate"] == "13100.00"
    assert res.data["daily_report_target"] == "group"
    assert res.data["telegram_group_id"] == "-1001234567890"
    assert res.data["notify_web_reports"] is False
    assert res.data["notify_on_sale"] is True
    assert res.data["receipt_footer"] == "Bizni tanlaganingiz uchun tashakkur!"

    tenant.refresh_from_db()
    assert tenant.usd_rate == Decimal("13100.00")
    assert tenant.daily_report_target == "group"
    assert tenant.telegram_group_id == "-1001234567890"
    assert tenant.notify_web_reports is False


@patch("apps.tg_bot.services.send_telegram_message", return_value=True)
def test_test_telegram_endpoint(mock_send, api_client, owner, tenant):
    api_client.force_authenticate(user=owner)
    # 1. No destinations configured
    res = api_client.post(TEST_TELEGRAM_URL, {})
    assert res.status_code == 400

    # 2. Destination configured via payload or contact
    TelegramContact.objects.create(phone_number=owner.phone_number, chat_id="998877")
    res = api_client.post(TEST_TELEGRAM_URL, {"telegram_group_id": "-100111222"})
    assert res.status_code == 200
    assert res.data["success"] is True
    assert mock_send.call_count >= 1


@patch("apps.cashbox.tasks.send_daily_report_for_tenant_task", return_value=True)
def test_send_report_now_endpoint(mock_task, api_client, owner, tenant):
    api_client.force_authenticate(user=owner)
    res = api_client.post(SEND_REPORT_NOW_URL)
    assert res.status_code == 200
    assert res.data["success"] is True
    mock_task.assert_called_once_with(tenant.id)
