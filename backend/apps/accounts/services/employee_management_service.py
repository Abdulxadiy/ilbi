"""Audited account controls scoped to a tenant's employee directory."""

import logging

from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Employee, User
from apps.accounts.services import login_throttle
from apps.accounts.services.password_reset_service import (
    invalidate_password_links,
    request_password_reset_for_user,
)
from apps.core.models import AuditAction
from apps.core.services.audit_service import AuditService
from apps.permissions.constants import OWNER_ONLY_PERMISSIONS

logger = logging.getLogger(__name__)


class EmployeeManagementService:
    @staticmethod
    def allowed_actions(actor, employee):
        """Use prefetched memberships when rendering the directory."""
        user = employee.user
        memberships = list(user.employments.all())
        elsewhere = any(row.is_active and row.tenant_id != employee.tenant_id for row in memberships)
        is_admin = actor.role == "platform_admin"
        tenant_owner = actor.role == "owner" and employee.tenant.owner_id == actor.id
        authority = is_admin or (tenant_owner and not employee.is_owner and user.role == "staff")
        authority = authority and actor.is_active and user.role != "platform_admin" and actor.id != user.id
        account_authority = authority and (is_admin or not elsewhere)
        archived = employee.archived_at is not None
        current_owner = employee.tenant.owner_id == user.id
        return {
            "edit": bool(account_authority and not archived),
            "block": bool(account_authority and not archived),
            "invite": bool(account_authority and not archived and employee.is_active and user.is_active and user.email),
            "archive": bool(authority and not archived and not current_owner),
            "restore": bool(authority and archived and not current_owner),
        }

    @classmethod
    def _authorize(cls, actor, employee, action):
        if actor.role != "platform_admin" and not Employee.objects.filter(
            user=actor, tenant=employee.tenant, is_owner=True, is_active=True,
            tenant__owner=actor, tenant__is_active=True,
        ).exists():
            raise PermissionDenied("Faqat do‘kon egasi yoki platforma administratori ruxsat etilgan.")
        if not cls.allowed_actions(actor, employee)[action]:
            if action == "archive" and employee.tenant.owner_id == employee.user_id:
                raise PermissionDenied("Avval do‘kon egaligini boshqa hisobga o‘tkazing.")
            raise PermissionDenied("Bu hisob uchun ushbu amalni bajarishga ruxsat yo‘q.")

    @staticmethod
    def _locked(employee):
        """Match fire's membership-first lock order, then refresh the locked account."""
        employee = Employee.objects.select_for_update(of=("self",)).select_related("tenant").get(pk=employee.pk)
        employee.user = User.objects.select_for_update().get(pk=employee.user_id)
        return employee

    @staticmethod
    def _audit(employee, actor, action, changes, request):
        AuditService.log(
            action=action, actor=actor, tenant=employee.tenant,
            target_model="Employee", target_id=str(employee.pk),
            changes=changes, description=f"Employee directory action: {employee.pk}",
            request=request,
        )

    @classmethod
    @transaction.atomic
    def update(cls, *, employee, actor, values, request=None):
        employee = cls._locked(employee)
        cls._authorize(actor, employee, "edit")
        user = employee.user
        changed = []
        if 'permissions' in values and not employee.is_owner:
            if any(permission.full_code in OWNER_ONLY_PERMISSIONS for permission in values['permissions']):
                raise PermissionDenied("Faqat do‘kon egasiga tegishli ruxsatlarni xodimga berib bo‘lmaydi.")
            before = set(employee.permissions.values_list('pk', flat=True))
            after = {permission.pk for permission in values['permissions']}
            if before != after:
                employee.permissions.set(values['permissions'])
                changed.append('permissions')
        user_fields = []
        for field in ("first_name", "last_name", "email", "contact_phone"):
            if field in values and (getattr(user, field) or "") != values[field]:
                setattr(user, field, values[field])
                user_fields.append(field)
                changed.append(field)
        if "email" in user_fields:
            invalidate_password_links(user.pk)
            user.token_version += 1
            user_fields.append("token_version")
        if user_fields:
            user.save(update_fields=user_fields)
        if "position" in values and employee.position != values["position"]:
            employee.position = values["position"]
            employee.save(update_fields=["position"])
            changed.append("position")
        if changed:
            cls._audit(employee, actor, AuditAction.EMPLOYEE_UPDATE, {"fields": sorted(changed)}, request)
        return employee

    @classmethod
    @transaction.atomic
    def set_blocked(cls, *, employee, actor, blocked, reason, request=None):
        employee = cls._locked(employee)
        cls._authorize(actor, employee, "block")
        user = employee.user
        if user.is_active == (not blocked):
            return employee
        invalidate_password_links(user.pk)
        user.is_active = not blocked
        user.token_version += 1
        user.save(update_fields=["is_active", "token_version"])
        if not blocked:
            for identifier in {user.username, user.phone_number, user.email} - {None, ""}:
                login_throttle.register_success(identifier)
        cls._audit(
            employee, actor, AuditAction.EMPLOYEE_BLOCK if blocked else AuditAction.EMPLOYEE_UNBLOCK,
            {"blocked": blocked, "reason": reason}, request,
        )
        return employee

    @classmethod
    @transaction.atomic
    def archive(cls, *, employee, actor, reason, request=None):
        employee = cls._locked(employee)
        cls._authorize(actor, employee, "archive")
        now = timezone.now()
        employee.archived_at = now
        employee.is_active = False
        employee.fired_at = employee.fired_at or now
        employee.fired_by = actor
        employee.save(update_fields=["archived_at", "is_active", "fired_at", "fired_by"])
        if not employee.user.employments.filter(is_active=True).exists():
            invalidate_password_links(employee.user_id)
            employee.user.set_unusable_password()
            employee.user.token_version += 1
            employee.user.save(update_fields=["password", "token_version"])
        cls._audit(employee, actor, AuditAction.EMPLOYEE_ARCHIVE, {"reason": reason}, request)
        return employee

    @classmethod
    @transaction.atomic
    def restore(cls, *, employee, actor, reason, request=None):
        employee = cls._locked(employee)
        cls._authorize(actor, employee, "restore")
        employee.archived_at = None
        employee.save(update_fields=["archived_at"])
        cls._audit(employee, actor, AuditAction.EMPLOYEE_RESTORE, {"reason": reason}, request)
        return employee

    @classmethod
    def resend_invitation(cls, *, employee, actor, request=None):
        cls._authorize(actor, employee, "invite")
        try:
            sent, reason = request_password_reset_for_user(
                employee.user_id, purpose="auto",
                extra_context={"tenant_name": employee.tenant.name, "position": employee.position},
            )
        except Exception as error:
            logger.warning("Employee invitation failed: employee_id=%s error=%s", employee.pk, type(error).__name__)
            sent, reason = False, "email_send_failed"
        cls._audit(
            employee, actor, AuditAction.EMPLOYEE_INVITE,
            {"sent": sent, "outcome": reason}, request,
        )
        return {"sent": sent, "reason": reason}
