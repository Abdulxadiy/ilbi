"""
Place at: apps/tenants/tests/test_tenant_service.py
(convert apps/tenants/tests.py into a tests/ package the same way as accounts)

Covers TenantService.create_with_owner() and .change_owner(), which
together are the only supported way to create a Tenant with a valid
owner, or to swap a tenant's owner. Both methods are @transaction.atomic
and both delegate the actual role assignment to EmployeeService — so
these tests focus on TenantService's OWN validation (uniqueness,
platform_admin-only access) and on the atomic rollback guarantee, not on
re-testing EmployeeService's permission logic (that's already covered in
test_employee_service.py).
"""
import pytest

from apps.tenants.models import Tenant
from apps.tenants.services import TenantService, TenantServiceError
from apps.accounts.models import Employee
from tests.factories import (
    PlatformAdminFactory, OwnerFactory, UserFactory, TenantFactory, EmployeeFactory
)

pytestmark = pytest.mark.django_db


class TestCreateWithOwner:
    """create_with_owner() must, in one atomic step: validate the caller
    and the target owner, create the Tenant row, and hire the owner into
    it (creating the matching Employee record)."""

    def test_platform_admin_creates_tenant_with_owner(self, platform_admin):
        # The happy path: only platform_admin can call this, and a
        # brand-new plain user becomes the tenant's owner.
        candidate = OwnerFactory()

        tenant = TenantService.create_with_owner(
            name="Coffee Shop", owner_user=candidate, created_by=platform_admin,
        )

        assert tenant.owner_id == candidate.id
        candidate.refresh_from_db()
        # Tenant ownership is represented by an Employee membership.
        assert candidate.role == "owner"

        # create_with_owner() hires with position="owner" specifically —
        # this is asserting that literal value, not just "some Employee
        # row exists".
        employment = Employee.objects.get(user=candidate, is_active=True)
        assert employment.tenant_id == tenant.id
        assert employment.position == "Owner"

    def test_platform_admin_creates_tenant_with_phone_number(self, platform_admin):
        """Platform admin creates a tenant by providing only the owner's phone number."""
        phone = "+998901234567"
        tenant = TenantService.create_with_owner(
            name="Bakery", owner_phone_number=phone, created_by=platform_admin,
        )

        owner_user = tenant.owner
        assert owner_user.phone_number == phone
        assert owner_user.role == "owner"
        assert Employee.objects.filter(user=owner_user, tenant=tenant, is_owner=True, is_active=True).exists()

        employment = Employee.objects.get(user=owner_user, is_active=True)
        assert employment.tenant_id == tenant.id
        assert employment.position == "Owner"

    def test_platform_admin_creates_tenant_with_email_for_post_commit_invite(self, platform_admin):
        """The account is ready for the API to send a setup link after commit."""
        phone = "+998907654321"
        email = "bakery_owner@example.com"

        tenant = TenantService.create_with_owner(
            name="Sweet Bakery",
            owner_phone_number=phone,
            owner_email=email,
            created_by=platform_admin,
        )

        owner_user = tenant.owner
        assert owner_user.email == email
        assert owner_user.phone_number == phone

        assert owner_user.has_usable_password() is False

    def test_non_platform_admin_cannot_create_tenant(self, owner):
        # Tenant creation is platform_admin-only — an existing owner has
        # no authority to spin up additional tenants for other people.
        candidate = OwnerFactory()
        with pytest.raises(TenantServiceError):
            TenantService.create_with_owner(
                name="Some Shop", owner_user=candidate, created_by=owner,
            )

    def test_cannot_assign_platform_admin_as_owner(self, platform_admin):
        # platform_admin accounts stay outside the tenant system entirely
        # (see EmployeeService.hire()'s matching guard) — this checks
        # TenantService rejects it up front, before even attempting the
        # hire() call.
        other_admin = PlatformAdminFactory()
        with pytest.raises(TenantServiceError):
            TenantService.create_with_owner(
                name="Some Shop", owner_user=other_admin, created_by=platform_admin,
            )

    def test_owner_can_own_multiple_shop_tenants(self, platform_admin, owner, tenant):
        second = TenantService.create_with_owner(
            name="Second Shop", owner_user=owner, created_by=platform_admin,
        )
        assert second.owner_id == owner.id
        assert Employee.objects.filter(
            user=owner, tenant=tenant, is_owner=True, is_active=True
        ).exists()
        assert Employee.objects.filter(
            user=owner, tenant=second, is_owner=True, is_active=True
        ).exists()

    def test_duplicate_tenant_name_rejected(self, platform_admin, tenant):
        # Tenant.name is unique=True — same idea as above, checked
        # explicitly in the service so callers get a clean
        # TenantServiceError instead of a raw DB IntegrityError.
        candidate = OwnerFactory()
        with pytest.raises(TenantServiceError):
            TenantService.create_with_owner(
                name=tenant.name, owner_user=candidate, created_by=platform_admin,
            )

    def test_failure_rolls_back_tenant_creation(self, platform_admin, monkeypatch):
        """A failed owner membership insert must roll back the Tenant row."""
        from apps.accounts.services.employee_service import EmployeeServiceError

        candidate = OwnerFactory()
        def fail_hire(**kwargs):
            raise EmployeeServiceError("simulated failure")

        monkeypatch.setattr("apps.tenants.services.EmployeeService.hire", fail_hire)
        before = Tenant.objects.filter(name="Rollback Shop").count()
        with pytest.raises(TenantServiceError):
            TenantService.create_with_owner(
                name="Rollback Shop", owner_user=candidate, created_by=platform_admin,
            )
        # Because create_with_owner() is @transaction.atomic, the failed
        # call must leave zero trace — no half-created Tenant row.
        assert Tenant.objects.filter(name="Rollback Shop").count() == before


class TestChangeOwner:
    """change_owner() must, in one atomic step: fire the current owner
    (demoting them to customer via the normal fire() flow) and hire the
    new owner — leaving exactly one active "Owner" Employee for the
    tenant at all times."""

    def test_platform_admin_changes_owner(self, platform_admin, tenant):
        # The happy path: old owner gets demoted, new owner gets
        # promoted, Tenant.owner is repointed — all three must be true
        # simultaneously afterwards.
        old_owner = tenant.owner
        new_owner_candidate = OwnerFactory()

        updated = TenantService.change_owner(
            tenant=tenant, new_owner=new_owner_candidate, changed_by=platform_admin,
        )

        assert updated.owner_id == new_owner_candidate.id

        old_owner.refresh_from_db()
        # Under Variant A, the old owner's role is not demoted to customer;
        # their active Employee record is deactivated and password invalidated.
        assert Employee.objects.filter(user=old_owner, is_active=True).count() == 0
        assert old_owner.has_usable_password() is False

        new_owner_candidate.refresh_from_db()
        assert new_owner_candidate.role == "owner"
        assert Employee.objects.filter(
            user=new_owner_candidate, tenant=tenant, is_owner=True, is_active=True
        ).exists()
        assert Employee.objects.filter(
            user=new_owner_candidate, tenant=tenant, is_active=True
        ).exists()

    def test_changing_one_shop_keeps_old_owner_active_for_their_other_shop(
        self, platform_admin, owner, tenant
    ):
        other_tenant = TenantFactory(owner=owner)
        EmployeeFactory(user=owner, tenant=other_tenant, is_owner=True)
        owner.set_password("valid-password")
        owner.save(update_fields=["password"])

        TenantService.change_owner(
            tenant=tenant,
            new_owner=OwnerFactory(),
            changed_by=platform_admin,
        )

        owner.refresh_from_db()
        assert owner.has_usable_password()
        assert Employee.objects.filter(
            user=owner, tenant=other_tenant, is_owner=True, is_active=True
        ).exists()

    def test_non_platform_admin_cannot_change_owner(self, owner, tenant):
        # Same restriction as create_with_owner(): only platform_admin
        # may reassign ownership, not even the tenant's own current owner.
        new_owner_candidate = OwnerFactory()
        with pytest.raises(TenantServiceError):
            TenantService.change_owner(
                tenant=tenant, new_owner=new_owner_candidate, changed_by=owner,
            )

    def test_cannot_set_platform_admin_as_new_owner(self, platform_admin, tenant):
        # Same guard as create_with_owner(): platform_admin accounts can
        # never become a tenant's owner.
        other_admin = PlatformAdminFactory()
        with pytest.raises(TenantServiceError):
            TenantService.change_owner(
                tenant=tenant, new_owner=other_admin, changed_by=platform_admin,
            )

    def test_owner_of_another_tenant_can_be_assigned_here(self, platform_admin, tenant):
        other_tenant = TenantFactory()
        new_owner = other_tenant.owner
        TenantService.change_owner(
            tenant=tenant, new_owner=new_owner, changed_by=platform_admin,
        )
        assert tenant.__class__.objects.get(pk=tenant.pk).owner_id == new_owner.id
        assert Employee.objects.filter(
            user=new_owner, tenant=tenant, is_owner=True, is_active=True
        ).exists()
