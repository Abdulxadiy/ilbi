import logging

from celery import shared_task
from django.conf import settings

from apps.accounts.models import User
from apps.accounts.services.demo_access_service import DemoAccessService
from apps.tg_bot.identity import current_bot_id, is_group_chat_id, is_private_chat_id
from apps.tg_bot.models import TelegramContact
from apps.tg_bot.services import send_telegram_message

logger = logging.getLogger(__name__)


def configured_admin_recipients(row):
    recipients = set()
    if not row.enabled or not row.admin.is_active or row.admin.role != "platform_admin" or not current_bot_id():
        return recipients
    if DemoAccessService.is_blocked(row.admin):
        return recipients
    if row.target in ("personal", "both"):
        contact = TelegramContact.objects.filter(phone_number=row.admin.phone_number, bot_id=current_bot_id()).first()
        if contact and is_private_chat_id(contact.chat_id):
            recipients.add(contact.chat_id)
    if row.target in ("group", "both") and is_group_chat_id(row.group_chat_id):
        recipients.add(row.group_chat_id)
    return recipients


@shared_task(autoretry_for=(RuntimeError,), retry_kwargs={"max_retries": 3, "countdown": 10})
def send_support_test(admin_id):
    from apps.support.models import SupportTelegramSettings

    row = SupportTelegramSettings.objects.select_related("admin").filter(admin_id=admin_id).first()
    if row is None:
        return False
    recipients = configured_admin_recipients(row)
    failed = False
    for chat_id in recipients:
        if not send_telegram_message(
            chat_id, "ILBI: yordam markazi bildirishnomalari uchun sinov xabari.", parse_mode=None
        ):
            failed = True
    if failed:
        raise RuntimeError("Support test delivery failed")
    return bool(recipients)


@shared_task(autoretry_for=(RuntimeError,), retry_kwargs={"max_retries": 3, "countdown": 10})
def notify_operators(conversation_id):
    from apps.support.models import Conversation, SupportTelegramSettings

    conversation = Conversation.objects.filter(pk=conversation_id).first()
    if not conversation or conversation.status == Conversation.Status.CLOSED:
        return False
    bot_id = current_bot_id()
    if not bot_id:
        return False
    configurations = list(SupportTelegramSettings.objects.select_related("admin"))
    # Once configured in the UI, do not silently notify legacy environment recipients.
    phones = [] if configurations else settings.SUPPORT_OPERATOR_PHONES
    blocked_phones = {
        user.phone_number for user in User.objects.filter(phone_number__in=phones) if DemoAccessService.is_blocked(user)
    }
    contacts = TelegramContact.objects.filter(
        phone_number__in=phones,
        bot_id=bot_id,
        chat_id__regex=r"^[0-9]+$",
    ).exclude(phone_number__in=blocked_phones)
    recipients = {contact.chat_id for contact in contacts if is_private_chat_id(contact.chat_id)}
    for row in configurations:
        recipients.update(configured_admin_recipients(row))
    # Telegram receives no guest name, question, attachment or browser credential.
    url = settings.FRONTEND_URL.rstrip("/") + "/support?conversation=" + str(conversation.id)
    text = f"ILBI: yangi yordam xabari / New support message\n{conversation.language.upper()}\n{url}"
    failed = False
    for chat_id in recipients:
        if not send_telegram_message(chat_id, text, parse_mode=None):
            failed = True
    if failed:
        raise RuntimeError("Support notification delivery failed")
    return True


def enqueue_notification(conversation_id):
    try:
        notify_operators.delay(str(conversation_id))
    except Exception:
        logger.warning("Support notification could not be queued for %s", conversation_id)
