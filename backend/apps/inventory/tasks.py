import logging
from calendar import monthrange
from celery import shared_task
from django.utils import timezone
from django.db import transaction

from apps.tenants.models import Tenant
from apps.inventory.services.deficit_service import DeficitService
from apps.tg_bot.models import TelegramContact
from apps.sales.models import Notification
from apps.sales.tasks import send_async_telegram_message_task

logger = logging.getLogger(__name__)


@shared_task(name="apps.inventory.tasks.send_low_stock_report_for_tenant_task")
def send_low_stock_report_for_tenant_task(tenant_id: int):
    """
    Identifies deficit/low-stock product variants for the tenant and dispatches
    the report to Telegram (group/personal/both) and in-app Notification.
    """
    tenant = Tenant.objects.filter(pk=tenant_id, is_active=True).select_related("owner").first()
    if not tenant:
        return {"success": False, "detail": "Tenant topilmadi"}

    target = getattr(tenant, "low_stock_report_target", Tenant.TARGET_BOTH)
    notify_web = getattr(tenant, "notify_web_low_stock", True)

    if target == Tenant.TARGET_NONE and not notify_web:
        logger.info(f"Low stock report is disabled for tenant {tenant.name}.")
        return {"success": False, "detail": "Hisobot o'chirib qo'yilgan"}

    deficit_items = DeficitService.get_deficit_variants(tenant)
    dest_chat_ids = set()

    if target in (Tenant.TARGET_PERSONAL, Tenant.TARGET_BOTH):
        owner = tenant.owner
        if owner and owner.phone_number:
            contact = TelegramContact.objects.filter(phone_number=owner.phone_number).first()
            if contact and contact.chat_id:
                dest_chat_ids.add(contact.chat_id)

    if target in (Tenant.TARGET_GROUP, Tenant.TARGET_BOTH):
        if tenant.telegram_group_id and tenant.telegram_group_id.strip():
            dest_chat_ids.add(tenant.telegram_group_id.strip())

    # 1. Send to Telegram
    if dest_chat_ids:
        msg = DeficitService.format_telegram_deficit_report(tenant, deficit_items)
        for chat_id in dest_chat_ids:
            send_async_telegram_message_task.delay(chat_id, msg)

    # 2. In-app Web Notification
    if notify_web and deficit_items:
        count = len(deficit_items)
        first_names = ", ".join(item["product_name"] for item in deficit_items[:3])
        if count > 3:
            first_names += f" va yana {count - 3} ta tovar"

        Notification.objects.create(
            tenant=tenant,
            recipient=tenant.owner,
            type=Notification.TYPE_LOW_STOCK_ALERT,
            title=f"⚠️ Kamayib qolgan tovarlar ({count} ta)",
            message=(
                f"So'nggi 30 kunda 10+ sotilgan va ayni paytda omborda ≤5 dona qolgan {count} ta tovar mavjud: "
                f"{first_names}. Ombor bo'limida kamchiliklarni ko'rishingiz va tezkor kirim qilishingiz mumkin."
            ),
            link="/inventory",
        )

    # 3. Update timestamp
    tenant.last_low_stock_report_sent_at = timezone.now()
    tenant.save(update_fields=["last_low_stock_report_sent_at"])

    return {
        "success": True,
        "count": len(deficit_items),
        "telegram_destinations": len(dest_chat_ids),
        "web_notification_created": bool(notify_web and deficit_items),
    }


@shared_task(name="apps.inventory.tasks.check_and_send_low_stock_reports_task")
def check_and_send_low_stock_reports_task():
    """
    Periodic task (runs every 5 minutes):
    Checks active tenants whose low_stock_report_time and frequency (daily/weekly/monthly)
    match the current time window, and dispatches send_low_stock_report_for_tenant_task.
    """
    now = timezone.localtime()
    current_time = now.time()
    today = now.date()

    tenants = Tenant.objects.filter(is_active=True)
    count = 0

    for tenant in tenants:
        target = getattr(tenant, "low_stock_report_target", Tenant.TARGET_BOTH)
        notify_web = getattr(tenant, "notify_web_low_stock", True)
        if target == Tenant.TARGET_NONE and not notify_web:
            continue

        report_time = tenant.low_stock_report_time
        if not report_time:
            continue

        # Check hour & 5-minute window
        scheduled = now.replace(hour=report_time.hour, minute=report_time.minute, second=0, microsecond=0)
        if not 0 <= (now - scheduled).total_seconds() < 300:
            continue

        # Check if already sent today
        if tenant.last_low_stock_report_sent_at:
            last_date = timezone.localtime(tenant.last_low_stock_report_sent_at).date()
            if last_date == today:
                continue

        frequency = getattr(tenant, "low_stock_frequency", Tenant.FREQUENCY_DAILY)

        should_send = False
        if frequency == Tenant.FREQUENCY_DAILY:
            should_send = True
        elif frequency == Tenant.FREQUENCY_WEEKLY:
            target_weekday = getattr(tenant, "low_stock_weekday", 1)  # 1=Mon .. 7=Sun
            if today.isoweekday() == target_weekday:
                should_send = True
        elif frequency == Tenant.FREQUENCY_MONTHLY:
            target_day = getattr(tenant, "low_stock_day_of_month", 1)
            days_in_month = monthrange(today.year, today.month)[1]
            effective_day = min(target_day, days_in_month)
            if today.day == effective_day:
                should_send = True

        if should_send:
            with transaction.atomic():
                locked = Tenant.objects.select_for_update(skip_locked=True).filter(pk=tenant.pk).first()
                if locked is None or (locked.last_low_stock_report_sent_at and timezone.localtime(locked.last_low_stock_report_sent_at).date() == today):
                    continue
                send_low_stock_report_for_tenant_task.delay(locked.id)
                locked.last_low_stock_report_sent_at = now
                locked.save(update_fields=['last_low_stock_report_sent_at'])
                count += 1

    return count
