import logging
from celery import shared_task
from apps.sales.services.b2b_transfer_service import B2BTransferService
from apps.tg_bot.services import send_telegram_message

logger = logging.getLogger(__name__)


@shared_task(name='apps.sales.tasks.notify_due_debts_task')
def notify_due_debts_task():
    from apps.sales.services.debt_reminder_service import notify_due_debts
    return notify_due_debts()


@shared_task(name="apps.sales.tasks.auto_expire_transfers_task")
def auto_expire_transfers_task():
    """
    Periodic task: automatically expires B2B transfer requests older than 7 days.
    """
    logger.info("Starting B2B auto-expire transfers task...")
    count = B2BTransferService.auto_expire_transfers()
    logger.info(f"B2B auto-expire completed: {count} transfers expired.")
    return count


@shared_task(
    name="apps.sales.tasks.send_async_telegram_message_task",
    autoretry_for=(Exception,),
    retry_kwargs={"max_retries": 3, "countdown": 5},
)
def send_async_telegram_message_task(chat_id: str, text: str):
    """
    Asynchronous task to send Telegram messages with automatic retry.
    """
    logger.info(f"Sending async Telegram message to {chat_id}")
    success = send_telegram_message(chat_id=chat_id, text=text)
    if not success:
        logger.warning(f"Telegram message delivery failed for {chat_id}")
        raise RuntimeError('Telegram xabari yetkazilmadi; qayta yuboriladi.')
    return success


@shared_task(name='apps.sales.tasks.notify_sale_task')
def notify_sale_task(sale_id):
    from apps.sales.models import Sale
    from apps.tg_bot.models import TelegramContact
    sale = Sale.objects.select_related('tenant__owner').filter(pk=sale_id).first()
    if sale is None or not sale.tenant.notify_on_sale:
        return False
    contact = TelegramContact.objects.filter(phone_number=sale.tenant.owner.phone_number).first()
    if contact is None:
        return False
    text = f"🧾 Yangi savdo: {sale.tenant.name}\nChek: {sale.receipt_number}\nSumma: {sale.total_amount:,.2f} {sale.currency}\nTo‘lov: {sale.get_payment_type_display()}"
    send_async_telegram_message_task.delay(contact.chat_id, text)
    return True
