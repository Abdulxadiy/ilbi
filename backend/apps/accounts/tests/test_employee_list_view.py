"""The employee directory must show real, tenant-scoped memberships."""

from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Employee, User
from tests.factories import StaffFactory, TenantFactory


pytestmark = pytest.mark.django_db


def url(tenant):
    return f"/api/v1/tenants/{tenant.id}/employees/"


def test_admin_sees_all_employees_across_pages_but_only_selected_tenant(
    platform_admin, tenant
):
    other_tenant = TenantFactory()
    other_staff = StaffFactory()
    Employee.objects.create(user=other_staff, tenant=other_tenant, position="Other")
    for number in range(51):
        worker = StaffFactory(first_name=f"Worker {number}")
        Employee.objects.create(user=worker, tenant=tenant, position="Kassir")

    client = APIClient()
    client.force_authenticate(user=platform_admin)
    first = client.get(url(tenant), {"page_size": 50})
    second = client.get(url(tenant), {"page_size": 50, "page": 2})

    assert first.status_code == 200
    assert first.data["count"] == 52  # 51 workers and the tenant owner
    assert len(first.data["results"]) == 50
    assert len(second.data["results"]) == 2
    assert all(row["tenant"] == tenant.id for row in first.data["results"] + second.data["results"])
    assert other_staff.id not in {row["user"] for row in first.data["results"] + second.data["results"]}
    assert platform_admin.id not in {row["user"] for row in first.data["results"] + second.data["results"]}


def test_owner_can_search_own_team_but_cannot_read_other_tenant(owner, tenant):
    worker = StaffFactory(first_name="Dilshod", last_name="Karimov")
    Employee.objects.create(user=worker, tenant=tenant, position="Omborchi")
    other_tenant = TenantFactory()
    client = APIClient()
    client.force_authenticate(user=owner)
    client.credentials(HTTP_X_TENANT_ID=str(tenant.id))

    response = client.get(url(tenant), {"search": "Dilshod"})
    assert response.status_code == 200
    assert response.data["count"] == 1
    assert response.data["results"][0]["first_name"] == "Dilshod"
    assert response.data["results"][0]["position"] == "Omborchi"
    assert response.data["results"][0]["phone_number"] == worker.phone_number
    assert client.get(url(other_tenant)).status_code == 403


def test_staff_cannot_read_team_directory(staff, tenant):
    Employee.objects.create(user=staff, tenant=tenant, position="Kassir")
    client = APIClient()
    client.force_authenticate(user=staff)
    assert client.get(url(tenant)).status_code == 403


def test_admin_can_review_inactive_and_suspended_tenant(platform_admin, tenant):
    worker = StaffFactory()
    Employee.objects.create(user=worker, tenant=tenant, is_active=False, position="Former")
    tenant.is_active = False
    tenant.save(update_fields=["is_active"])
    client = APIClient()
    client.force_authenticate(user=platform_admin)
    response = client.get(url(tenant), {"active": "false"})
    assert response.status_code == 200
    assert response.data["count"] == 1
    assert response.data["results"][0]["user"] == worker.id


def test_new_hire_saves_name_email_and_has_unusable_password_for_invitation(
    owner, tenant
):
    client = APIClient()
    client.force_authenticate(user=owner)
    client.credentials(HTTP_X_TENANT_ID=str(tenant.id))
    with patch("apps.accounts.services.password_reset_service.request_password_reset_for_user", return_value=(True, "sent")) as invite:
        response = client.post(
            f"{url(tenant)}hire/",
            {
                "phone_number": "+998901234567",
                "email": "new.worker@example.invalid",
                "first_name": "Yangi",
                "last_name": "Xodim",
                "position": "Kassir",
            },
        )
    assert response.status_code == 201
    worker = User.objects.get(phone_number="+998901234567")
    assert worker.first_name == "Yangi"
    assert worker.last_name == "Xodim"
    assert worker.email == "new.worker@example.invalid"
    assert not worker.has_usable_password()
    assert response.data["onboarding_invitation"] == {"sent": True, "reason": "sent"}
    invite.assert_called_once()
