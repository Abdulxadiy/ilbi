"""
Tenant-isolation tests for the hire/fire endpoints, covering the 8-bosqich
TenantContextMixin (api/mixins.py) via its only current consumers:
EmployeeHireView and EmployeeFireView.

These tests intentionally do NOT re-test EmployeeService's own business
rules (already covered in test_employee_service.py) -- they only check
the authority/active-tenant gate that now runs in
resolve_tenant_from_url() BEFORE the service is ever called.
"""
import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Employee
from tests.factories import UserFactory, OwnerFactory, TenantFactory, EmployeeFactory

pytestmark = pytest.mark.django_db

HIRE_URL = "/api/v1/tenants/{tenant_id}/employees/hire/"
FIRE_URL = "/api/v1/tenants/{tenant_id}/employees/fire/"


@pytest.fixture
def api_client():
    return APIClient()


class TestHireAuthority:
    def test_platform_admin_can_hire_into_any_tenant(self, api_client, platform_admin, tenant):
        api_client.force_authenticate(user=platform_admin)
        target = UserFactory()

        response = api_client.post(
            HIRE_URL.format(tenant_id=tenant.id),
            {"target_user_id": target.id, "position": "Cashier"},
        )

        assert response.status_code == 201

    def test_owner_cannot_hire_into_a_tenant_they_do_not_own(self, api_client, tenant):
        # `tenant` (from conftest.py) is owned by ITS OWN `owner` fixture
        # instance. To test cross-tenant denial we need a genuinely
        # DIFFERENT owner who has no relationship to `tenant` at all --
        # reusing the `owner` fixture here would hand the tenant's actual
        # owner right back (tenant's fixture depends on owner, and pytest
        # caches fixtures per test), which is why this test previously
        # asserted a real owner gets 403 on their own tenant and failed.
        other_owner = OwnerFactory()
        api_client.force_authenticate(user=other_owner)
        target = UserFactory()

        response = api_client.post(
            HIRE_URL.format(tenant_id=tenant.id),
            {"target_user_id": target.id, "position": "Cashier"},
        )

        assert response.status_code == 403

    def test_hiring_into_a_nonexistent_tenant_is_404(self, api_client, platform_admin):
        api_client.force_authenticate(user=platform_admin)
        target = UserFactory()

        response = api_client.post(
            HIRE_URL.format(tenant_id=999999),
            {"target_user_id": target.id, "position": "Cashier"},
        )

        assert response.status_code == 404


class TestInactiveTenantIsClosedForBusiness:
    """New 8-bosqich behaviour: a deactivated tenant blocks hire/fire for
    EVERYONE, including platform_admin -- deactivation means frozen, not
    just hidden from its own owner/staff."""

    def test_platform_admin_cannot_hire_into_a_deactivated_tenant(
        self, api_client, platform_admin, tenant
    ):
        tenant.is_active = False
        tenant.save(update_fields=["is_active"])
        api_client.force_authenticate(user=platform_admin)
        target = UserFactory()

        response = api_client.post(
            HIRE_URL.format(tenant_id=tenant.id),
            {"target_user_id": target.id, "position": "Cashier"},
        )

        assert response.status_code == 403

    def test_owner_cannot_fire_within_a_deactivated_own_tenant(
        self, api_client, owner, tenant, platform_admin
    ):
        staff_member = UserFactory()
        EmployeeFactory(
            user=staff_member, tenant=tenant, is_active=True, hired_by=owner,
        )
        tenant.is_active = False
        tenant.save(update_fields=["is_active"])
        api_client.force_authenticate(user=owner)

        response = api_client.post(
            FIRE_URL.format(tenant_id=tenant.id),
            {"target_user_id": staff_member.id},
        )

        assert response.status_code == 403
        # And the employee must genuinely still be active -- the service
        # was never reached.
        assert Employee.objects.get(user=staff_member).is_active is True