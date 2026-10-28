"""
Central action-permission check, sitting on top of Employee.permissions
(NOT user.user_permissions/Group -- see roadmap: permission checks must
read from the active Employee record so a fired/transferred employee's
old permissions never survive, which Django's built-in
user.has_perm() can't guarantee since it doesn't know about
"active employment").

The active tenant and membership are resolved from the database for
each request. Staff permissions are read from that exact membership.

Role behavior:
- platform_admin: always allowed, every permission, any tenant.
- owner: allowed, every permission, but ONLY while they hold an ACTIVE
  Employee record -- and ONLY within their own tenant (Tenant.owner is
  a OneToOneField, so an owner structurally can't act on a different
  tenant's data once the tenant-scoping permission class is combined
  in; this service doesn't need to know which tenant). A former owner
  replaced via TenantService.change_owner() keeps role="owner" on the
  User row for audit purposes (fire() Variant A), but their Employee
  record is is_active=False, so they are correctly denied here.
- staff: allowed only if their current ACTIVE Employee record has the
  requested Permission attached.
- customer, or anyone with no active employment at all: never allowed.
"""
from apps.accounts.models import Employee
from apps.permissions.constants import OWNER_ONLY_PERMISSIONS


class PermissionService:
    @staticmethod
    def has_permission(user, codename: str, tenant=None, employee=None) -> bool:
        """
        :param user: the acting User (request.user).
        :param codename: a Django-style "app_label.codename" string,
            e.g. "catalog.add_product" -- same format as the built-in
            user.has_perm().
        :param tenant: the active tenant resolved for this request.
        :param employee: the active membership in that tenant.
        """
        # Validate the codename format unconditionally, before any
        # role/employment short-circuit. A malformed codename is a bug
        # in the CALLER, not a fact about this particular user's
        # permissions -- it must fail loudly the same way for every
        # user, not silently resolve to False just because this
        # particular user happened to lack active employment.
        category, _, short_codename = codename.partition(".")
        if not short_codename:
            raise ValueError(
                f"codename must be 'category.codename', got: {codename!r}"
            )

        if user is None or not getattr(user, "is_authenticated", False):
            return False

        if user.role == "platform_admin":
            return True

        if user.role not in ("owner", "staff"):
            # customer, or anything else with no employment concept
            return False

        # Old/manual grants cannot turn non-assignable owner actions into staff powers.
        owner_only = codename in OWNER_ONLY_PERMISSIONS
        if owner_only and user.role != "owner":
            return False

        if employee is None and tenant is not None:
            employee = Employee.objects.filter(
                user=user, tenant=tenant, is_active=True
            ).first()
        if employee is None or not employee.is_active:
            return False

        if employee.is_owner and employee.tenant_id == getattr(tenant, "id", None):
            return True

        if owner_only:
            return False

        return employee.permissions.filter(
            category=category, codename=short_codename
        ).exists()
