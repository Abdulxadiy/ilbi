"""One generic notification per real workspace assignment/due occurrence."""
from django.db import transaction
from django.db.models import Exists, OuterRef
from django.conf import settings
from django.utils import timezone

from apps.accounts.models import Employee
from apps.accounts.services.demo_access_service import DemoAccessService
from apps.core.models import WorkspaceReminder
from apps.sales.models import Notification


def reminder_link(reminder):
    return '/workspace/reminders/' + str(reminder.pk) + '/'


def _eligible(reminder):
    user = reminder.assigned_to
    return bool(
        reminder.tenant.is_active and user.is_active and user.terms_accepted
        and user.role != 'platform_admin' and not DemoAccessService.is_blocked(user)
        and Employee.objects.filter(user=user, tenant=reminder.tenant, is_active=True, archived_at__isnull=True).exists()
    )


def notify_assignment(reminder, actor):
    if reminder.completed_at or reminder.assigned_to_id == actor.pk or not _eligible(reminder):
        return False
    Notification.objects.create(
        tenant=reminder.tenant, recipient=reminder.assigned_to,
        type=Notification.TYPE_WORKSPACE_ASSIGNED,
        title='Sizga eslatma biriktirildi',
        message='Ish joyingizda sizga yangi eslatma biriktirildi. Tafsilotlarni ish joyi bo‘limida ko‘ring.',
        link=reminder_link(reminder),
    )
    return True


def mark_reminder_notifications_read(reminder):
    # Also suppress still-pending push for a completed, deleted or reassigned task.
    Notification.objects.filter(
        tenant=reminder.tenant, link=reminder_link(reminder), is_read=False,
        type__in=[Notification.TYPE_WORKSPACE_ASSIGNED, Notification.TYPE_WORKSPACE_DUE],
    ).update(is_read=True)


def notify_due_workspace_reminders(*, now=None, limit=200):
    now = now or timezone.now()
    notified = 0
    membership = Employee.objects.filter(user_id=OuterRef('assigned_to_id'), tenant_id=OuterRef('tenant_id'), is_active=True, archived_at__isnull=True)
    rows = WorkspaceReminder.objects.filter(
        completed_at__isnull=True, due_notified_at__isnull=True, due_at__lte=now,
        tenant__is_active=True, assigned_to__is_active=True, assigned_to__terms_accepted=True,
    ).filter(Exists(membership)).exclude(assigned_to__role='platform_admin')
    if not (settings.DEBUG and settings.LOCAL_DEMO_LOGIN_ENABLED):
        rows = rows.exclude(assigned_to__groups__name__in=[DemoAccessService.GROUP_NAME, DemoAccessService.LEGACY_GROUP_NAME])
    ids = list(rows.order_by('due_at', 'pk').values_list('pk', flat=True)[:max(1, min(limit, 1000))])
    for reminder_id in ids:
        with transaction.atomic():
            reminder = WorkspaceReminder.objects.select_for_update(of=('self',), skip_locked=True).select_related('tenant', 'assigned_to').filter(
                pk=reminder_id, completed_at__isnull=True, due_notified_at__isnull=True, due_at__lte=now,
            ).first()
            if reminder is None or not _eligible(reminder):
                continue
            Notification.objects.create(
                tenant=reminder.tenant, recipient=reminder.assigned_to,
                type=Notification.TYPE_WORKSPACE_DUE,
                title='Eslatma vaqti keldi',
                message='Ish joyingizdagi eslatmaning belgilangan vaqti keldi. Tafsilotlarni ish joyi bo‘limida ko‘ring.',
                link=reminder_link(reminder),
            )
            reminder.due_notified_at = now
            reminder.save(update_fields=['due_notified_at'])
            notified += 1
    return notified
