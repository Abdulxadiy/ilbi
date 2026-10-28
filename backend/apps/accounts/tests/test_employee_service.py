"""
Place at: apps/accounts/tests/test_employee_service.py

Requires converting apps/accounts/tests.py (single file) into a
apps/accounts/tests/ package first:
    - delete/empty the old apps/accounts/tests.py
    - create apps/accounts/tests/__init__.py
    - drop this file alongside it

Covers EmployeeService.hire() and .fire(), which together implement:
  - the role-based permission matrix for hiring/firing
    (see EmployeeService._check_hire_permission / _check_fire_permission)
  - the "one active Employee per user" invariant, enforced by hire()
    auto-firing any existing active employment before creating a new one
  - the fact that both service methods are @transaction.atomic, so a
    failure partway through must not leave partial writes behind
"""
import pytest

from apps.accounts.models import Employee
from apps.accounts.services.employee_service import (
    EmployeeService,
    EmployeeServiceError,
    PermissionDeniedError,
)
from tests.factories import (
    PlatformAdminFactory,
    OwnerFactory,
    StaffFactory,
    UserFactory,
    TenantFactory,
    EmployeeFactory,
)

# Applies django_db to every test function/class in this module, so we
# don't have to repeat @pytest.mark.django_db on each test individually.
pytestmark = pytest.mark.django_db


class TestHirePermissions:
    """Exercises EmployeeService._check_hire_permission() indirectly
    through hire(): who is allowed to assign which role to someone else.
    """

    def test_platform_admin_can_hire_owner(self, platform_admin, tenant):
        # Only platform_admin may assign role="owner" (see
        # _check_hire_permission: role == "owner" branch).
        target = OwnerFactory()
        employee = EmployeeService.hire(
            target_user=target, tenant=tenant, hired_by=platform_admin,
            role="owner", position="Owner",
        )
        assert employee.is_active is True
        target.refresh_from_db()
        # Role is identity-wide; tenant access is represented by employment.
        assert target.role == "owner"
        assert Employee.objects.filter(user=target, tenant=tenant, is_owner=True).exists()

    def test_owner_cannot_hire_owner(self, owner, tenant):
        # An owner is not allowed to promote someone else to owner —
        # that's reserved for platform_admin only.
        target = UserFactory()
        with pytest.raises(PermissionDeniedError):
            EmployeeService.hire(
                target_user=target, tenant=tenant, hired_by=owner, role="owner",
            )

    def test_owner_cannot_be_hired_as_staff(self, owner, tenant):
        with pytest.raises(EmployeeServiceError, match="egasi"):
            EmployeeService.hire(
                target_user=owner, tenant=tenant, hired_by=tenant.owner,
                role="staff",
            )

    def test_owner_can_hire_staff(self, owner, tenant):
        # Owners CAN hire staff (unlike hiring owners) — this is the
        # normal day-to-day "hire an employee" path for a shop owner.
        target = UserFactory()
        employee = EmployeeService.hire(
            target_user=target, tenant=tenant, hired_by=owner, role="staff",
        )
        assert employee.tenant_id == tenant.id
        target.refresh_from_db()
        assert target.role == "staff"

    def test_owner_can_hire_staff_with_phone_number(self, owner, tenant):
        """Owner hires a new staff member by providing only their phone number."""
        phone = "+998905554433"
        employee = EmployeeService.hire(
            phone_number=phone, tenant=tenant, hired_by=owner, role="staff", position="Salesperson"
        )
        assert employee.tenant_id == tenant.id
        assert employee.position == "Salesperson"
        assert employee.is_active is True

        user = employee.user
        assert user.phone_number == phone
        assert user.role == "staff"
        assert Employee.objects.filter(user=user, tenant=tenant, is_active=True).exists()

    def test_staff_cannot_hire_staff(self, tenant):
        # staff has no hiring authority at all, regardless of tenant.
        acting_staff = StaffFactory()
        target = UserFactory()
        with pytest.raises(PermissionDeniedError):
            EmployeeService.hire(
                target_user=target, tenant=tenant, hired_by=acting_staff, role="staff",
            )

    def test_customer_cannot_hire(self, customer, tenant):
        # customer is the "no special role" default — must never be able
        # to hire anyone.
        target = UserFactory()
        with pytest.raises(PermissionDeniedError):
            EmployeeService.hire(
                target_user=target, tenant=tenant, hired_by=customer, role="staff",
            )

    def test_cannot_hire_a_platform_admin(self, platform_admin, tenant):
        # hire() explicitly rejects hiring a platform_admin as an employee
        # (platform_admin accounts stay outside the tenant/employee system
        # entirely — see EmployeeService.hire(): "Cannot hire a
        # platform_admin user.").
        other_admin = PlatformAdminFactory()
        with pytest.raises(EmployeeServiceError):
            EmployeeService.hire(
                target_user=other_admin, tenant=tenant, hired_by=platform_admin,
                role="staff",
            )

    def test_hire_rejects_unknown_role(self, platform_admin, tenant):
        # hire() only knows how to assign "staff" or "owner" — anything
        # else (including "customer", which isn't a hireable role) must
        # raise, not silently do nothing.
        target = UserFactory()
        with pytest.raises(EmployeeServiceError):
            EmployeeService.hire(
                target_user=target, tenant=tenant, hired_by=platform_admin,
                role="customer",
            )


class TestHireActiveEmploymentBlocking:
    """target_user already has an active Employee -> hire() must raise
    EmployeeServiceError instead of auto-firing. The user must be explicitly
    fired before they can be hired elsewhere.
    """

    def test_hire_raises_if_user_already_has_active_employment(self, platform_admin):
        """Platform admin cannot hire a user who already has an active Employee record."""
        old_tenant = TenantFactory()
        new_tenant = TenantFactory()
        target = StaffFactory()
        old_employment = EmployeeFactory(user=target, tenant=old_tenant, is_active=True)

        with pytest.raises(EmployeeServiceError) as exc_info:
            EmployeeService.hire(
                target_user=target, tenant=new_tenant, hired_by=platform_admin, role="staff",
            )

        assert "faol ishlayapti" in str(exc_info.value)

        # Ensure old employment record is still active and untouched
        old_employment.refresh_from_db()
        assert old_employment.is_active is True
        assert old_employment.tenant_id == old_tenant.id

        assert Employee.objects.filter(user=target, tenant=old_tenant, is_active=True).exists()

    def test_owner_cannot_hire_user_employed_at_another_tenant(self, owner, tenant):
        """An owner cannot hire someone who is currently employed elsewhere."""
        other_tenant = TenantFactory()
        target = StaffFactory()
        EmployeeFactory(user=target, tenant=other_tenant, is_active=True)

        with pytest.raises(EmployeeServiceError):
            EmployeeService.hire(
                target_user=target, tenant=tenant, hired_by=owner, role="staff",
            )

    def test_hire_is_atomic_on_active_employment_failure(self, platform_admin):
        """If hire() raises due to active employment, no mutation occurs."""
        other_tenant = TenantFactory()
        new_tenant = TenantFactory()
        target = StaffFactory()
        EmployeeFactory(user=target, tenant=other_tenant, is_active=True)

        with pytest.raises(EmployeeServiceError):
            EmployeeService.hire(
                target_user=target, tenant=new_tenant, hired_by=platform_admin, role="staff",
            )

        target.refresh_from_db()
        assert Employee.objects.filter(user=target, tenant=other_tenant, is_active=True).exists()
        assert target.role == "staff"
        assert Employee.objects.filter(user=target, is_active=True).count() == 1


class TestFire:
    """Exercises EmployeeService._check_fire_permission() indirectly
    through fire(): who may deactivate whose employment, plus the side
    effects fire() has on the User row (role reset, password wiped).
    """

    def test_platform_admin_can_fire_anyone(self, platform_admin, tenant):
        # platform_admin bypasses every other check in
        # _check_fire_permission (`if fired_by.role == "platform_admin":
        # return`) — can fire staff or owners, in any tenant.
        target = StaffFactory()
        employment = EmployeeFactory(user=target, tenant=tenant, is_active=True)

        EmployeeService.fire(target_user=target, fired_by=platform_admin)

        employment.refresh_from_db()
        assert employment.is_active is False
        assert employment.fired_by_id == platform_admin.id
        assert employment.fired_at is not None

        target.refresh_from_db()
        # Under Variant A, the user's role is retained (not demoted to customer)
        # while their password is set unusable to prevent any authentication.
        assert target.role == "staff"
        assert target.has_usable_password() is False

    def test_owner_can_fire_own_staff(self, owner, tenant):
        # An owner may fire staff within their OWN tenant — this is the
        # normal "let an employee go" flow.
        target = StaffFactory()
        EmployeeFactory(user=target, tenant=tenant, is_active=True)

        EmployeeService.fire(target_user=target, fired_by=owner)

        target.refresh_from_db()
        assert target.role == "staff"
        assert target.has_usable_password() is False

    def test_owner_cannot_fire_staff_at_another_tenant(self, owner):
        # The owner-branch of _check_fire_permission requires
        # employee.tenant == fired_by.tenant — an owner has zero
        # authority outside their own tenant.
        other_tenant = TenantFactory()
        target = StaffFactory()
        EmployeeFactory(user=target, tenant=other_tenant, is_active=True)

        with pytest.raises(PermissionDeniedError):
            EmployeeService.fire(target_user=target, fired_by=owner)

    def test_owner_cannot_fire_another_owner(self, tenant):
        # _check_fire_permission's owner-branch also excludes
        # `employee.user.role != "owner"` — even within their own tenant,
        # an owner cannot fire another owner-role user (ownership changes
        # go through TenantService.change_owner(), which is
        # platform_admin-only, not through a plain fire() call).
        acting_owner = tenant.owner
        # A second "owner"-role user incorrectly placed in the same tenant
        # (shouldn't normally happen, but the guard must hold regardless).
        other_owner = OwnerFactory()
        EmployeeFactory(user=other_owner, tenant=tenant, is_active=True, position="Owner")

        with pytest.raises(PermissionDeniedError):
            EmployeeService.fire(target_user=other_owner, fired_by=acting_owner)

    def test_staff_cannot_fire_anyone(self, tenant):
        # staff falls through every branch of _check_fire_permission to
        # the final `raise PermissionDeniedError` — no firing authority
        # whatsoever.
        acting_staff = StaffFactory()
        target = StaffFactory()
        EmployeeFactory(user=target, tenant=tenant, is_active=True)

        with pytest.raises(PermissionDeniedError):
            EmployeeService.fire(target_user=target, fired_by=acting_staff)

    def test_fire_without_active_employment_raises(self, platform_admin, customer):
        # fire() looks up an active Employee row for target_user first,
        # and must raise EmployeeServiceError (not silently succeed or
        # raise an unrelated error) when none exists — e.g. calling
        # fire() twice in a row on the same person, or on a plain
        # customer who was never hired.
        with pytest.raises(EmployeeServiceError):
            EmployeeService.fire(target_user=customer, fired_by=platform_admin)

    def test_fire_preserves_history_and_tenant_on_user(self, platform_admin, tenant):
        """fired user keeps tenant/username/role on the User row for audit
        purposes (Variant A) -- only the Employee record and password are
        touched. User.role is never used for access control; PermissionService
        and friends gate exclusively on Employee.is_active, so retaining the
        stale role here cannot grant the fired user anything."""
        target = StaffFactory(username="old_staff")
        EmployeeFactory(user=target, tenant=tenant, is_active=True)

        EmployeeService.fire(target_user=target, fired_by=platform_admin)

        target.refresh_from_db()
        # tenant_id, username, and role are intentionally NOT cleared by
        # fire() -- they stay on the row so historical Employee records
        # still resolve to a meaningful "who/where/what" even after the
        # person is no longer active there.
        assert Employee.objects.filter(user=target, tenant=tenant, is_active=False).exists()
        assert target.username == "old_staff"
        assert target.role == "staff"
        assert target.has_usable_password() is False
