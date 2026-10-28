from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.sales.models import Notification

from .models import PushEvent


@receiver(post_save, sender=Notification, dispatch_uid="ilbi_notification_push_event")
def queue_inbox_push(sender, instance, created, raw=False, **kwargs):
    # No network/broker call here. The event commits or rolls back with the inbox.
    if created and not raw:
        PushEvent.objects.get_or_create(notification=instance)
