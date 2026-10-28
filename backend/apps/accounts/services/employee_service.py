"""Service layer for hiring and firing Employee records."""

from django.db import IntegrityError, models, transaction
from django.utils import timezone
from apps.accounts.models import User, Employee
from apps.permissions.constants import OWNER_ONLY_PERMISSIONS
from apps.accounts.services.membership_policy import (
    MembershipPolicyError,
    assert_can_be_hired_as_staff,
    assert_can_own_tenants,
)


class EmployeeServiceError(Exception):
    """Base exception for EmployeeService failures."""


class PermissionDeniedError(EmployeeServiceError):
    """Raised when the acting user lacks the authority to perform the operation."""


class EmployeeService:
    """Encapsulates the business rules for assigning and revoking staff/owner roles."""

    @staticmethod
    def _check_hire_permission(hired_by: User, role: str, tenant) -> None:
        """Validate that hired_by is allowed to assign the given role."""
        if role == "owner":
            if hired_by.role != "platform_admin":
                raise PermissionDeniedError("Only platform_admin can assign the owner role.")
        elif role == "staff":
            if hired_by.role == "owner" and (
                tenant.owner_id != hired_by.id
                or not Employee.objects.filter(
                    user=hired_by,
                    tenant=tenant,
                    is_owner=True,
                    is_active=True,
                ).exists()
            ):
                raise PermissionDeniedError("Owner faqat o‘z do‘koniga xodim yollashi mumkin.")
            if hired_by.role not in ("owner", "platform_admin"):
                raise PermissionDeniedError("Only owner or platform_admin can hire staff.")
        else:
            raise EmployeeServiceError(f"hire() cannot assign role '{role}'.")

    @staticmethod
    def _check_fire_permission(fired_by: User, employee: Employee) -> None:
        """Validate that fired_by is allowed to fire this employee."""
        if fired_by.role == "platform_admin":
            return
        if (
            fired_by.role == "owner"
            and employee.tenant.owner_id == fired_by.id
            and not employee.is_owner
        ):
            return
        raise PermissionDeniedError("You are not allowed to fire this employee.")

    @classmethod
    @transaction.atomic
    def hire(
        cls,
        *,
        target_user: User = None,
        phone_number: str = None,
        email: str = None,
        first_name: str = "",
        last_name: str = "",
        tenant,
        hired_by: User,
        permissions=None,
        position: str = "",
        role: str = "staff",
    ) -> Employee:
        """
        Assign target_user (or user identified/created by phone_number) to tenant
        with the given role, creating a new active Employee record.

        Per updated roadmap:
        - Accepts either `phone_number` (preferred: gets or creates User record)
          or `target_user` (for backward compatibility with existing tests/callers).
        - Optionally accepts `email` to associate with the user for invitation links.
        - If the user already has an active Employee record elsewhere or here,
          hire is blocked with EmployeeServiceError (must be explicitly fired first).
        - Does NOT touch username/password: password is set via email flow.
        """
        cls._check_hire_permission(hired_by, role, tenant)
        if role == "staff" and permissions and any(
            permission.full_code in OWNER_ONLY_PERMISSIONS for permission in permissions
        ):
            raise EmployeeServiceError("Faqat do‘kon egasiga tegishli ruxsatlarni xodimga berib bo‘lmaydi.")

        if phone_number:
            defaults = {
                "role": role,
                "profile_completed": False,
                "first_name": first_name,
                "last_name": last_name,
            }
            if email:
                defaults["email"] = email
            target_user, created = User.objects.get_or_create(
                phone_number=phone_number,
                defaults=defaults,
            )
            if created:
                # A new hire must use the emailed setup link before login.
                # The model's default empty password is considered "usable"
                # by Django and would otherwise suppress the invitation.
                target_user.set_unusable_password()
                target_user.save(update_fields=["password"])
            elif email and target_user.email and target_user.email.casefold() != email.casefold():
                raise EmployeeServiceError("Bu telefon raqamiga boshqa email biriktirilgan.")
            elif email and not target_user.email:
                target_user.email = email
                target_user.save(update_fields=["email"])
        elif target_user is None:
            raise EmployeeServiceError("Either phone_number or target_user must be provided.")
        elif email and target_user.email and target_user.email.casefold() != email.casefold():
            raise EmployeeServiceError("Bu hisobga boshqa email biriktirilgan.")
        elif email and not target_user.email:
            target_user.email = email
            target_user.save(update_fields=["email"])

        try:
            if role == "staff":
                assert_can_be_hired_as_staff(target_user)
            else:
                assert_can_own_tenants(target_user)
        except MembershipPolicyError as exc:
            raise EmployeeServiceError(str(exc)) from exc

        existing_active_qs = Employee.objects.select_for_update().filter(
            user=target_user, is_active=True
        )
        if role == "owner":
            existing_active_qs = existing_active_qs.filter(
                models.Q(is_owner=False) | models.Q(tenant=tenant)
            )
        existing_active = existing_active_qs.first()
        if existing_active:
            raise EmployeeServiceError(
                "User already has an active employment. They must be fired from their current position before being hired."
            )

        try:
            employee = Employee.objects.create(
                user=target_user,
                tenant=tenant,
                is_owner=(role == "owner"),
                position=position,
                is_active=True,
                hired_by=hired_by,
            )
        except IntegrityError as exc:
            raise EmployeeServiceError(
                "Bu foydalanuvchi boshqa joyda faol ishlayapti."
            ) from exc

        if permissions:
            employee.permissions.set(permissions)

        from apps.core.models import AuditAction
        from apps.core.services.audit_service import AuditService
        AuditService.log(
            action=AuditAction.EMPLOYEE_HIRE,
            actor=hired_by,
            tenant=tenant,
            target_model="Employee",
            target_id=str(employee.id),
            changes={"role": role, "position": position, "user_id": target_user.id},
            description=f"Employee {target_user.id} hired by {hired_by.id}",
        )

        return employee

    @staticmethod
    @transaction.atomic
    def fire(*, target_user: User, fired_by: User, tenant=None) -> Employee:
        """
        Deactivate target_user's current active Employee record.

        Per Variant A:
        - target_user.role is retained (not demoted to customer).
        - target_user password is set unusable so they cannot log in.
        - The Employee record is marked is_active=False with fired_at/fired_by.
        - Because PermissionService only grants access to active Employee records,
          the fired employee immediately loses all permissions across the system.
        """
        employees = Employee.objects.select_for_update().filter(
            user=target_user, is_active=True
        )
        if tenant is not None:
            employees = employees.filter(tenant=tenant)
        elif employees.count() > 1:
            raise EmployeeServiceError("Do‘kon konteksti talab qilinadi.")
        employee = employees.first()
        if employee is None:
            raise EmployeeServiceError("No active Employee record found for this user.")

        EmployeeService._check_fire_permission(fired_by, employee)

        employee.is_active = False
        employee.fired_at = timezone.now()
        employee.fired_by = fired_by
        employee.save(update_fields=["is_active", "fired_at", "fired_by"])
        if not Employee.objects.filter(
            user=target_user, is_active=True, is_owner=True
        ).exists():
            target_user.set_unusable_password()
            target_user.token_version = getattr(target_user, "token_version", 1) + 1
            target_user.save(update_fields=["password", "token_version"])

        from apps.core.models import AuditAction
        from apps.core.services.audit_service import AuditService
        AuditService.log(
            action=AuditAction.EMPLOYEE_FIRE,
            actor=fired_by,
            tenant=employee.tenant,
            target_model="Employee",
            target_id=str(employee.id),
            changes={"is_active": {"old": True, "new": False}},
            description=f"Employee {getattr(target_user, 'phone_number', '') or target_user.id} fired by {getattr(fired_by, 'phone_number', '') or fired_by.id}",
        )

        return employee
