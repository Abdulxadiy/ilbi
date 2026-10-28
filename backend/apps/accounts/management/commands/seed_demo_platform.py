"""Build a synthetic multi-tenant dataset in an empty local development database."""

import os
from datetime import timedelta
from io import StringIO

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Employee, User
from apps.accounts.services.demo_access_service import DemoAccessService
from apps.catalog.management.commands.seed_stress_products import calculate_ean13_checksum
from apps.catalog.models import Product, ProductVariant
from apps.permissions.models import Permission
from apps.sales.models import Counterparty
from apps.sales.services.sale_service import SaleService
from apps.tenants.models import SellerProfile, Tenant


class Command(BaseCommand):
    help = "Bo‘sh lokal bazaga demo tenantlar, xodimlar, mahsulotlar va sotuvlar qo‘shish."

    def add_arguments(self, parser):
        parser.add_argument("--products-per-tenant", type=int, default=5000)
        parser.add_argument("--employees-per-tenant", type=int, default=100)
        parser.add_argument("--sales-per-tenant", type=int, default=100)

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG or not settings.LOCAL_DEMO_LOGIN_ENABLED:
            raise CommandError("Demo seed uchun DEBUG va LOCAL_DEMO_LOGIN_ENABLED yoqilgan bo‘lishi kerak.")
        if User.objects.exists() or Tenant.objects.exists():
            raise CommandError("Demo seed faqat bo‘sh bazada ishlaydi; mavjud ma’lumot o‘chirilmaydi.")
        product_count = options["products_per_tenant"]
        staff_count = options["employees_per_tenant"]
        sale_count = options["sales_per_tenant"]
        if not 10 <= product_count <= 100000 or not 1 <= staff_count <= 1000 or not 0 <= sale_count <= product_count:
            raise CommandError("Mahsulot: 10–100000; xodim: 1–1000; sotuv: 0 dan mahsulot sonigacha.")
        password = os.environ.get("ILBI_DEMO_PASSWORD") or os.environ.get("INVENTRA_DEMO_PASSWORD", "")
        if len(password) < 12:
            raise CommandError("ILBI_DEMO_PASSWORD muhit o‘zgaruvchisiga kamida 12 belgili parol yozing.")

        # Shared only by explicitly synthetic accounts; never printed or checked into fixtures.
        password_hash = make_password(password)
        demo_group, _ = Group.objects.get_or_create(name=DemoAccessService.GROUP_NAME)
        now = timezone.now()
        users = []

        def new_user(username, role, first_name, sequence):
            user = User.objects.create(
                username=username, role=role, password=password_hash,
                phone_number=f"{DemoAccessService.PHONE_PREFIX}{sequence:07d}",
                email=f"{username}@example.invalid", first_name=first_name, last_name="Demo",
                is_staff=role == "platform_admin", is_superuser=role == "platform_admin",
                is_active=True, is_phone_verified=True, profile_completed=True,
                terms_accepted=True, terms_accepted_at=now,
            )
            users.append(user)
            return user

        admin = new_user("demo_admin", "platform_admin", "Administrator", 1)
        owner = new_user("demo_owner", "owner", "Asosiy owner", 2)
        partner = new_user("demo_partner", "owner", "Hamkor owner", 3)
        other_owner = new_user("demo_owner4", "owner", "To‘rtinchi owner", 4)
        profiles = {}
        for index, person in enumerate((owner, partner, other_owner), start=1):
            profiles[person.id] = SellerProfile.objects.create(
                owner=person, legal_form="ytt" if index == 1 else "mchj",
                official_name=f"DEMO sotuvchi {index} — faqat sinov",
                tax_identifier=f"DEMO-ONLY-{index}", tax_regime="Faqat sinov",
                permitted_activity="Lokal test ma’lumotlari; haqiqiy sotuvchi emas.",
                status=SellerProfile.STATUS_APPROVED, submitted_at=now, reviewed_at=now,
                reviewed_by=admin, expires_at=now + timedelta(days=365),
                review_reason="Lokal demo fixture. Huquqiy yoki fiskal tasdiq hisoblanmaydi.",
            )

        tenant_specs = [("Markaz", owner), ("Chilonzor", owner), ("Hamkor", partner), ("Sergeli", other_owner)]
        permissions = list(Permission.objects.filter(category__in=("catalog", "inventory", "sales")))
        cashier_codes = {"view_category", "view_product", "view_stock", "view_sale", "add_sale", "manage_counterparty"}
        warehouse_codes = {
            "view_category", "view_product", "view_stock", "add_stock_intake", "adjust_stock", "transfer_stock",
        }
        restricted_codes = {"void_sale", "record_debt_payment"}
        memberships = []
        tenants = []
        for index, (label, person) in enumerate(tenant_specs, start=1):
            tenant = Tenant.objects.create(
                name=f"DEMO — {label}", owner=person, seller_profile=profiles[person.id],
                public_code=f"DEMO{index:04d}", address=f"Sinov manzili {index}",
                description="Sun’iy yuklama ma’lumotlari. Faqat lokal test uchun.",
                daily_report_target=Tenant.TARGET_NONE, shift_report_target=Tenant.TARGET_NONE,
                low_stock_report_target=Tenant.TARGET_NONE, notify_on_sale=False, notify_on_debt=False,
                notify_web_reports=False, notify_web_low_stock=False,
                receipt_header="DEMO — FISKAL CHEK EMAS", receipt_footer="Faqat sinov savdosi.",
            )
            tenants.append(tenant)
            from apps.cashbox.services.cashbox_service import CashboxService
            CashboxService.open_shift(tenant=tenant, user=person)
            Employee.objects.create(user=person, tenant=tenant, is_owner=True, position="Do‘kon egasi", hired_by=admin)
            staff = []
            for number in range(1, staff_count + 1):
                position = ("Menejer", "Kassir", "Omborchi")[(number - 1) % 3]
                user = new_user(
                    f"demo_t{index}_staff{number:03d}", "staff", f"{position} {number:03d}",
                    10000 + index * 1000 + number,
                )
                employee = Employee.objects.create(
                    user=user, tenant=tenant, position=position, is_owner=False, hired_by=person,
                )
                allowed = cashier_codes if position == "Kassir" else warehouse_codes if position == "Omborchi" else None
                for permission in permissions:
                    if permission.codename in restricted_codes or (
                        allowed is not None and permission.codename not in allowed
                    ):
                        continue
                    memberships.append(Employee.permissions.through(
                        employee_id=employee.id, permission_id=permission.id,
                    ))
                staff.append(user)

            call_command("seed_stress_products", tenant_id=tenant.id, count=product_count, stdout=StringIO())
            # Keep common barcodes for matching, plus tenant-only goods for isolation/missing-catalog checks.
            exclusive = list(ProductVariant.objects.filter(tenant=tenant).select_related("product")
                             .order_by("id")[product_count * 3 // 5:])
            for number, variant in enumerate(exclusive, start=1):
                prefix = f"20{index:02d}{number:08d}"
                variant.barcode = prefix + calculate_ean13_checksum(prefix)
                variant.product.name += f" — {label}"
            ProductVariant.objects.bulk_update(exclusive, ["barcode"], batch_size=500)
            Product.objects.bulk_update([variant.product for variant in exclusive], ["name"], batch_size=500)
            counterparties = Counterparty.objects.bulk_create([
                Counterparty(
                    tenant=tenant, name=f"DEMO Mijoz {index}-{number:03d}",
                    phone_number=f"+998003{index:02d}{number:04d}", note="Sun’iy nasiya kontakti; xabar yuborilmaydi.",
                ) for number in range(1, 101)
            ])
            variants = list(ProductVariant.objects.filter(tenant=tenant).order_by("id")[:sale_count])
            sale_staff = [person for number, person in enumerate(staff) if number % 3 != 2]
            for number, variant in enumerate(variants):
                payment = ("cash", "card", "debt")[number % 3]
                SaleService.create_sale(
                    tenant=tenant, user=sale_staff[number % len(sale_staff)],
                    items_data=[{"product_variant_id": variant.id, "quantity": "1"}],
                    payment_type=payment,
                    counterparty=counterparties[number % len(counterparties)] if payment == "debt" else None,
                    idempotency_key=f"demo-{index}-{number}",
                )
            self.stdout.write(f"{tenant.name}: {product_count} mahsulot, {staff_count} xodim, {sale_count} sotuv.")

        Employee.permissions.through.objects.bulk_create(memberships, batch_size=1000)
        User.groups.through.objects.bulk_create([
            User.groups.through(user_id=user.id, group_id=demo_group.id) for user in users
        ], batch_size=1000)
        # Explicit B2B partner links between different synthetic sellers.
        for source, target in ((tenants[0], tenants[2]), (tenants[2], tenants[0])):
            Counterparty.objects.create(
                tenant=source, name=target.name, phone_number=target.owner.phone_number,
                target_tenant=target, note="Demo B2B hamkor.",
            )
        self.stdout.write(self.style.SUCCESS(
            f"Tayyor: 4 tenant, {len(users)} akkaunt, {product_count * 4} mahsulot, {sale_count * 4} sotuv."
        ))
