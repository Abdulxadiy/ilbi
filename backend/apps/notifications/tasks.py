from celery import shared_task


@shared_task(name="apps.notifications.tasks.dispatch_push_events")
def dispatch_push_events():
    from .delivery import process_push_events

    return process_push_events()
