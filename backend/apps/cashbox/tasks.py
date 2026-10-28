import logging
from datetime import datetime
from decimal import Decimal
from celery import shared_task
from django.utils import timezone
from django.db import transaction

from apps.tenants.models import Tenant
from apps.cashbox.models import DailyCashReport
from apps.cashbox.services.cashbox_service import CashboxService
from apps.tg_bot.models import TelegramContact
from apps.sales.tasks import send_async_telegram_message_task

logger = logging.getLogger(__name__)


@shared_task(name="apps.cashbox.tasks.send_daily_report_for_tenant_task")
def send_daily_report_for_tenant_task(tenant_id: int):
    """
    Sends the daily shift summary notification for a given tenant.
    """
    tenant = Tenant.objects.filter(pk=tenant_id, is_active=True).select_related("owner").first()
    if not tenant:
        return False

    owner = tenant.owner
    target = getattr(tenant, "daily_report_target", Tenant.TARGET_BOTH)
    if target == Tenant.TARGET_NONE:
        logger.info(f"Daily report is disabled for tenant {tenant.name}.")
        return False

    dest_chat_ids = set()
    if target in (Tenant.TARGET_PERSONAL, Tenant.TARGET_BOTH):
        contact = TelegramContact.objects.filter(phone_number=owner.phone_number).first()
        if contact and contact.chat_id:
            dest_chat_ids.add(contact.chat_id)

    if target in (Tenant.TARGET_GROUP, Tenant.TARGET_BOTH):
        if tenant.telegram_group_id and tenant.telegram_group_id.strip():
            dest_chat_ids.add(tenant.telegram_group_id.strip())

    if not dest_chat_ids:
        logger.info(f"No Telegram destinations found for tenant {tenant.name} (target={target}).")
        return False

    status = CashboxService.get_current_shift_status(tenant)

    def _fmt_line_amounts(val_uzs, val_usd, prefix=""):
        v_uzs = Decimal(str(val_uzs or 0))
        v_usd = Decimal(str(val_usd or 0))
        parts = []
        if v_uzs != 0:
            uzs_text = f"{v_uzs:,.2f} UZS" if v_uzs >= 0 else f"-{abs(v_uzs):,.2f} UZS"
            if prefix and v_uzs > 0:
                uzs_text = f"{prefix}{uzs_text}"
            parts.append(uzs_text)
        if v_usd != 0:
            usd_text = f"${v_usd:,.2f}" if v_usd >= 0 else f"-${abs(v_usd):,.2f}"
            if prefix and v_usd > 0:
                usd_text = f"{prefix}{usd_text}"
            parts.append(usd_text)
        if not parts:
            return "0.00 UZS"
        return " | ".join(parts)

    lines = [
        "📊 *KUNLIK HISOBOT VAQTI KELDI*",
        f"🏢 *Do'kon:* {tenant.name}",
        f"📅 *Sana:* {timezone.localdate()} | {timezone.localtime().strftime('%H:%M')}",
        "",
        "💵 *KASSA KUTILAYOTGAN NAQD PUL:*",
        f"• Kutilgan: `{_fmt_line_amounts(status.get('expected_cash_uzs'), status.get('expected_cash_usd'))}`",
    ]

    # SAVDOLAR: Faqat o'sha kuni amalga oshirilgan (mavjud / > 0) to'lov turlari
    sales_lines = []
    c_uzs = Decimal(str(status.get('total_sale_cash_uzs') or 0))
    c_usd = Decimal(str(status.get('total_sale_cash_usd') or 0))
    if c_uzs != 0 or c_usd != 0:
        sales_lines.append(f"• Naqd: `{_fmt_line_amounts(c_uzs, c_usd)}`")

    card_uzs = Decimal(str(status.get('total_sale_card_uzs') or 0))
    card_usd = Decimal(str(status.get('total_sale_card_usd') or 0))
    if card_uzs != 0 or card_usd != 0:
        sales_lines.append(f"• Karta: `{_fmt_line_amounts(card_uzs, card_usd)}`")

    debt_uzs = Decimal(str(status.get('total_sale_debt_uzs') or 0))
    debt_usd = Decimal(str(status.get('total_sale_debt_usd') or 0))
    if debt_uzs != 0 or debt_usd != 0:
        sales_lines.append(f"• Nasiya: `{_fmt_line_amounts(debt_uzs, debt_usd)}`")

    if not sales_lines:
        sales_lines.append("• Savdolar mavjud emas (0.00 UZS)")

    lines.append("")
    lines.append("📈 *SAVDOLAR:*")
    lines.extend(sales_lines)

    incomes_list = status.get("incomes", [])
    has_incomes = len(incomes_list) > 0 or Decimal(str(status.get('total_extra_income_uzs') or 0)) != 0 or Decimal(str(status.get('total_extra_income_usd') or 0)) != 0
    if has_incomes:
        lines.append("")
        lines.append(f"📥 *QO'SHIMCHA KIRIMLAR:* `{_fmt_line_amounts(status.get('total_extra_income_uzs'), status.get('total_extra_income_usd'), prefix='+')}`")
        for inc in incomes_list:
            note_part = f" — _{inc['note']}_" if inc.get("note") else ""
            lines.append(f"   • *{inc['source']}:* `+{Decimal(str(inc['amount'])):,.2f} {inc['currency']}`{note_part}")

    expenses_list = status.get("expenses", [])
    has_expenses = len(expenses_list) > 0 or Decimal(str(status.get('total_expenses_uzs') or 0)) != 0 or Decimal(str(status.get('total_expenses_usd') or 0)) != 0
    if has_expenses:
        lines.append("")
        total_exp_uzs = -abs(Decimal(str(status.get('total_expenses_uzs') or 0)))
        total_exp_usd = -abs(Decimal(str(status.get('total_expenses_usd') or 0))) if Decimal(str(status.get('total_expenses_usd') or 0)) != 0 else Decimal(0)
        lines.append(f"📤 *XARAJATLAR / CHIQIMLAR:* `{_fmt_line_amounts(total_exp_uzs, total_exp_usd)}`")
        for exp in expenses_list:
            note_part = f" — _{exp['note']}_" if exp.get("note") else ""
            lines.append(f"   • *{exp['category']}:* `-{Decimal(str(exp['amount'])):,.2f} {exp['currency']}`{note_part}")

    lines.extend([
        "",
        "ℹ️ _Xodimlar smenani yopgach, yakuniy tafovut bilan to'liq Z-hisobot yuboriladi._",
    ])
    message_text = "\n".join(lines)
    for chat_id in dest_chat_ids:
        send_async_telegram_message_task.delay(chat_id, message_text)
    return True


@shared_task(name="apps.cashbox.tasks.check_and_send_daily_reports_task")
def check_and_send_daily_reports_task():
    """
    Periodic task: checks active tenants whose daily_report_time matches current hour/minute window.
    """
    now = timezone.localtime()
    count = 0
    for tenant_id in Tenant.objects.filter(is_active=True).values_list('pk', flat=True):
        with transaction.atomic():
            tenant = Tenant.objects.select_for_update(skip_locked=True).filter(pk=tenant_id, is_active=True).first()
            if tenant is None or tenant.daily_report_target == Tenant.TARGET_NONE:
                continue
            if tenant.last_daily_report_sent_at and timezone.localtime(tenant.last_daily_report_sent_at).date() == now.date():
                continue
            scheduled = now.replace(hour=tenant.daily_report_time.hour, minute=tenant.daily_report_time.minute, second=0, microsecond=0)
            if not 0 <= (now - scheduled).total_seconds() < 300:
                continue
            send_daily_report_for_tenant_task.delay(tenant.pk)
            tenant.last_daily_report_sent_at = now
            tenant.save(update_fields=['last_daily_report_sent_at'])
            count += 1
    return count
