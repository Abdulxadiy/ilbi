"""Identify which Telegram bot recorded a contact without storing its secret token."""

from django.conf import settings


def current_bot_id() -> str | None:
    token = getattr(settings, "TELEGRAM_BOT_TOKEN", "") or ""
    bot_id, separator, _secret = token.partition(":")
    return bot_id if separator and bot_id.isdecimal() else None


def is_private_chat_id(chat_id: object) -> bool:
    """Bot API user dialogs use positive IDs; groups/channels use negative IDs."""
    return (
        isinstance(chat_id, str)
        and 1 <= len(chat_id) <= 16
        and chat_id.isascii()
        and chat_id.isdecimal()
        and not chat_id.startswith("0")
        and int(chat_id) < 2**52
    )


def is_group_chat_id(chat_id: object) -> bool:
    return isinstance(chat_id, str) and chat_id.startswith("-") and is_private_chat_id(chat_id[1:])
