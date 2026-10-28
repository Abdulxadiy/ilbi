from unittest.mock import patch
import pytest
from apps.sales.tasks import auto_expire_transfers_task, send_async_telegram_message_task

pytestmark = pytest.mark.django_db


def test_auto_expire_transfers_task():
    # Calling the task synchronously (as a function)
    result = auto_expire_transfers_task()
    assert isinstance(result, int)
    assert result >= 0


@patch("apps.sales.tasks.send_telegram_message", return_value=True)
def test_send_async_telegram_message_task(mock_send):
    result = send_async_telegram_message_task("123456", "Test message")
    assert result is True
    mock_send.assert_called_once_with(chat_id="123456", text="Test message")
