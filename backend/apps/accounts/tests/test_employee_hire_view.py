"""
Regression test for the hire-endpoint gap (EmployeeHireSerializer
accepted permission_ids, but the view never passed them through to
EmployeeService.hire()) -- api/v1/accounts/views/employee_views.py.
"""
import pytest
from apps.permissions.models import Permission
from rest_framework.test import APIClient

from apps.accounts.models import Employee
from tests.factories import UserFactory

pytestmark = pytest.mark.django_db

HIRE_URL = "/api/v1/tenants/{tenant_id}/employees/hire/"


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def some_permission():
    return Permission.objects.create(
        category="accounts", codename="do_the_thing", name="Can do the thing"
    )


def test_hire_actually_grants_the_requested_permissions(
    api_client, tenant, owner, some_permission
):
    target = UserFactory()  # a plain customer, about to be hired as staff
    api_client.force_authenticate(user=owner)

    response = api_client.post(
        HIRE_URL.format(tenant_id=tenant.id),
        {
            "target_user_id": target.id,
            "position": "Cashier",
            "permission_ids": [some_permission.id],
        },
    )

    assert response.status_code == 201
    employee = Employee.objects.get(user=target, is_active=True)
    assert list(employee.permissions.all()) == [some_permission]


def test_hire_with_phone_number_via_api(api_client, tenant, owner):
    """Staff can be hired by providing only phone_number to the API endpoint."""
    api_client.force_authenticate(user=owner)
    phone = "+998901112233"

    response = api_client.post(
        HIRE_URL.format(tenant_id=tenant.id),
        {
            "phone_number": phone,
            "position": "Consultant",
        },
    )

    assert response.status_code == 201
    employee = Employee.objects.get(user__phone_number=phone, is_active=True)
    assert employee.position == "Consultant"
    assert employee.user.role == "staff"
    assert employee.tenant_id == tenant.id