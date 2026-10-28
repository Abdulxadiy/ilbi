import pytest
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.services.tenant_context_service import resolve_active_context
from tests.factories import EmployeeFactory, OwnerFactory, StaffFactory, TenantFactory

pytestmark = pytest.mark.django_db


def test_owner_with_one_shop_gets_default_context():
    owner = OwnerFactory()
    tenant = TenantFactory(owner=owner)
    employee = EmployeeFactory(user=owner, tenant=tenant, is_owner=True)

    context = resolve_active_context(owner, None)

    assert context.tenant == tenant
    assert context.employee == employee


def test_owner_with_multiple_shops_must_select_one():
    owner = OwnerFactory()
    first = TenantFactory(owner=owner)
    second = TenantFactory(owner=owner)
    EmployeeFactory(user=owner, tenant=first, is_owner=True)
    second_membership = EmployeeFactory(user=owner, tenant=second, is_owner=True)

    with pytest.raises(ValidationError):
        resolve_active_context(owner, None)

    context = resolve_active_context(owner, str(second.id))
    assert context.tenant == second
    assert context.employee == second_membership


def test_owner_cannot_select_another_owners_shop():
    owner = OwnerFactory()
    owned = TenantFactory(owner=owner)
    EmployeeFactory(user=owner, tenant=owned, is_owner=True)
    foreign = TenantFactory()

    with pytest.raises(PermissionDenied):
        resolve_active_context(owner, str(foreign.id))


def test_staff_is_limited_to_their_active_employment():
    staff = StaffFactory()
    tenant = TenantFactory()
    membership = EmployeeFactory(user=staff, tenant=tenant, is_owner=False)

    assert resolve_active_context(staff, None).employee == membership
    with pytest.raises(PermissionDenied):
        resolve_active_context(staff, str(tenant.id + 1000))
