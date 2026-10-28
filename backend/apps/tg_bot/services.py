import logging

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

class TelegramConfigError(Exception):
    pass


def _bot_url(method: str) -> str:
    token = settings.TELEGRAM_BOT_TOKEN
    if not token:
        raise TelegramConfigError("TELEGRAM_BOT_TOKEN is not configured")
    return f"https://api.telegram.org/bot{token}/{method}"


def send_telegram_message(chat_id: str, text: str, parse_mode: str = "Markdown") -> bool:
    payload = {
        "chat_id": chat_id,
        "text": text,
    }
    if parse_mode:
        payload["parse_mode"] = parse_mode

    try:
        url = _bot_url("sendMessage")
        resp = requests.post(url, json=payload, timeout=5)

        # If Telegram rejects markdown formatting (e.g. 400 Bad Request: can't parse entities),
        # retry sending as plain text so the message is never lost.
        if resp.status_code == 400 and parse_mode:
            logger.warning("Telegram parse_mode=%s failed. Retrying as plain text...", parse_mode)
            payload.pop("parse_mode", None)
            resp = requests.post(url, json=payload, timeout=5)

        resp.raise_for_status()

        data = resp.json()
        if not data.get("ok"):
            logger.error("Telegram API error: chat_id=%s", chat_id)
            return False
        return True
    except TelegramConfigError as exc:
        logger.error("Telegram config error: %s", exc)
        return False
    except requests.HTTPError as exc:
        logger.error(
            "Telegram sendMessage failed: chat_id=%s status=%s",
            chat_id,
            exc.response.status_code if exc.response is not None else None,
        )
        return False
    except requests.RequestException as exc:
        logger.error("Telegram sendMessage network error: chat_id=%s type=%s", chat_id, type(exc).__name__)
        return False
    except Exception as exc:
        logger.error("Telegram send failed: chat_id=%s type=%s", chat_id, type(exc).__name__)
        return False
