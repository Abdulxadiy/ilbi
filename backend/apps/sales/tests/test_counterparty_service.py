import pytest
from decimal import Decimal

from apps.accounts.models import User, Employee
from apps.sales.models import Counterparty
from apps.sales.services import CounterpartyService, CounterpartyServiceError
from tests.factories import (
    CounterpartyFactory,
    TenantFactory,
    OwnerFactory,
    StaffFactory,
    EmployeeFactory,
)

pytestmark = pytest.mark.django_db


class TestCounterpartyCreate:
    def test_create_counterparty_success(self, tenant):
        cp = CounterpartyService.create(
            tenant=tenant,
            name="Ali Valiyev",
            phone_number="+998901234567",
            note="Doimiy xaridor",
        )
        assert cp.name == "Ali Valiyev"
        assert cp.phone_number == "+998901234567"
        assert cp.note == "Doimiy xaridor"
        assert cp.target_tenant is None
        assert cp.debt_balance_uzs == Decimal("0.00")
        assert cp.debt_balance_usd == Decimal("0.00")

    def test_create_counterparty_empty_phone_fails(self, tenant):
        with pytest.raises(CounterpartyServiceError, match="Telefon raqami kiritilishi shart"):
            CounterpartyService.create(tenant=tenant, name="Ali", phone_number="   ")

    def test_create_counterparty_duplicate_phone_fails(self, tenant):
        CounterpartyFactory(tenant=tenant, phone_number="+998901112233")
        with pytest.raises(CounterpartyServiceError, match="allaqachon mavjud"):
            CounterpartyService.create(tenant=tenant, name="Ali 2", phone_number="+998901112233")

    def test_counterparty_phone_scoped_to_tenant(self):
        tenant_a = TenantFactory()
        tenant_b = TenantFactory()
        cp_a = CounterpartyService.create(tenant=tenant_a, name="Ali", phone_number="+998909998877")
        cp_b = CounterpartyService.create(tenant=tenant_b, name="Ali B", phone_number="+998909998877")
        assert cp_a.phone_number == cp_b.phone_number
        assert cp_a.tenant != cp_b.tenant

    def test_phone_alone_does_not_link_owner_shop(self, tenant):
        other_owner = OwnerFactory(phone_number="+998911112222")
        other_tenant = TenantFactory(owner=other_owner)

        cp = CounterpartyService.create(
            tenant=tenant,
            name="Do'kon B",
            phone_number="+998911112222",
        )
        assert cp.target_tenant is None

    def test_phone_alone_does_not_link_employee_shop(self, tenant, platform_admin):
        other_tenant = TenantFactory()
        staff_user = StaffFactory(phone_number="+998944445555")
        EmployeeFactory(
            user=staff_user,
            tenant=other_tenant,
            is_active=True,
            hired_by=platform_admin,
        )

        cp = CounterpartyService.create(
            tenant=tenant,
            name="Do'kon B Xodimi",
            phone_number="+998944445555",
        )
        assert cp.target_tenant is None


class TestCounterpartyUpdateAndArchive:
    def test_update_counterparty(self, tenant):
        cp = CounterpartyFactory(tenant=tenant, name="Eski nom", note="Eski izoh")
        updated = CounterpartyService.update(cp, name="Yangi nom", note="Yangi izoh")
        assert updated.name == "Yangi nom"
        assert updated.note == "Yangi izoh"

    def test_archive_counterparty(self, tenant):
        cp = CounterpartyFactory(tenant=tenant, is_active=True)
        archived = CounterpartyService.archive(cp)
        assert archived.is_active is False
