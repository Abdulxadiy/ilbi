import pytest
from rest_framework.test import APIClient

from apps.tenants.models import SellerProfile, Tenant
from tests.factories import EmployeeFactory, OwnerFactory, PlatformAdminFactory, TenantFactory

pytestmark = pytest.mark.django_db


def profile_payload(identifier="123456789"):
    return {
        "legal_form": "ytt",
        "official_name": "Example Seller",
        "tax_identifier": identifier,
        "tax_regime": "",
        "permitted_activity": "Retail",
        "fiscal_provider": "",
    }


def test_owner_can_create_multiple_profiles_and_identifier_is_masked():
    owner = OwnerFactory()
    tenant = TenantFactory(owner=owner)
    initial_profile_count = SellerProfile.objects.filter(owner=owner).count()
    EmployeeFactory(user=owner, tenant=tenant, is_owner=True)
    client = APIClient()
    client.force_authenticate(owner)

    first = client.post("/api/v1/tenants/seller-profiles/", profile_payload(), format="json")
    second = client.post(
        "/api/v1/tenants/seller-profiles/", profile_payload("987654321"), format="json"
    )

    assert first.status_code == second.status_code == 201
    assert first.data["tax_identifier_masked"] == "••••6789"
    assert "tax_identifier" not in first.data
    assert SellerProfile.objects.filter(owner=owner).count() == initial_profile_count + 2


def test_tenant_can_only_be_bound_to_owners_own_seller_profile():
    owner = OwnerFactory()
    tenant = TenantFactory(owner=owner)
    EmployeeFactory(user=owner, tenant=tenant, is_owner=True)
    own_profile = SellerProfile.objects.create(
        owner=owner, **profile_payload()
    )
    other_profile = SellerProfile.objects.create(
        owner=OwnerFactory(), **profile_payload("987654321")
    )
    client = APIClient()
    client.force_authenticate(owner)

    rejected = client.post(
        "/api/v1/tenants/my/", {"name": "Foreign bind", "seller_profile": other_profile.id}, format="json"
    )
    accepted = client.post(
        "/api/v1/tenants/my/", {"name": "Bound shop", "seller_profile": own_profile.id}, format="json"
    )

    assert rejected.status_code == 400
    assert accepted.status_code == 201
    assert Tenant.objects.get(pk=accepted.data["id"]).seller_profile_id == own_profile.id


def test_owner_can_view_only_own_seller_profiles():
    owner = OwnerFactory()
    tenant = TenantFactory(owner=owner)
    default_profile = tenant.seller_profile
    EmployeeFactory(user=owner, tenant=tenant, is_owner=True)
    own = SellerProfile.objects.create(owner=owner, **profile_payload())
    SellerProfile.objects.create(owner=OwnerFactory(), **profile_payload("987654321"))
    client = APIClient()
    client.force_authenticate(owner)

    response = client.get("/api/v1/tenants/seller-profiles/")

    assert response.status_code == 200
    assert {row["id"] for row in response.data} == {own.id, default_profile.id}


def test_only_platform_admin_can_approve_seller_profile():
    owner = OwnerFactory()
    profile = SellerProfile.objects.create(owner=owner, **profile_payload())
    admin = PlatformAdminFactory()
    client = APIClient()
    client.force_authenticate(admin)

    response = client.post(
        f"/api/v1/tenants/seller-profiles/{profile.id}/review/",
        {"status": "approved", "expires_at": "2027-10-12T00:00:00Z"},
        format="json",
    )

    assert response.status_code == 200
    profile.refresh_from_db()
    assert profile.status == SellerProfile.STATUS_APPROVED
    assert profile.reviewed_by_id == admin.id


def test_existing_tenant_profile_binding_is_owner_scoped_and_audited():
    from apps.core.models import AuditAction, AuditLog

    owner = OwnerFactory()
    tenant = TenantFactory(owner=owner)
    EmployeeFactory(user=owner, tenant=tenant, is_owner=True)
    own_profile = SellerProfile.objects.create(owner=owner, **profile_payload())
    foreign_profile = SellerProfile.objects.create(
        owner=OwnerFactory(), **profile_payload("987654321")
    )
    client = APIClient()
    client.force_authenticate(owner)

    rejected = client.patch(
        f"/api/v1/tenants/my/{tenant.id}/seller-profile/",
        {"seller_profile_id": foreign_profile.id}, format="json",
    )
    accepted = client.patch(
        f"/api/v1/tenants/my/{tenant.id}/seller-profile/",
        {"seller_profile_id": own_profile.id}, format="json",
    )

    assert rejected.status_code == 400
    assert accepted.status_code == 200
    tenant.refresh_from_db()
    assert tenant.seller_profile_id == own_profile.id
    assert AuditLog.objects.filter(
        tenant=tenant, action=AuditAction.SELLER_PROFILE_BINDING
    ).exists()
