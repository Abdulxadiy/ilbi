from datetime import time
from unittest.mock import patch
import pytest
from django.utils import timezone

from apps.cashbox.tasks import send_daily_report_for_tenant_task, check_and_send_daily_reports_task
from apps.tg_bot.models import TelegramContact
from tests.factories import TenantFactory, OwnerFactory

pytestmark = pytest.mark.django_db


def test_send_daily_report_for_tenant_task_no_contact(tenant):
    # No contact registered for owner
    result = send_daily_report_for_tenant_task(tenant.id)
    assert result is False


@patch("apps.cashbox.tasks.send_async_telegram_message_task.delay")
def test_send_daily_report_for_tenant_task_with_contact(mock_delay, tenant, owner):
    TelegramContact.objects.create(
        phone_number=owner.phone_number,
        chat_id="998877",
    )
    result = send_daily_report_for_tenant_task(tenant.id)
    assert result is True
    mock_delay.assert_called_once()
    args, kwargs = mock_delay.call_args
    assert args[0] == "998877"
    assert "KUNLIK HISOBOT VAQTI KELDI" in args[1]


@patch("apps.cashbox.tasks.send_daily_report_for_tenant_task.delay")
def test_check_and_send_daily_reports_task(mock_tenant_task_delay, tenant):
    now = timezone.localtime()
    # Set tenant daily_report_time to current time
    tenant.daily_report_time = time(now.hour, now.minute)
    tenant.save(update_fields=["daily_report_time"])

    count = check_and_send_daily_reports_task()
    assert count >= 1
    mock_tenant_task_delay.assert_called_with(tenant.id)


@patch("apps.cashbox.tasks.send_async_telegram_message_task.delay")
def test_send_daily_report_group_only(mock_delay, tenant, owner):
    tenant.daily_report_target = "group"
    tenant.telegram_group_id = "-100999888"
    tenant.save()

    TelegramContact.objects.create(
        phone_number=owner.phone_number,
        chat_id="111222",
    )
    result = send_daily_report_for_tenant_task(tenant.id)
    assert result is True
    mock_delay.assert_called_once()
    args, _ = mock_delay.call_args
    assert args[0] == "-100999888"


@patch("apps.cashbox.tasks.send_async_telegram_message_task.delay")
def test_send_daily_report_disabled(mock_delay, tenant, owner):
    tenant.daily_report_target = "none"
    tenant.save()
    TelegramContact.objects.create(
        phone_number=owner.phone_number,
        chat_id="111222",
    )
    result = send_daily_report_for_tenant_task(tenant.id)
    assert result is False
    mock_delay.assert_not_called()


@patch("apps.cashbox.tasks.send_async_telegram_message_task.delay")
def test_send_daily_report_both_targets(mock_delay, tenant, owner):
    tenant.daily_report_target = "both"
    tenant.telegram_group_id = "-100777666"
    tenant.save()
    TelegramContact.objects.create(
        phone_number=owner.phone_number,
        chat_id="111222",
    )
    result = send_daily_report_for_tenant_task(tenant.id)
    assert result is True
    assert mock_delay.call_count == 2
    called_chats = {call[0][0] for call in mock_delay.call_args_list}
    assert called_chats == {"111222", "-100777666"}
