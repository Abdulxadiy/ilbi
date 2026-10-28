"""Password-only tickets must never authenticate private application endpoints."""

import pytest
from rest_framework.test import APIClient

from tests.factories import UserFactory


@pytest.mark.django_db
@pytest.mark.parametrize("role", ["platform_admin", "owner", "staff"])
def test_password_ticket_cannot_open_private_application_or_support(role):
    user = UserFactory(role=role, username=f"boundary_{role}")
    user.set_password("isolated-password-boundary-2026")
    user.save(update_fields=["password"])
    client = APIClient()
    response = client.post(
        "/api/v1/auth/admin-login/",
        {"username": user.username, "password": "isolated-password-boundary-2026"},
        format="json",
    )
    assert response.status_code == 200
    assert "access" not in response.data and "refresh" not in response.data
    ticket = response.data["login_ticket"]
    for credential in (None, f"Bearer {ticket}"):
        client.credentials(**({"HTTP_AUTHORIZATION": credential} if credential else {}))
        for path in (
            "/api/v1/auth/me/",
            "/api/v1/support/conversations/",
            "/api/v1/support/inbox/",
            "/api/v1/platform/accounts/",
            "/api/v1/catalog/variants/",
        ):
            assert client.get(path).status_code == 401
