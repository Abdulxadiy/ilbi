"""Platform operator queue and tenant-retention API checks."""

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.tenants.models import SellerProfile, Tenant
from tests.factories import OwnerFactory, PlatformAdminFactory, TenantFactory

pytestmark = pytest.mark.django_db
QUEUE_URL = "/api/v1/tenants/seller-profiles/review/"


def _profile(owner, number):
    return SellerProfile.objects.create(
        owner=owner,
        legal_form=SellerProfile.LEGAL_FORM_YTT,
        official_name=f"Operator review {number:02d}",
        tax_identifier=f"9900000{number:03d}",
        permitted_activity="Retail",
        status=SellerProfile.STATUS_PENDING,
        submitted_at=timezone.now() + timedelta(seconds=number),
    )


def test_review_queue_is_admin_only_and_masks_identifiers():
    owner = OwnerFactory(first_name="Ali", last_name="Valiyev")
    pending = _profile(owner, 1)
    TenantFactory(owner=owner, seller_profile=pending)
    approved = _profile(owner, 2)
    approved.status = SellerProfile.STATUS_APPROVED
    approved.save(update_fields=["status"])

    client = APIClient()
    assert client.get(QUEUE_URL).status_code == 401
    client.force_authenticate(user=owner)
    assert client.get(QUEUE_URL).status_code == 403

    client.force_authenticate(user=PlatformAdminFactory())
    response = client.get(QUEUE_URL)
    assert response.status_code == 200
    assert response.data["count"] == 1
    row = response.data["results"][0]
    assert row["id"] == pending.id
    assert row["owner_id"] == owner.id
    assert row["owner_name"] == "Ali Valiyev"
    assert row["tenant_count"] == 1
    assert row["tax_identifier_masked"] == "••••0001"
    assert "tax_identifier" not in row
    assert "phone_number" not in row
    assert "email" not in row
    assert "9900000001" not in str(response.data)

    all_statuses = client.get(QUEUE_URL, {"status": "all"})
    assert all_statuses.status_code == 200
    assert {row["id"] for row in all_statuses.data["results"]} == {pending.id, approved.id}
    assert client.get(QUEUE_URL, {"status": "invalid"}).status_code == 400
    assert client.get(QUEUE_URL, {"q": "x" * 101}).status_code == 400
    assert client.get(QUEUE_URL, {"q": "9" * 100}).status_code == 200


def test_review_queue_pagination_and_search():
    owner = OwnerFactory()
    profiles = [_profile(owner, number) for number in range(1, 24)]
    client = APIClient()
    client.force_authenticate(user=PlatformAdminFactory())

    first = client.get(QUEUE_URL)
    second = client.get(QUEUE_URL, {"page": 2})
    assert first.status_code == second.status_code == 200
    assert first.data["count"] == 23
    assert len(first.data["results"]) == 20
    assert len(second.data["results"]) == 3
    assert [row["id"] for row in first.data["results"]] == [p.id for p in profiles[:20]]
    assert [row["id"] for row in second.data["results"]] == [p.id for p in profiles[20:]]

    searched = client.get(QUEUE_URL, {"q": "review 23"})
    assert searched.status_code == 200
    assert searched.data["count"] == 1
    assert searched.data["results"][0]["id"] == profiles[-1].id


def test_platform_admin_cannot_delete_tenant():
    tenant = TenantFactory()
    client = APIClient()
    client.force_authenticate(user=PlatformAdminFactory())

    response = client.delete(f"/api/v1/tenants/{tenant.id}/")

    assert response.status_code == 405
    assert "to‘xtating" in response.data["detail"]
    assert Tenant.objects.filter(pk=tenant.pk).exists()
