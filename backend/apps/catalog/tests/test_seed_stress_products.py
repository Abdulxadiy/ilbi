import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.inventory.models import StockMovement

pytestmark = pytest.mark.django_db


def test_seed_stress_products_requires_tenant_selector(settings):
    settings.DEBUG = True
    with pytest.raises(CommandError, match="Either --tenant-id or --public-code must be provided"):
        call_command("seed_stress_products")


def test_seed_stress_products_refuses_when_debug_false(tenant, settings):
    settings.DEBUG = False
    with pytest.raises(CommandError, match="Refusing to run stress seeder when settings.DEBUG is False"):
        call_command("seed_stress_products", tenant_id=tenant.id)


def test_seed_stress_products_uses_tenant_owner_as_created_by(tenant, settings):
    settings.DEBUG = False
    call_command(
        "seed_stress_products",
        tenant_id=tenant.id,
        count=2,
        batch_size=2,
        i_know_this_is_not_production=True,
    )

    movements = StockMovement.objects.filter(tenant=tenant)
    assert movements.exists()
    for m in movements:
        assert m.created_by == tenant.owner
