import os
from celery import Celery
from celery.schedules import crontab

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

app = Celery('ilbi')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()

app.conf.beat_schedule = {
    'notify-due-workspace-reminders': {
        'task': 'apps.core.tasks.notify_due_workspace_reminders_task',
        'schedule': 60.0,
    },
    'dispatch-mobile-push-events': {
        'task': 'apps.notifications.tasks.dispatch_push_events',
        'schedule': 30.0,
    },
    'notify-due-debts-periodic': {
        'task': 'apps.sales.tasks.notify_due_debts_task',
        'schedule': crontab(minute='*/5'),
    },
    # Recheck hourly so delayed publications/recovery are picked up the same day.
    'sync-cbu-rates-hourly': {
        'task': 'apps.tenants.tasks.sync_cbu_rates_task',
        'schedule': crontab(minute=0),
    },
    'auto-expire-b2b-transfers-hourly': {
        'task': 'apps.sales.tasks.auto_expire_transfers_task',
        'schedule': crontab(minute=0),
    },
    'check-and-send-daily-reports-periodic': {
        'task': 'apps.cashbox.tasks.check_and_send_daily_reports_task',
        'schedule': crontab(minute='*/5'),
    },
    'check-and-send-low-stock-reports-periodic': {
        'task': 'apps.inventory.tasks.check_and_send_low_stock_reports_task',
        'schedule': crontab(minute='*/5'),
    },
}
