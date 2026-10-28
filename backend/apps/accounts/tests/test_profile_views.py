import pytest
from rest_framework import status
from rest_framework.test import APIClient
from apps.accounts.models import User, Employee
from tests.factories import PlatformAdminFactory, OwnerFactory, StaffFactory, TenantFactory
from api.v1.tenants.serializers import TenantAdminSerializer, TenantOwnerSerializer
from api.v1.accounts.serializers import EmployeeOutputSerializer


pytestmark = pytest.mark.django_db


def test_user_profile_get_unauthenticated():
    client = APIClient()
    response = client.get("/api/v1/auth/profile/")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


def test_user_profile_get_authenticated():
    user = StaffFactory(contact_phone="+998901234567")
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.get("/api/v1/auth/profile/")
    assert response.status_code == status.HTTP_200_OK
    assert response.data["phone_number"] == user.phone_number
    assert response.data["contact_phone"] == "+998901234567"
    assert response.data["id"] == user.id


def test_user_profile_patch_contact_phone_normalized():
    user = StaffFactory(contact_phone=None)
    client = APIClient()
    client.force_authenticate(user=user)

    payload = {
        "first_name": "Alisher",
        "last_name": "Navoiy",
        "contact_phone": "+998 90 999-88-77",
    }
    response = client.patch("/api/v1/auth/profile/", data=payload)
    assert response.status_code == status.HTTP_200_OK
    assert response.data["contact_phone"] == "+998909998877"

    user.refresh_from_db()
    assert user.contact_phone == "+998909998877"
    assert user.first_name == "Alisher"
    assert user.last_name == "Navoiy"
    assert user.profile_completed is True


def test_user_profile_patch_clear_contact_phone():
    user = StaffFactory(contact_phone="+998901112233")
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.patch("/api/v1/auth/profile/", data={"contact_phone": ""})
    assert response.status_code == status.HTTP_200_OK
    assert response.data["contact_phone"] is None

    user.refresh_from_db()
    assert user.contact_phone is None


def test_complete_profile_post_with_contact_phone():
    user = StaffFactory(profile_completed=False, contact_phone=None)
    client = APIClient()
    client.force_authenticate(user=user)

    payload = {
        "first_name": "Bobur",
        "last_name": "Mirzo",
        "email": "bobur@example.com",
        "contact_phone": "+998 97 123 45 67",
        "date_of_birth": "1990-02-14",
    }
    response = client.post("/api/v1/auth/complete-profile/", data=payload)
    assert response.status_code == status.HTTP_200_OK

    user.refresh_from_db()
    assert user.profile_completed is True
    assert user.contact_phone == "+998971234567"
    assert user.first_name == "Bobur"
    assert user.email == "bobur@example.com"


def test_contact_phone_allows_duplicates():
    # Multiple users can have the same contact_phone or None
    user1 = StaffFactory(contact_phone="+998901234567")
    user2 = StaffFactory(contact_phone="+998901234567")
    user3 = StaffFactory(contact_phone=None)
    user4 = StaffFactory(contact_phone=None)

    assert user1.contact_phone == user2.contact_phone
    assert user3.contact_phone is None
    assert user4.contact_phone is None


def test_tenant_serializers_include_owner_contact_phone():
    owner = OwnerFactory(contact_phone="+998909876543")
    tenant = TenantFactory(owner=owner)

    admin_data = TenantAdminSerializer(tenant).data
    assert "contact_phone" in admin_data["owner_details"]
    assert admin_data["owner_details"]["contact_phone"] == "+998909876543"

    owner_data = TenantOwnerSerializer(tenant).data
    assert "contact_phone" in owner_data["owner_details"]
    assert owner_data["owner_details"]["contact_phone"] == "+998909876543"


def test_employee_output_serializer_includes_contact_phone():
    user = StaffFactory(contact_phone="+998903334455")
    tenant = TenantFactory()
    employee = Employee.objects.create(
        user=user,
        tenant=tenant,
        position="Kassir",
    )

    data = EmployeeOutputSerializer(employee).data
    assert data["phone_number"] == user.phone_number
    assert data["contact_phone"] == "+998903334455"
