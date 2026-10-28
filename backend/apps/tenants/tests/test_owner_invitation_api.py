"""Tenant invitations report delivery failures and can be retried safely."""

import json
import socket
from unittest.mock import patch

import pytest
from django.core import mail
from rest_framework.test import APIClient

from apps.accounts.services.password_reset_service import _token_key, is_in_cooldown, redis_client
from apps.tenants.models import Tenant
from tests.factories import OwnerFactory

pytestmark = pytest.mark.django_db


def _admin_client(platform_admin):
    client = APIClient()
    client.force_authenticate(user=platform_admin)
    return client


def test_create_reports_delivery_success_after_tenant_commit(platform_admin):
    client = _admin_client(platform_admin)
    response = client.post(
        "/api/v1/tenants/",
        {
            "name": "Invitation Success Shop",
            "owner_phone_number": "+998907612340",
            "owner_email": "new-owner@example.com",
        },
    )

    assert response.status_code == 201
    assert response.data["owner_invitation"] == {"status": "sent"}
    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == ["new-owner@example.com"]
    assert "setup-account?token=" in mail.outbox[0].body
    assert Tenant.objects.filter(pk=response.data["id"]).exists()


def test_failed_smtp_preserves_tenant_and_resend_succeeds(platform_admin):
    client = _admin_client(platform_admin)
    with patch("apps.accounts.services.password_reset_service.send_mail", side_effect=socket.gaierror):
        created = client.post(
            "/api/v1/tenants/",
            {
                "name": "Invitation Retry Shop",
                "owner_phone_number": "+998907612341",
                "owner_email": "retry-owner@example.com",
            },
        )

    assert created.status_code == 201
    assert created.data["owner_invitation"] == {"status": "failed"}
    tenant = Tenant.objects.get(pk=created.data["id"])
    assert tenant.owner.email == "retry-owner@example.com"
    assert not is_in_cooldown(tenant.owner_id)
    assert len(mail.outbox) == 0

    resent = client.post(f"/api/v1/tenants/{tenant.pk}/resend-owner-invite/")
    assert resent.status_code == 200
    assert resent.data == {"owner_invitation": {"status": "sent"}}
    assert mail.outbox[0].to == ["retry-owner@example.com"]

    throttled = client.post(f"/api/v1/tenants/{tenant.pk}/resend-owner-invite/")
    assert throttled.status_code == 200
    assert throttled.data == {"owner_invitation": {"status": "cooldown"}}
    assert len(mail.outbox) == 1


def test_zero_accepted_messages_is_failure_and_clears_cooldown(platform_admin):
    client = _admin_client(platform_admin)
    with patch("apps.accounts.services.password_reset_service.send_mail", return_value=0):
        created = client.post(
            "/api/v1/tenants/",
            {
                "name": "Zero Accepted Shop",
                "owner_phone_number": "+998907612342",
                "owner_email": "zero-owner@example.com",
            },
        )

    assert created.status_code == 201
    assert created.data["owner_invitation"] == {"status": "failed"}
    assert not is_in_cooldown(created.data["owner"])


def test_resend_requires_platform_admin(owner, tenant):
    client = APIClient()
    url = f"/api/v1/tenants/{tenant.pk}/resend-owner-invite/"
    assert client.post(url).status_code == 401
    client.force_authenticate(user=owner)
    assert client.post(url).status_code == 403


def test_existing_owner_email_mismatch_is_rejected(platform_admin):
    existing = OwnerFactory(email="original@example.com")
    client = _admin_client(platform_admin)
    response = client.post(
        "/api/v1/tenants/",
        {
            "name": "Wrong Email Shop",
            "owner_phone_number": existing.phone_number,
            "owner_email": "different@example.com",
        },
    )

    assert response.status_code == 400
    assert "owner_email" in response.data
    assert not Tenant.objects.filter(name="Wrong Email Shop").exists()
    existing.refresh_from_db()
    assert existing.email == "original@example.com"
    assert len(mail.outbox) == 0


def test_invitation_targets_selected_owner_when_email_is_shared(platform_admin, tenant):
    tenant.owner.email = "shared@example.com"
    tenant.owner.save(update_fields=["email"])
    other = OwnerFactory(email="shared@example.com")
    client = _admin_client(platform_admin)

    created = client.post(
        "/api/v1/tenants/",
        {"name": "Shared Email Shop", "owner_id": other.pk},
    )

    assert created.status_code == 201
    assert created.data["owner_invitation"] == {"status": "sent"}
    token = mail.outbox[0].body.split("setup-account?token=", 1)[1].split()[0]
    payload = json.loads(redis_client.get(_token_key(token)))
    assert payload["user_id"] == other.pk
    assert payload["extra_context"]["tenant_name"] == "Shared Email Shop"
    assert created.data["owner"] == other.pk


def test_change_owner_reports_invitation_delivery(platform_admin, tenant):
    new_owner = OwnerFactory(email="transferred@example.com")
    client = _admin_client(platform_admin)

    changed = client.post(
        f"/api/v1/tenants/{tenant.pk}/change-owner/",
        {"new_owner_id": new_owner.pk},
    )

    assert changed.status_code == 200
    assert changed.data["owner_invitation"] == {"status": "sent"}
    assert changed.data["owner"] == new_owner.pk
    assert mail.outbox[0].to == ["transferred@example.com"]
