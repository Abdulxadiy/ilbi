"""Actual employee response shapes consumed by the native directory.

Optional ILBI_MOBILE_TEAM_CONTRACT writes synthetic APIClient responses for the
mobile consumer tests. Mail uses settings_test's in-memory backend only.
"""

import json
import os
from pathlib import Path

import pytest
from django.core import mail
from rest_framework.test import APIClient

from apps.accounts.models import Employee
from apps.accounts.services import password_reset_service
from apps.permissions.constants import OWNER_ONLY_PERMISSIONS

pytestmark = pytest.mark.django_db


def test_native_team_workflow_contract(owner, tenant):
    password_reset_service.redis_client.flushdb()
    client = APIClient()
    client.force_authenticate(user=owner)
    client.credentials(HTTP_X_TENANT_ID=str(tenant.pk))
    base = f"/api/v1/tenants/{tenant.pk}/employees/"
    permission_response = client.get(base + "permissions/")
    assert permission_response.status_code == 200
    choices = permission_response.data
    assert not any(f"{row['category']}.{row['codename']}" in OWNER_ONLY_PERMISSIONS for row in choices)
    sale_permission = next(row["id"] for row in choices if row["category"] == "sales" and row["codename"] == "add_sale")
    hired = client.post(base + "hire/", {
        "phone_number": "+998991231234", "first_name": "Native", "last_name": "Contract",
        "email": "native-team@example.invalid", "position": "Kassir", "permission_ids": [sale_permission],
    }, format="json")
    assert hired.status_code == 201
    assert hired.data["is_active"] is True
    assert "actions" not in hired.data  # Hire/fire use the thin serializer.
    assert hired.data["onboarding_invitation"]["sent"] is True
    assert len(mail.outbox) == 1
    member_id, user_id = hired.data["id"], hired.data["user"]
    detail = base + f"{member_id}/"
    directory = client.get(base, {"search": "Native"})
    assert directory.status_code == 200
    assert directory.data["count"] == 1
    member = directory.data["results"][0]
    assert member["permission_ids"] == [sale_permission]
    assert member["actions"]["edit"] is True
    assert member["password_set"] is False
    edited = client.patch(detail, {"first_name": "Updated", "contact_phone": "+998991239999"}, format="json")
    assert edited.status_code == 200
    assert edited.data["phone_number"] == "+998991231234"
    assert edited.data["contact_phone"] == "+998991239999"
    assert edited.data["permission_ids"] == [sale_permission]
    blocked = client.post(detail + "account-status/", {"blocked": True, "reason": "Contract block"}, format="json")
    assert blocked.status_code == 200 and blocked.data["account_active"] is False
    unblocked = client.post(detail + "account-status/", {"blocked": False, "reason": "Contract unblock"}, format="json")
    assert unblocked.status_code == 200 and unblocked.data["account_active"] is True
    fired = client.post(base + "fire/", {"target_user_id": user_id}, format="json")
    assert fired.status_code == 200 and fired.data["is_active"] is False
    assert "actions" not in fired.data
    archived = client.delete(detail, {"reason": "Contract archive"}, format="json")
    assert archived.status_code == 200 and archived.data["archived_at"] is not None
    assert client.get(base, {"search": "Updated"}).data["count"] == 0
    assert client.get(base, {"archived": "true", "search": "Updated"}).data["count"] == 1
    restored = client.post(detail + "restore/", {"reason": "Contract restore"}, format="json")
    assert restored.status_code == 200 and restored.data["archived_at"] is None
    assert restored.data["is_active"] is False
    assert Employee.objects.get(pk=member_id).is_active is False
    contract = {
        "source": "Actual Django APIClient/PostgreSQL, synthetic accounts, locmem email; no native/provider acceptance",
        "tenant_id": tenant.pk, "choices": choices, "hired": hired.data, "directory": directory.data,
        "edited": edited.data, "blocked": blocked.data, "unblocked": unblocked.data,
        "fired": fired.data, "archived": archived.data, "restored": restored.data,
    }
    serialized = json.dumps(contract, default=str, ensure_ascii=False, indent=2)
    assert '"password":' not in serialized and '"login_ticket":' not in serialized
    target = os.environ.get("ILBI_MOBILE_TEAM_CONTRACT")
    if target:
        Path(target).write_text(serialized + "\n")
    password_reset_service.redis_client.flushdb()
