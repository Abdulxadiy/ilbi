import pytest
from rest_framework.test import APIClient

from tests.factories import EmployeeFactory, OwnerFactory, TenantFactory

pytestmark = pytest.mark.django_db


def test_current_tenant_api_requires_selection_for_multi_tenant_owner():
    owner = OwnerFactory()
    first = TenantFactory(owner=owner)
    second = TenantFactory(owner=owner)
    EmployeeFactory(user=owner, tenant=first, is_owner=True)
    EmployeeFactory(user=owner, tenant=second, is_owner=True)
    client = APIClient()
    client.force_authenticate(owner)

    missing = client.get("/api/v1/tenants/current/")
    selected = client.get(
        "/api/v1/tenants/current/", HTTP_X_TENANT_ID=str(second.id)
    )

    assert missing.status_code == 400
    assert selected.status_code == 200
    assert selected.data["id"] == second.id


def test_current_tenant_api_rejects_foreign_tenant_selection():
    owner = OwnerFactory()
    owned = TenantFactory(owner=owner)
    EmployeeFactory(user=owner, tenant=owned, is_owner=True)
    foreign = TenantFactory()
    client = APIClient()
    client.force_authenticate(owner)

    response = client.get(
        "/api/v1/tenants/current/", HTTP_X_TENANT_ID=str(foreign.id)
    )

    assert response.status_code == 403
