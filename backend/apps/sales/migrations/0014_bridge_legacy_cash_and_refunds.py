from decimal import Decimal

from django.db import migrations
from django.db.models import Sum


def bridge_legacy_cash(apps, schema_editor):
    Tenant = apps.get_model('tenants', 'Tenant')
    Shift = apps.get_model('cashbox', 'CashShift')
    Report = apps.get_model('cashbox', 'DailyCashReport')
    Income = apps.get_model('cashbox', 'CashIncome')
    Expense = apps.get_model('cashbox', 'CashExpense')
    Sale = apps.get_model('sales', 'Sale')
    Refund = apps.get_model('sales', 'SaleRefund')
    VoidLog = apps.get_model('sales', 'SaleVoidLog')

    # Preserve the old implicit open interval, including unreported income and
    # expenses. Old debt payments lack a trustworthy tender and stay 'none'.
    for tenant in Tenant.objects.all().iterator():
        last_report = Report.objects.filter(tenant_id=tenant.pk).order_by('-closed_at').first()
        start = last_report.closed_at if last_report else tenant.created_at
        sales = Sale.objects.filter(tenant_id=tenant.pk, created_at__gte=start, shift__isnull=True)
        incomes = Income.objects.filter(tenant_id=tenant.pk, shift_report__isnull=True, shift__isnull=True)
        expenses = Expense.objects.filter(tenant_id=tenant.pk, shift_report__isnull=True, shift__isnull=True)
        if not (sales.exists() or incomes.exists() or expenses.exists()):
            continue
        shift, _ = Shift.objects.get_or_create(
            tenant_id=tenant.pk, closed_at__isnull=True,
            defaults={'opened_by_id': tenant.owner_id, 'opened_at': start,
                      'opening_cash_uzs': last_report.actual_cash_uzs if last_report else 0,
                      'opening_cash_usd': last_report.actual_cash_usd if last_report else 0},
        )
        sales.update(shift_id=shift.pk)
        incomes.update(shift_id=shift.pk)
        expenses.update(shift_id=shift.pk)

    # Retail total_amount used to shrink after a partial void. Reconstruct the
    # gross receipt and refund events from immutable line prices and void logs.
    for sale in Sale.objects.filter(b2b_target_tenant__isnull=True).exclude(status__startswith='b2b_').iterator():
        logs = list(VoidLog.objects.filter(sale_item__sale_id=sale.pk).select_related('sale_item').order_by('voided_at', 'pk'))
        if not logs or Refund.objects.filter(sale_id=sale.pk).exists():
            continue
        gross = sale.items.aggregate(amount=Sum('total_price'))['amount'] or sale.total_amount
        cumulative = {}
        refunded = Decimal('0')
        shift = Shift.objects.filter(tenant_id=sale.tenant_id, closed_at__isnull=True).first()
        for log in logs:
            prior = cumulative.get(log.sale_item_id, Decimal('0'))
            current = prior + log.quantity
            cumulative[log.sale_item_id] = current
            amount = (current * log.sale_item.unit_price).quantize(Decimal('.01')) - (prior * log.sale_item.unit_price).quantize(Decimal('.01'))
            amount = min(amount, gross - refunded)
            if amount <= 0:
                continue
            refund = Refund.objects.create(
                tenant_id=sale.tenant_id, sale_id=sale.pk, amount=amount,
                currency=sale.currency, payment_type=sale.payment_type,
                recorded_by_id=log.voided_by_id, reason=log.reason,
                shift_id=shift.pk if shift and log.voided_at >= shift.opened_at and sale.payment_type != 'debt' else None,
            )
            Refund.objects.filter(pk=refund.pk).update(created_at=log.voided_at)
            refunded += amount
        Sale.objects.filter(pk=sale.pk).update(total_amount=gross, refunded_amount=refunded)


class Migration(migrations.Migration):
    dependencies = [
        ('sales', '0013_salerefund_debtpayment_idempotency_key_and_more'),
        ('cashbox', '0005_dailycashreport_collected_debt_cash_usd_and_more'),
    ]
    operations = [migrations.RunPython(bridge_legacy_cash, migrations.RunPython.noop)]
