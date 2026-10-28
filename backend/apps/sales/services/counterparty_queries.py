from datetime import timedelta

from django.db.models import Q
from django.utils import timezone

from apps.sales.models import Counterparty

DUE_SOON_DAYS = 7
DUE_STATUSES = ('overdue', 'today', 'soon', 'future', 'undated')


def counterparty_business_date():
    # Business rules follow the configured shop timezone, never the caller's clock.
    return timezone.localdate(timezone=timezone.get_default_timezone())


def filtered_counterparties(tenant, params, *, today=None):
    qs = Counterparty.objects.filter(tenant=tenant)
    if params.get('active', 'true').lower() == 'true':
        qs = qs.filter(is_active=True)
    search = (params.get('search') or '').strip()
    if search:
        qs = qs.filter(Q(name__icontains=search) | Q(phone_number__icontains=search) | Q(note__icontains=search))
    balance = params.get('balance_status')
    if balance == 'debtors' or params.get('has_debt', '').lower() in ('true', '1'):
        qs = qs.filter(Q(debt_balance_uzs__gt=0) | Q(debt_balance_usd__gt=0))
    elif balance == 'credit':
        qs = qs.filter(Q(debt_balance_uzs__lt=0) | Q(debt_balance_usd__lt=0))
    elif balance == 'settled':
        qs = qs.filter(debt_balance_uzs=0, debt_balance_usd=0)
    due = params.get('due_status')
    if due in DUE_STATUSES:
        today = today or counterparty_business_date()
        qs = qs.filter(Q(debt_balance_uzs__gt=0) | Q(debt_balance_usd__gt=0))
        if due == 'overdue':
            qs = qs.filter(debt_due_date__lt=today)
        elif due == 'today':
            qs = qs.filter(debt_due_date=today)
        elif due == 'soon':
            qs = qs.filter(debt_due_date__gt=today, debt_due_date__lte=today + timedelta(days=DUE_SOON_DAYS))
        elif due == 'future':
            qs = qs.filter(debt_due_date__gt=today + timedelta(days=DUE_SOON_DAYS))
        else:
            qs = qs.filter(debt_due_date__isnull=True)
    return qs.order_by('name', 'pk')
