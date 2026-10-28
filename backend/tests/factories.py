"""
Shared factory_boy factories used across the test suite.

Place this file at: tests/factories.py (repo root, sibling to apps/, config/)
and make sure `tests/__init__.py` exists so it is importable as `tests.factories`.

Why factory_boy instead of hand-rolling User.objects.create(...) in every
test: it gives every test a unique phone_number/username for free (via
factory.Sequence), and lets tests override only the fields they actually
care about instead of repeating the full field list everywhere.
"""
import factory
from factory.django import DjangoModelFactory
from decimal import Decimal
from datetime import timedelta
from django.utils import timezone

from apps.accounts.models import User, Employee
from apps.tenants.models import SellerProfile, Tenant
from apps.catalog.models import Category, Product, ProductVariant
from apps.sales.models import Counterparty, Sale, SaleItem, DebtPayment


class UserFactory(DjangoModelFactory):
    """Base factory for a bare User row with no employment yet.

    `customer` no longer exists as an ILBI role (it moved entirely
    to the Shop microservice) -- this factory now represents "a person
    who exists as a User but has no active Employee record", the
    pre-hire state. Role-specific factories below (PlatformAdminFactory,
    OwnerFactory, StaffFactory) subclass this and only override `role` +
    `username`.
    """

    class Meta:
        model = User
        # Tell factory_boy not to call .save() a second time after the
        # post_generation `password` hook below already saved the row —
        # avoids a redundant extra UPDATE per created user.
        skip_postgeneration_save = True

    # factory.Sequence guarantees a unique phone number per generated
    # instance (n increments per call), which matters because
    # phone_number is unique=True on the model.
    phone_number = factory.Sequence(lambda n: f"+99890{n:07d}")
    username = None
    role = "staff"
    is_active = True
    is_phone_verified = True
    profile_completed = True

    @factory.post_generation
    def password(self, create, extracted, **kwargs):
        """Set a real password only when the test explicitly asks for one
        (UserFactory(password="something")); otherwise mark the account
        unusable, matching how real customers behave (they never get a
        password — see EmployeeService.fire(), which calls
        set_unusable_password() when demoting someone back to customer).
        """
        if extracted:
            self.set_password(extracted)
        else:
            self.set_unusable_password()
        if create:
            self.save(update_fields=["password"])


class PlatformAdminFactory(UserFactory):
    """platform_admin users always need a real `username` (they log in
    with username+password, never OTP), and is_staff=True mirrors how
    create_superuser() sets it in managers.py."""

    role = "platform_admin"
    username = factory.Sequence(lambda n: f"admin{n}")
    is_staff = True


class OwnerFactory(UserFactory):
    """owner-role user. Does NOT automatically get a Tenant or an active
    Employee record — see the `tenant` fixture in conftest.py for a
    fully wired-up owner+tenant+employment combo."""

    role = "owner"
    username = factory.Sequence(lambda n: f"owner{n}")


class StaffFactory(UserFactory):
    """staff-role user, same caveat as OwnerFactory: no Employee record
    is created automatically. Combine with EmployeeFactory when a test
    needs the employment relationship itself, not just the role field."""

    role = "staff"
    username = factory.Sequence(lambda n: f"staff{n}")

class TenantFactory(DjangoModelFactory):
    """A Tenant row. `owner` defaults to a fresh OwnerFactory() instance
    if not overridden, so `TenantFactory()` alone is enough to get a
    fully valid tenant+owner pair for tests that don't care about the
    owner's identity specifically.

    Owner access is represented by Employee membership, not a single
    tenant foreign key on User.
    """

    class Meta:
        model = Tenant
        skip_postgeneration_save = True

    name = factory.Sequence(lambda n: f"Tenant {n}")
    description = ""
    is_active = True
    owner = factory.SubFactory(OwnerFactory)
    seller_profile = factory.LazyAttribute(lambda obj: SellerProfile.objects.get_or_create(
        owner=obj.owner,
        tax_identifier=f"TEST-{obj.owner.id}",
        defaults={
            "legal_form": SellerProfile.LEGAL_FORM_OTHER,
            "official_name": f"Test seller {obj.owner.id}",
            "status": SellerProfile.STATUS_APPROVED,
            "expires_at": timezone.now() + timedelta(days=365),
        },
    )[0])

    @factory.post_generation
    def open_shift(self, create, extracted, **kwargs):
        if create and extracted is not False:
            from apps.cashbox.models import CashShift
            CashShift.objects.create(tenant=self, opened_by=self.owner)

class EmployeeFactory(DjangoModelFactory):
    """An Employee row. Defaults to a staff member freshly hired by a
    freshly-created platform_admin, at a freshly-created tenant — override
    `user`/`tenant`/`hired_by` explicitly whenever the test needs these to
    line up with other objects already in scope (which is most of the
    time; the defaults mainly exist so `EmployeeFactory()` alone doesn't
    error out when a test genuinely doesn't care about the specifics).
    """

    class Meta:
        model = Employee
        # Same reasoning as UserFactory/TenantFactory above: sync_user_tenant
        # below does its own explicit save() where needed (on `user`, not
        # on this Employee instance), so the automatic post-hook re-save
        # of the Employee row itself is redundant.
        skip_postgeneration_save = True

    user = factory.SubFactory(StaffFactory)
    tenant = factory.SubFactory(TenantFactory)
    position = "Sales"
    is_active = True
    is_owner = factory.LazyAttribute(lambda employee: employee.user.role == "owner")
    hired_by = factory.SubFactory(PlatformAdminFactory)



class CategoryFactory(DjangoModelFactory):
    """A top-level Category (no parent) by default. `kod` is a plain
    sequence here for factory simplicity -- production code always
    goes through CategoryService.create() for the real collision-safe
    generation (see apps/catalog/services/category_service.py)."""

    class Meta:
        model = Category

    tenant = factory.SubFactory(TenantFactory)
    name = factory.Sequence(lambda n: f"Category {n}")
    kod = factory.Sequence(lambda n: f"{n:02d}")
    parent = None
    is_active = True


class ProductFactory(DjangoModelFactory):
    """A Product with NO variants by default -- most tests that need a
    sellable unit should use ProductVariantFactory instead (which
    creates its own Product via SubFactory), since a real Product is
    never valid without at least one variant. This factory exists for
    tests that specifically exercise Product-only behaviour (e.g.
    archiving cascades)."""

    class Meta:
        model = Product

    tenant = factory.SelfAttribute("category.tenant")
    category = factory.SubFactory(CategoryFactory)
    name = factory.Sequence(lambda n: f"Product {n}")
    is_active = True


class ProductVariantFactory(DjangoModelFactory):
    """A ProductVariant with its own freshly-created Product by default.
    `sku` is a plain sequence here for factory simplicity -- production
    code always goes through ProductService for the real collision-safe
    generation."""

    class Meta:
        model = ProductVariant

    tenant = factory.SelfAttribute("product.tenant")
    product = factory.SubFactory(ProductFactory)
    name = "Standart"
    sku = factory.Sequence(lambda n: f"{n:06d}")
    code = ""
    unit = "dona"
    price_partner = Decimal("8000.00")
    price_min = Decimal("10000.00")
    price_recommended = Decimal("12000.00")
    is_active = True


class CounterpartyFactory(DjangoModelFactory):
    class Meta:
        model = Counterparty

    tenant = factory.SubFactory(TenantFactory)
    name = factory.Sequence(lambda n: f"Client {n}")
    phone_number = factory.Sequence(lambda n: f"+99893{n:07d}")
    target_tenant = None
    debt_balance_uzs = Decimal("0.00")
    debt_balance_usd = Decimal("0.00")
    last_notified_debt_step_uzs = 0
    last_notified_debt_step_usd = 0
    note = ""
    is_active = True


class SaleFactory(DjangoModelFactory):
    class Meta:
        model = Sale

    tenant = factory.SubFactory(TenantFactory)
    receipt_number = factory.Sequence(lambda n: f"REC-{n:06d}")
    sold_by = factory.SubFactory(StaffFactory)
    counterparty = None
    currency = Sale.CURRENCY_UZS
    is_partner_sale = False
    total_amount = Decimal("0.00")
    payment_type = Sale.PAYMENT_CASH
    status = Sale.STATUS_COMPLETED


class SaleItemFactory(DjangoModelFactory):
    class Meta:
        model = SaleItem

    tenant = factory.SelfAttribute("sale.tenant")
    sale = factory.SubFactory(SaleFactory)
    product_variant = factory.SubFactory(ProductVariantFactory)
    quantity = Decimal("1.000")
    unit_price = Decimal("10000.00")
    cost_price = Decimal("8000.00")
    total_price = Decimal("10000.00")
    status = SaleItem.STATUS_ACTIVE


class DebtPaymentFactory(DjangoModelFactory):
    class Meta:
        model = DebtPayment

    tenant = factory.SelfAttribute("counterparty.tenant")
    counterparty = factory.SubFactory(CounterpartyFactory)
    amount = Decimal("50000.00")
    currency = DebtPayment.CURRENCY_UZS
    recorded_by = factory.SubFactory(OwnerFactory)
    is_correction = False
    note = ""
