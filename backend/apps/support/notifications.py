"""Private, recipient-specific inbox events for committed support messages.

Called only in the source API's transaction after its client_id replay check.
No chat text, attachment, name, subject or guest credential is copied here.
"""
from apps.accounts.models import Employee, User
from apps.accounts.services.demo_access_service import DemoAccessService
from apps.sales.models import Notification


def _link(conversation):
    return '/support?conversation=' + str(conversation.pk)


def notify_support_message(message):
    conversation = message.conversation
    if not conversation.tenant_id or not conversation.tenant.is_active or message.sender not in {'visitor', 'operator'}:
        return 0
    if message.sender == 'operator':
        if not conversation.user_id:
            return 0
        recipients = User.objects.filter(pk=conversation.user_id)
    else:
        recipients = User.objects.filter(role='platform_admin')
        if conversation.operator_id:
            recipients = recipients.filter(pk=conversation.operator_id)
    count = 0
    for recipient in recipients.filter(is_active=True, terms_accepted=True).exclude(pk=message.author_id):
        if DemoAccessService.is_blocked(recipient):
            continue
        if recipient.role != 'platform_admin' and not Employee.objects.filter(
            user=recipient, tenant_id=conversation.tenant_id, is_active=True, archived_at__isnull=True,
        ).exists():
            continue
        Notification.objects.create(
            tenant_id=conversation.tenant_id,
            recipient=recipient,
            type=Notification.TYPE_SUPPORT_MESSAGE,
            title='Yordam markazida yangi xabar',
            message='Yordam suhbatida yangi xabar bor. Tafsilotlarni qo‘llab-quvvatlash bo‘limida ko‘ring.',
            link=_link(conversation),
        )
        count += 1
    return count


def mark_support_read(conversation, user):
    if user and conversation.tenant_id:
        Notification.objects.filter(
            tenant_id=conversation.tenant_id, recipient=user,
            type=Notification.TYPE_SUPPORT_MESSAGE, link=_link(conversation), is_read=False,
        ).update(is_read=True)


def suppress_unassigned_operator_alerts(conversation):
    if conversation.tenant_id:
        Notification.objects.filter(
            tenant_id=conversation.tenant_id, type=Notification.TYPE_SUPPORT_MESSAGE,
            link=_link(conversation), recipient__role='platform_admin', is_read=False,
        ).exclude(recipient_id=conversation.user_id).update(is_read=True)
