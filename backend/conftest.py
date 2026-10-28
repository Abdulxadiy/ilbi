"""
Root conftest.py — place at repo root, next to manage.py.

pytest auto-discovers this file (no import needed) and makes every
fixture defined here available to ALL test modules in the project,
regardless of which app they live in. That's why the shared, generic
fixtures (a platform_admin, a bare owner, a fully set-up tenant, ...)
live here instead of being duplicated in each app's tests/ package.

The `db` fixture used below is provided by pytest-django: requesting it
wraps the test in a transaction that's rolled back afterwards, so every
test starts from a clean database without you having to clean up by hand.
"""
import pytest

from tests.factories import (
    PlatformAdminFactory,
    OwnerFactory,
    StaffFactory,
    UserFactory,
    TenantFactory,
    EmployeeFactory,
)


@pytest.fixture
def platform_admin(db):
    """A bare platform_admin User, no Employee/Tenant attached.

    platform_admin accounts are never hired via EmployeeService (per the
    architecture doc — they're created through the Django shell only),
    so there's no matching Employee row to set up here; the role field
    alone is enough for permission checks.
    """
    return PlatformAdminFactory()


@pytest.fixture
def owner(db):
    """A bare owner-role User with no Tenant/Employee wired up yet.

    Deliberately minimal: some tests only care about the User row itself
    (e.g. checking that a service call is denied because of `.role`),
    and don't need a real tenant/employment relationship. Use the
    `tenant` fixture below when you need a fully consistent owner.
    """
    return OwnerFactory()


@pytest.fixture
def tenant(db, owner, platform_admin):
    """A Tenant owned by `owner`, with an active owner Employee membership.

    This mirrors the end state of TenantService.create_with_owner(), but
    is built directly through factories (skipping the service call) so
    tests that exercise fire()/hire() logic on top of it run faster and
    don't depend on TenantService already being correct.

    Because pytest caches fixture instances per test function, the tenant
    and owner fixtures refer to the same user instance.
    """
    t = TenantFactory(owner=owner)
    EmployeeFactory(
        user=owner, tenant=t, is_owner=True, is_active=True, position="Owner", hired_by=platform_admin,
    )
    from apps.cashbox.models import CashShift
    CashShift.objects.get_or_create(tenant=t, closed_at__isnull=True, defaults={'opened_by': owner})
    return t


@pytest.fixture
def staff(db):
    """A bare staff-role User with no active Employee record.

    Note: `role="staff"` alone does NOT imply a matching Employee row
    exists — some tests need that inconsistency deliberately (e.g. to
    check that a service correctly rejects a "staff" user who has no
    active employment), others need to create the Employee explicitly
    via EmployeeFactory.
    """
    return StaffFactory()


@pytest.fixture
def customer(db):
    """A bare User with no active Employee record -- i.e. someone who
    exists in the system but hasn't been hired into any tenant yet."""
    return UserFactory()


@pytest.fixture(scope="session")
def django_db_setup(django_db_setup, django_db_blocker):
    # Transactional concurrency tests flush data migrations at teardown. Restore
    # the real permission catalog when a previously used test DB is reused.
    from importlib import import_module
    from django.apps import apps
    with django_db_blocker.unblock():
        for module, function in (
            ("apps.catalog.migrations.0002_seed_permissions", "seed_permissions"),
            ("apps.inventory.migrations.0002_seed_permissions", "seed_permissions"),
            ("apps.inventory.migrations.0007_seed_transfer_permission", "add_permission"),
            ("apps.sales.migrations.0002_seed_permissions", "seed_permissions"),
            ("apps.permissions.migrations.0002_cashbox_and_cost_permissions", "seed"),
            ("apps.permissions.migrations.0003_seed_analytics_permissions", "seed"),
            ("apps.permissions.migrations.0004_tenant_settings_permission", "seed"),
        ):
            getattr(import_module(module), function)(apps, None)
