"""JWTs carry identity and role, while tenant context stays request-scoped."""

import pytest
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from api.v1.accounts.views.misc import issue_tokens
from tests.factories import UserFactory, TenantFactory, EmployeeFactory

pytestmark = pytest.mark.django_db


def assert_tenant_is_not_claimed(tokens, role):
    access = AccessToken(tokens["access"])
    refresh = RefreshToken(tokens["refresh"])
    for token in (access, refresh):
        assert token["role"] == role
        assert "tenant_id" not in token
        assert "terms_accepted" not in token


def test_staff_token_does_not_pin_a_tenant():
    tenant = TenantFactory()
    staff = UserFactory(role="staff")
    EmployeeFactory(user=staff, tenant=tenant, is_owner=False)

    assert_tenant_is_not_claimed(issue_tokens(staff), "staff")


def test_owner_token_can_be_used_with_multiple_selected_tenants():
    owner = UserFactory(role="owner")
    tenant_a = TenantFactory(owner=owner)
    tenant_b = TenantFactory(owner=owner)
    EmployeeFactory(user=owner, tenant=tenant_a, is_owner=True)
    EmployeeFactory(user=owner, tenant=tenant_b, is_owner=True)

    assert_tenant_is_not_claimed(issue_tokens(owner), "owner")


def test_platform_admin_token_does_not_claim_a_tenant():
    admin = UserFactory(role="platform_admin")

    assert_tenant_is_not_claimed(issue_tokens(admin), "platform_admin")
