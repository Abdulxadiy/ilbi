import logging
from unittest.mock import MagicMock, patch

import requests

from apps.tg_bot.services import send_telegram_message


def test_send_telegram_message_does_not_leak_token_in_logs(caplog):
    caplog.set_level(logging.DEBUG)
    secret_token = "bot123:SECRET"

    fake_response = MagicMock()
    fake_response.status_code = 500

    error = requests.HTTPError(f"500 Server Error for url: https://api.telegram.org/{secret_token}/sendMessage")
    error.response = fake_response

    with patch("requests.post", side_effect=error):
        result = send_telegram_message("123456", "Hello test")

    assert result is False
    assert secret_token not in caplog.text
    assert "SECRET" not in caplog.text


def test_send_telegram_message_network_error_does_not_leak_details(caplog):
    caplog.set_level(logging.DEBUG)
    secret_token = "bot123:SECRET"

    error = requests.RequestException(f"Connection failed to https://api.telegram.org/{secret_token}/sendMessage")

    with patch("requests.post", side_effect=error):
        result = send_telegram_message("123456", "Hello test")

    assert result is False
    assert secret_token not in caplog.text
    assert "SECRET" not in caplog.text
