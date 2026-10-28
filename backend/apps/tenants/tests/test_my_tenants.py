import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from apps.accounts.models import Employee
from apps.tenants.models import Tenant
from apps.tenants.services import TenantService, TenantServiceError
from tests.factories import EmployeeFactory, OwnerFactory, StaffFactory, TenantFactory

pytestmark = pytest.mark.django_db


def test_owner_can_list_only_their_active_tenants():
    owner = OwnerFactory()
    first = TenantFactory(owner=owner)
    second = TenantFactory(owner=owner)
    EmployeeFactory(user=owner, tenant=first, is_owner=True)
    EmployeeFactory(user=owner, tenant=second, is_owner=True)
    foreign = TenantFactory()

    client = APIClient()
    client.force_authenticate(owner)
    response = client.get("/api/v1/tenants/my/")

    assert response.status_code == 200
    assert {row["id"] for row in response.data} == {first.id, second.id}
    assert foreign.id not in {row["id"] for row in response.data}


def test_owner_can_create_another_isolated_tenant():
    owner = OwnerFactory()
    source = TenantFactory(owner=owner, receipt_header="Source receipt")
    EmployeeFactory(user=owner, tenant=source, is_owner=True)

    client = APIClient()
    client.force_authenticate(owner)
    response = client.post(
        "/api/v1/tenants/my/",
        {"name": "New shop", "address": "Toshkent", "copy_settings_from": source.id},
        format="json",
    )

    assert response.status_code == 201
    created = Tenant.objects.get(pk=response.data["id"])
    assert created.owner_id == owner.id
    assert created.address == "Toshkent"
    assert created.receipt_header == "Source receipt"
    assert created.seller_profile_id == source.seller_profile_id
    assert Employee.objects.filter(
        user=owner, tenant=created, is_owner=True, is_active=True
    ).exists()


def test_create_for_existing_owner_auto_binds_approved_seller_profile():
    owner = OwnerFactory()
    source = TenantFactory(owner=owner)
    EmployeeFactory(user=owner, tenant=source, is_owner=True)

    new_tenant = TenantService.create_for_existing_owner(owner=owner, name="Auto profile shop")
    assert new_tenant.seller_profile_id == source.seller_profile_id


def test_staff_cannot_create_an_owned_tenant():
    staff = StaffFactory()
    tenant = TenantFactory()
    EmployeeFactory(user=staff, tenant=tenant, is_owner=False)

    client = APIClient()
    client.force_authenticate(staff)
    response = client.post("/api/v1/tenants/my/", {"name": "Other"}, format="json")

    assert response.status_code == 403


def test_owner_endpoint_rejects_owner_assignment_fields():
    owner = OwnerFactory()
    tenant = TenantFactory(owner=owner)
    EmployeeFactory(user=owner, tenant=tenant, is_owner=True)

    client = APIClient()
    client.force_authenticate(owner)
    response = client.post(
        "/api/v1/tenants/my/",
        {"name": "Other", "owner_id": owner.id},
        format="json",
    )

    assert response.status_code == 400
    assert not Tenant.objects.filter(name="Other").exists()


def test_create_for_existing_owner_rejects_cross_owner_settings_copy():
    owner = OwnerFactory()
    own_tenant = TenantFactory(owner=owner)
    EmployeeFactory(user=owner, tenant=own_tenant, is_owner=True)
    another_tenant = TenantFactory()

    with pytest.raises(TenantServiceError, match="o‘zingizga tegishli"):
        TenantService.create_for_existing_owner(
            owner=owner, name="Other", copy_settings_from=another_tenant.id
        )


@override_settings(MAX_TENANTS_PER_OWNER=1)
def test_create_for_existing_owner_enforces_tenant_limit():
    owner = OwnerFactory()
    tenant = TenantFactory(owner=owner)
    EmployeeFactory(user=owner, tenant=tenant, is_owner=True)

    with pytest.raises(TenantServiceError, match="chegarasiga"):
        TenantService.create_for_existing_owner(owner=owner, name="Over limit")


def test_create_my_tenant_is_rate_limited():
    owner = OwnerFactory()
    tenant = TenantFactory(owner=owner)
    EmployeeFactory(user=owner, tenant=tenant, is_owner=True)
    client = APIClient()
    client.force_authenticate(owner)

    responses = [
        client.post(
            "/api/v1/tenants/my/", {"name": f"Shop {index}"}, format="json"
        )
        for index in range(6)
    ]

    assert [response.status_code for response in responses[:5]] == [201] * 5
    assert responses[5].status_code == 429
