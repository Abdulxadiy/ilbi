import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.accounts.models import User
from apps.tg_bot.models import TelegramContact

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def configured_login_bot(settings):
    settings.TELEGRAM_BOT_TOKEN = "100001:isolated-test-bot"


def test_custom_createsuperuser_with_chat_id(monkeypatch):
    monkeypatch.setenv("DJANGO_SUPERUSER_PASSWORD", "SuperPass123!")

    call_command(
        "createsuperuser",
        phone_number="+998901112233",
        username="superadmin",
        chat_id="987654321",
        interactive=False,
    )

    user = User.objects.filter(username="superadmin").first()
    assert user is not None
    assert user.role == "platform_admin"
    assert user.is_superuser is True
    assert user.check_password("SuperPass123!")

    contact = TelegramContact.objects.filter(phone_number=user.phone_number).first()
    assert contact is not None
    assert contact.chat_id == "987654321"
    assert contact.bot_id == "100001"
    from api.v1.accounts.views.misc import get_current_telegram_contact
    assert get_current_telegram_contact(user.phone_number).pk == contact.pk


def test_custom_createsuperuser_requires_bot_identity_before_creating_user(settings, monkeypatch):
    settings.TELEGRAM_BOT_TOKEN = ""
    monkeypatch.setenv("DJANGO_SUPERUSER_PASSWORD", "SuperPass123!")
    with pytest.raises(CommandError, match="TELEGRAM_BOT_TOKEN"):
        call_command(
            "createsuperuser", phone_number="+998901110009", username="missingbot",
            chat_id="987654321", interactive=False,
        )
    assert not User.objects.filter(username="missingbot").exists()


@pytest.mark.parametrize("chat_id", ["-123456", "0", "invalid"])
def test_custom_createsuperuser_rejects_non_private_chat_before_creating_user(chat_id, monkeypatch):
    monkeypatch.setenv("DJANGO_SUPERUSER_PASSWORD", "SuperPass123!")
    with pytest.raises(CommandError, match="shaxsiy Telegram chat ID"):
        call_command(
            "createsuperuser", phone_number="+998901110008", username="invalidchat",
            chat_id=chat_id, interactive=False,
        )
    assert not User.objects.filter(username="invalidchat").exists()
    assert not TelegramContact.objects.filter(phone_number="+998901110008").exists()


def test_custom_createsuperuser_missing_chat_id_raises_error(monkeypatch):
    monkeypatch.setenv("DJANGO_SUPERUSER_PASSWORD", "SuperPass123!")

    with pytest.raises(CommandError, match="You must provide --chat_id"):
        call_command(
            "createsuperuser",
            phone_number="+998909998877",
            username="failadmin",
            interactive=False,
        )


def test_custom_createsuperuser_only_one_allowed(monkeypatch):
    monkeypatch.setenv("DJANGO_SUPERUSER_PASSWORD", "SuperPass123!")

    call_command(
        "createsuperuser",
        phone_number="+998901110001",
        username="firstadmin",
        chat_id="111111111",
        interactive=False,
    )

    with pytest.raises(CommandError, match="Platform Admin allaqachon mavjud"):
        call_command(
            "createsuperuser",
            phone_number="+998901110002",
            username="secondadmin",
            chat_id="222222222",
            interactive=False,
        )

