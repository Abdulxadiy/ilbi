from celery import shared_task


@shared_task(name='apps.core.tasks.notify_due_workspace_reminders_task')
def notify_due_workspace_reminders_task():
    from apps.core.services.workspace_notifications import notify_due_workspace_reminders
    return notify_due_workspace_reminders()
