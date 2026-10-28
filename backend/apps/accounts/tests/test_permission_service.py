"""
Tests for apps/accounts/services/permission_service.py -- the
Employee.permissions-backed action-permission check.
"""
import pytest
from apps.permissions.models import Permission

from apps.accounts.services.permission_service import PermissionService
from tests.factories import PlatformAdminFactory, OwnerFactory, StaffFactory, TenantFactory, EmployeeFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def some_permission():
    return Permission.objects.create(
        category="accounts", codename="do_the_thing", name="Can do the thing"
    )

CODENAME = "accounts.do_the_thing"


class TestPlatformAdminAndOwner:
    def test_platform_admin_always_allowed(self):
        admin = PlatformAdminFactory()
        assert PermissionService.has_permission(admin, CODENAME) is True

    def test_owner_always_allowed(self):
        owner = OwnerFactory()
        tenant = TenantFactory(owner=owner)
        employee = EmployeeFactory(user=owner, tenant=tenant, position="Owner", is_active=True)
        assert PermissionService.has_permission(owner, CODENAME, tenant, employee) is True

    def test_owner_allowed_even_with_no_matching_grant_anywhere(self, some_permission):
        # Owners bypass the Employee.permissions check entirely --
        # confirms this isn't accidentally falling through to a real
        # grant lookup that happens to match.
        owner = OwnerFactory()
        tenant = TenantFactory(owner=owner)
        employee = EmployeeFactory(user=owner, tenant=tenant, position="Owner", is_active=True)
        assert PermissionService.has_permission(
            owner, "accounts.nonexistent_codename", tenant, employee
        ) is True

    def test_owner_without_active_employee_record_denied(self):
        # A bare OwnerFactory() with no Employee row at all -- e.g. an
        # owner whose tenant creation partially failed, or any state
        # where role="owner" was set without a matching employment.
        owner = OwnerFactory()
        assert PermissionService.has_permission(owner, CODENAME, TenantFactory()) is False

    def test_former_owner_denied_after_change_owner(self):
        # Regression test: TenantService.change_owner() fires the old
        # owner via EmployeeService.fire(), which (Variant A) leaves
        # User.role == "owner" untouched for audit purposes. Before the
        # fix, has_permission() short-circuited on role alone and kept
        # granting the former owner full access forever. It must now
        # check for an ACTIVE Employee record too.
        old_owner = OwnerFactory()
        tenant = TenantFactory(owner=old_owner)
        EmployeeFactory(
            user=old_owner, tenant=tenant, position="Owner", is_active=False
        )
        assert old_owner.role == "owner"
        assert PermissionService.has_permission(old_owner, CODENAME, tenant) is False


class TestStaff:
    def test_staff_with_granted_permission_allowed(self, some_permission):
        staff = StaffFactory()
        tenant = TenantFactory()
        employee = EmployeeFactory(user=staff, tenant=tenant, is_active=True)
        employee.permissions.add(some_permission)

        assert PermissionService.has_permission(staff, CODENAME, tenant, employee) is True

    def test_staff_without_granted_permission_denied(self, some_permission):
        staff = StaffFactory()
        tenant = TenantFactory()
        employee = EmployeeFactory(user=staff, tenant=tenant, is_active=True)
        # Permission exists but was never granted to this employee.

        assert PermissionService.has_permission(staff, CODENAME, tenant, employee) is False

    def test_fired_staff_denied_even_though_old_grant_still_exists_on_the_row(self, some_permission):
        staff = StaffFactory()
        tenant = TenantFactory()
        employee = EmployeeFactory(user=staff, tenant=tenant, is_active=False)
        employee.permissions.add(some_permission)

        assert PermissionService.has_permission(staff, CODENAME) is False

    def test_staff_role_with_no_employee_record_at_all_denied(self):
        staff = StaffFactory()  # role="staff" but no Employee row created
        assert PermissionService.has_permission(staff, CODENAME) is False


class TestCustomerAndAnonymous:
    def test_customer_always_denied(self):
        from tests.factories import UserFactory
        customer = UserFactory()
        assert PermissionService.has_permission(customer, CODENAME) is False

    def test_none_user_denied(self):
        assert PermissionService.has_permission(None, CODENAME) is False


class TestCodenameFormat:
    def test_malformed_codename_without_app_label_raises(self):
        staff = StaffFactory()
        with pytest.raises(ValueError):
            PermissionService.has_permission(staff, "no_dot_here")
