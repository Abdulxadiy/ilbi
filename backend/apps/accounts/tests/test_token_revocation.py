import pytest
from rest_framework.test import APIClient
from rest_framework import status
from tests.factories import OwnerFactory, StaffFactory, TenantFactory
from apps.accounts.services.employee_service import EmployeeService
from api.v1.accounts.views.misc import issue_tokens


@pytest.mark.django_db
class TestTokenRevocation:
    def test_token_revocation_on_token_version_increment(self, tenant):
        client = APIClient()

        owner = tenant.owner
        owner.refresh_from_db()
        owner.token_version = 1
        owner.save(update_fields=["token_version"])

        tokens = issue_tokens(owner)
        access_token = tokens["access"]

        # Authenticate with initial token
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {access_token}")
        response = client.get("/api/v1/catalog/categories/")
        assert response.status_code == status.HTTP_200_OK, response.data

        # Increment token version (simulates revocation)
        owner.token_version += 1
        owner.save(update_fields=["token_version"])

        # Old token must now be rejected
        response = client.get("/api/v1/catalog/categories/")
        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.data["error"]["code"] in ("token_revoked", "authentication_failed", "authentication_error")

        # Newly issued token must work
        new_tokens = issue_tokens(owner)
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {new_tokens['access']}")
        response = client.get("/api/v1/catalog/categories/")
        assert response.status_code == status.HTTP_200_OK

    def test_employee_fire_immediately_revokes_jwt_tokens(self, tenant):
        client = APIClient()

        owner = tenant.owner
        owner.refresh_from_db()
        staff = StaffFactory(token_version=1)
        employee = EmployeeService.hire(target_user=staff, tenant=tenant, hired_by=owner)

        from apps.permissions.models import Permission
        employee.permissions.set(Permission.objects.filter(category="catalog"))

        tokens = issue_tokens(staff)
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        response = client.get("/api/v1/catalog/categories/")
        assert response.status_code == status.HTTP_200_OK

        # Fire employee
        EmployeeService.fire(target_user=staff, fired_by=owner)
        staff.refresh_from_db()
        assert staff.token_version == 2

        # Staff's old JWT token must immediately be rejected with 401
        response = client.get("/api/v1/catalog/categories/")
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

