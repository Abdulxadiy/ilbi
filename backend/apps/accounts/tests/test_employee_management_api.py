"""Directory controls must preserve history and enforce tenant/account authority."""

import json

import pytest
from django.core import mail
from rest_framework.test import APIClient

from api.v1.accounts.views.misc import issue_tokens
from apps.accounts.models import Employee, User
from apps.accounts.services import login_throttle, login_ticket_service, password_reset_service
from apps.core.models import AuditAction, AuditLog
from apps.permissions.models import Permission
from tests.factories import EmployeeFactory, SaleFactory, StaffFactory, TenantFactory

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def clean_test_redis():
    password_reset_service.redis_client.flushdb()
    yield
    password_reset_service.redis_client.flushdb()


@pytest.fixture
def member(tenant):
    return EmployeeFactory(
        tenant=tenant, user=StaffFactory(email="worker@example.invalid", password="Test-secret-123"),
    )


def client_for(user, tenant=None):
    client = APIClient()
    client.force_authenticate(user=user)
    if tenant:
        client.credentials(HTTP_X_TENANT_ID=str(tenant.pk))
    return client


def url(member, action=""):
    return f"/api/v1/tenants/{member.tenant_id}/employees/{member.pk}/{action}"


def test_admin_resends_owner_invitation_with_real_cooldown(platform_admin, owner, tenant):
    owner.email = "owner@example.invalid"
    owner.save(update_fields=["email"])
    employment = Employee.objects.get(user=owner, tenant=tenant)
    client = client_for(platform_admin)

    response = client.post(url(employment, "resend-invite/"))
    assert response.status_code == 200
    assert response.data["sent"] is True
    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == [owner.email]
    assert "faollashtiring" in mail.outbox[0].subject
    assert client.post(url(employment, "resend-invite/")).status_code == 429
    assert len(mail.outbox) == 1
    assert AuditLog.objects.filter(action=AuditAction.EMPLOYEE_INVITE, tenant=tenant).count() == 2


def test_failed_invitation_is_reported_without_consuming_cooldown(platform_admin, member, monkeypatch):
    monkeypatch.setattr(password_reset_service, "send_password_reset_email", lambda *args, **kwargs: False)
    response = client_for(platform_admin).post(url(member, "resend-invite/"))
    assert response.status_code == 502
    assert response.data["sent"] is False
    assert not password_reset_service.is_in_cooldown(member.user_id)


@pytest.mark.parametrize("action", ["resend-invite/", "account-status/", "restore/"])
def test_staff_cannot_manage_accounts(staff, tenant, member, action):
    EmployeeFactory(user=staff, tenant=tenant)
    response = client_for(staff, tenant).post(url(member, action), {"blocked": True, "reason": "Test"})
    assert response.status_code == 403


def test_owner_cannot_manage_foreign_tenant_or_own_owner_account(owner, tenant, member):
    client = client_for(owner, tenant)
    foreign = EmployeeFactory()
    assert client.patch(url(foreign), {"first_name": "Changed"}).status_code == 403
    own_membership = Employee.objects.get(user=owner, tenant=tenant)
    assert client.post(url(own_membership, "account-status/"), {"blocked": True, "reason": "Test"}).status_code == 403
    assert client.patch(url(own_membership), {"email": "changed@example.invalid"}).status_code == 403
    # Employee IDs may never be used under a different tenant path.
    wrong_path = f"/api/v1/tenants/{tenant.pk}/employees/{foreign.pk}/"
    assert client.patch(wrong_path, {"first_name": "Changed"}).status_code == 404


def test_owner_updates_staff_profile_and_cannot_promote_role(owner, tenant, member):
    client = client_for(owner, tenant)
    response = client.patch(url(member), {
        "first_name": "Ali", "position": "Omborchi", "contact_phone": "+998901234567",
    })
    assert response.status_code == 200
    assert response.data["first_name"] == "Ali"
    assert response.data["position"] == "Omborchi"
    assert client.patch(url(member), {"role": "platform_admin", "password": "bad"}).status_code == 400
    member.user.refresh_from_db()
    assert member.user.role == "staff"
    audit = AuditLog.objects.get(action=AuditAction.EMPLOYEE_UPDATE)
    assert audit.changes == {"fields": ["contact_phone", "first_name", "position"]}


def test_admin_can_edit_owner_even_when_tenant_suspended(platform_admin, owner, tenant):
    tenant.is_active = False
    tenant.save(update_fields=["is_active"])
    employment = Employee.objects.get(user=owner, tenant=tenant)
    response = client_for(platform_admin).patch(url(employment), {"first_name": "Owner name"})
    assert response.status_code == 200
    owner.refresh_from_db()
    assert owner.first_name == "Owner name"


def test_email_change_revokes_links_tickets_and_jwt_but_keeps_other_accounts(platform_admin, member):
    user = member.user
    tokens = issue_tokens(user)
    ticket = login_ticket_service.create_ticket(user)
    token = password_reset_service.generate_reset_token()
    password_reset_service.store_reset_token(token, user.pk)
    legacy = "legacy-directory-token"
    password_reset_service.redis_client.set(
        password_reset_service._legacy_token_key(legacy), json.dumps({"user_id": user.pk}), ex=86400,
    )
    other = EmployeeFactory(user=StaffFactory(email="other@example.invalid"))
    other_token = password_reset_service.generate_reset_token()
    password_reset_service.store_reset_token(other_token, other.user_id)

    response = client_for(platform_admin).patch(url(member), {"email": "new-address@example.invalid"})
    assert response.status_code == 200
    assert password_reset_service.peek_reset_token(token) is None
    assert password_reset_service.peek_reset_token(legacy) is None
    assert password_reset_service.confirm_password_reset(token, "New-secret-123")[0] is False
    assert login_ticket_service.resolve_ticket(ticket) is None
    assert password_reset_service.peek_reset_token(other_token) is not None
    authenticated = APIClient()
    authenticated.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    assert authenticated.get("/api/v1/auth/me/").status_code == 401
    audit = AuditLog.objects.get(action=AuditAction.EMPLOYEE_UPDATE)
    assert audit.changes == {"fields": ["email"]}
    assert "new-address" not in json.dumps(audit.changes)


def test_block_and_unblock_revoke_credentials_without_firing(owner, tenant, member):
    client = client_for(owner, tenant)
    user = member.user
    original_version = user.token_version
    ticket = login_ticket_service.create_ticket(user)
    token = password_reset_service.generate_reset_token()
    password_reset_service.store_reset_token(token, user.pk, purpose="new_employee")
    response = client.post(url(member, "account-status/"), {"blocked": True, "reason": "Suspended access"})
    assert response.status_code == 200
    user.refresh_from_db()
    member.refresh_from_db()
    assert user.is_active is False
    assert user.token_version == original_version + 1
    assert member.is_active is True
    assert password_reset_service.peek_reset_token(token) is None
    assert login_ticket_service.resolve_ticket(ticket) is None
    assert client.post(url(member, "resend-invite/")).status_code == 403
    login_throttle.redis_client.set(login_throttle._lock_key(user.username), "1", ex=100)
    response = client.post(url(member, "account-status/"), {"blocked": False, "reason": "Access restored"})
    assert response.status_code == 200
    user.refresh_from_db()
    assert user.is_active is True
    assert user.token_version == original_version + 2
    assert login_throttle.is_locked(user.username)[0] is False
    assert login_ticket_service.resolve_ticket(ticket) is None


def test_admin_block_of_multitenant_owner_is_global_and_archive_is_protected(platform_admin, owner, tenant):
    second = TenantFactory(owner=owner)
    EmployeeFactory(user=owner, tenant=second, is_owner=True)
    employment = Employee.objects.get(user=owner, tenant=tenant)
    client = client_for(platform_admin)
    response = client.post(url(employment, "account-status/"), {"blocked": True, "reason": "Security hold"})
    assert response.status_code == 200
    assert owner.employments.filter(is_active=True).count() == 2
    assert client.delete(url(employment), {"reason": "Delete"}, format="json").status_code == 403
    employment.refresh_from_db()
    assert employment.archived_at is None
    tenant.refresh_from_db()
    assert tenant.owner_id == owner.pk


def test_archive_preserves_user_sale_and_audit_restore_does_not_rehire(owner, tenant, member):
    sale = SaleFactory(tenant=tenant, sold_by=member.user, total_amount="10000.00")
    client = client_for(owner, tenant)
    response = client.delete(url(member), {"reason": "Left team"}, format="json")
    assert response.status_code == 200
    member.refresh_from_db()
    member.user.refresh_from_db()
    assert member.archived_at is not None and member.is_active is False
    assert not member.user.has_usable_password()
    assert User.objects.filter(pk=member.user_id).exists()
    sale.refresh_from_db()
    assert sale.sold_by_id == member.user_id and sale.total_amount == 10000
    directory = f"/api/v1/tenants/{tenant.pk}/employees/"
    assert client.get(directory).data["count"] == 1
    archived = client.get(directory, {"archived": "true"})
    assert archived.data["count"] == 1
    assert archived.data["results"][0]["actions"]["restore"] is True
    assert client.post(url(member, "restore/"), {"reason": "Review history"}).status_code == 200
    member.refresh_from_db()
    assert member.archived_at is None and member.is_active is False
    assert AuditLog.objects.filter(action=AuditAction.EMPLOYEE_ARCHIVE).exists()
    assert AuditLog.objects.filter(action=AuditAction.EMPLOYEE_RESTORE).exists()


def test_former_employer_cannot_edit_or_block_staff_now_working_elsewhere(owner, tenant):
    user = StaffFactory(password="Original-secret-123")
    former = EmployeeFactory(user=user, tenant=tenant, is_active=False)
    current = EmployeeFactory(user=user)
    client = client_for(owner, tenant)
    assert client.patch(url(former), {"email": "takeover@example.invalid"}).status_code == 403
    assert client.post(url(former, "account-status/"), {"blocked": True, "reason": "Wrong tenant"}).status_code == 403
    assert client.delete(url(former), {"reason": "Archive old record"}, format="json").status_code == 200
    user.refresh_from_db()
    current.refresh_from_db()
    assert user.check_password("Original-secret-123") and user.is_active
    assert current.is_active


def test_action_reasons_are_required_and_duplicate_email_is_rejected(platform_admin, member):
    other = StaffFactory(email="taken@example.invalid")
    client = client_for(platform_admin)
    assert client.post(url(member, "account-status/"), {"blocked": True}).status_code == 400
    assert client.delete(url(member), {}, format="json").status_code == 400
    assert client.patch(url(member), {"email": other.email}).status_code == 400


def test_permission_editor_excludes_owner_only_and_allows_debt_entry(owner, tenant, member):
    forbidden, _ = Permission.objects.get_or_create(
        category="employees", codename="hire_employee", defaults={"name": "Hire"},
    )
    assignable, _ = Permission.objects.get_or_create(
        category="sales", codename="record_debt_payment", defaults={"name": "Debt entry"},
    )
    client = client_for(owner, tenant)
    choices = client.get(f"/api/v1/tenants/{tenant.pk}/employees/permissions/")
    assert choices.status_code == 200
    assert forbidden.pk not in {row["id"] for row in choices.data}
    assert assignable.pk in {row["id"] for row in choices.data}
    assert client.patch(url(member), {"permission_ids": [forbidden.pk]}, format="json").status_code == 400
    response = client.patch(url(member), {"permission_ids": [assignable.pk]}, format="json")
    assert response.status_code == 200
    assert response.data["permission_ids"] == [assignable.pk]
    assert member.permissions.filter(pk=assignable.pk).exists()
    hire = client.post(
        f"/api/v1/tenants/{tenant.pk}/employees/hire/",
        {"phone_number": "+998909999999", "permission_ids": [forbidden.pk]}, format="json",
    )
    assert hire.status_code == 400


def test_missing_email_blocks_resend_but_edit_enables_it(platform_admin, member):
    member.user.email = ""
    member.user.save(update_fields=["email"])
    client = client_for(platform_admin)
    assert client.post(url(member, "resend-invite/")).status_code == 403
    updated = client.patch(url(member), {"email": "fixed@example.invalid"})
    assert updated.status_code == 200
    assert updated.data["actions"]["invite"] is True
