"""Service layer for Category: creation with an auto-assigned `kod`,
owner-driven editing, and archiving. The 2-level depth cap lives here
(not on the model) -- see Architectures/ilbi-yol-xaritasi.md,
9-bosqich."""

from django.db import transaction

from apps.catalog.models import Category


class CategoryServiceError(Exception):
    """Raised for invalid Category operations (e.g. depth violation, duplicate kod)."""


class CategoryService:
    @staticmethod
    def _next_kod(tenant) -> str:
        """
        Return the next free sequential `kod` for this tenant.

        `kod` is freely editable after creation (see update()), so a
        plain count()+1 is not safe -- an owner may already have
        hand-picked a number that collides with the "next" one. This
        locks the tenant's existing rows (select_for_update) and walks
        forward past any collision.
        """
        from apps.tenants.models import Tenant
        Tenant.objects.select_for_update().get(pk=tenant.pk)
        existing = set(
            Category.objects.select_for_update()
            .filter(tenant=tenant)
            .values_list("kod", flat=True)
        )
        n = len(existing) + 1
        candidate = f"{n:02d}"
        while candidate in existing:
            n += 1
            candidate = f"{n:02d}"
        return candidate

    @classmethod
    @transaction.atomic
    def create(
        cls, *, tenant, name: str, parent: Category = None, currency: str = "UZS", kod: str = None
    ) -> Category:
        """
        Create a Category. `kod` can be provided by the caller or auto-assigned
        (see _next_kod). Subcategories automatically inherit the parent's currency.
        """
        from apps.tenants.models import Tenant
        Tenant.objects.select_for_update().get(pk=tenant.pk)
        if parent is not None:
            if parent.tenant_id != tenant.id:
                raise CategoryServiceError("parent must belong to the same tenant.")
            if parent.parent_id is not None:
                raise CategoryServiceError(
                    "Categories are limited to 2 levels -- the chosen parent is "
                    "already a subcategory."
                )
            currency = parent.currency
        elif currency not in ("UZS", "USD"):
            raise CategoryServiceError("currency must be 'UZS' or 'USD'.")

        if kod is not None and kod.strip():
            kod = kod.strip()
            already_used = Category.objects.filter(tenant=tenant, kod=kod).exists()
            if already_used:
                raise CategoryServiceError(
                    f"kod '{kod}' is already used by another category in this tenant."
                )
        else:
            kod = cls._next_kod(tenant)

        return Category.objects.create(
            tenant=tenant, name=name, kod=kod, parent=parent, currency=currency
        )

    @classmethod
    @transaction.atomic
    def update(
        cls,
        category: Category,
        *,
        name: str = None,
        kod: str = None,
        parent: Category = None,
        clear_parent: bool = False,
        currency: str = None,
    ) -> Category:
        """Owner-driven edit of name, kod, parent, and/or currency."""
        from apps.tenants.models import Tenant
        from apps.catalog.models import ProductVariant
        from django.db.models import Q
        Tenant.objects.select_for_update().get(pk=category.tenant_id)
        category = Category.objects.select_for_update().get(pk=category.pk)
        if parent is not None:
            parent = Category.objects.get(pk=parent.pk)
        next_currency = parent.currency if parent is not None else (currency or category.currency)
        if next_currency != category.currency:
            variants = ProductVariant.objects.filter(Q(product__category=category) | Q(product__category__parent=category))
            if variants.filter(Q(stock__quantity__gt=0) | Q(stock_movements__isnull=False) | Q(sale_items__isnull=False) | Q(transfer_source_lines__isnull=False)).exists():
                raise CategoryServiceError("Harakat tarixi yoki qoldig‘i bor kategoriya valyutasini o‘zgartirib bo‘lmaydi.")
        if name is not None and name.strip():
            category.name = name.strip()

        if kod is not None and kod.strip():
            kod_clean = kod.strip()
            if kod_clean != category.kod:
                already_used = (
                    Category.objects.filter(tenant=category.tenant, kod=kod_clean)
                    .exclude(pk=category.pk)
                    .exists()
                )
                if already_used:
                    raise CategoryServiceError(
                        f"kod '{kod_clean}' is already used by another category in this tenant."
                    )
                category.kod = kod_clean

        if clear_parent:
            category.parent = None
        elif parent is not None:
            if parent.pk == category.pk:
                raise CategoryServiceError("Kategoriya o‘ziga o‘zi ota kategoriya bo‘la olmaydi.")
            if parent.tenant_id != category.tenant_id:
                raise CategoryServiceError("parent must belong to the same tenant.")
            if parent.parent_id is not None:
                raise CategoryServiceError(
                    "Categories are limited to 2 levels -- the chosen parent is already a subcategory."
                )
            if category.subcategories.filter(is_active=True).exists():
                raise CategoryServiceError(
                    "Ichida subkategoriyalari bo‘lgan kategoriyani boshqa kategoriyaga bola qilib bo‘lmaydi (maksimal 2 bosqich)."
                )
            category.parent = parent
            category.currency = parent.currency

        if currency is not None and category.parent is None:
            if currency not in ("UZS", "USD"):
                raise CategoryServiceError("currency must be 'UZS' or 'USD'.")
            category.currency = currency
            category.subcategories.update(currency=currency)

        category.save()
        return category

    @classmethod
    @transaction.atomic
    def delete(cls, category: Category) -> bool:
        """
        Delete a Category safely.
        - If active subcategories exist: blocks deletion with informative error.
        - If active products exist: blocks deletion with informative error.
        - If no active items exist:
            - Attempts hard delete from database.
            - If historical protected items reference it, falls back to archive (is_active=False).
        """
        if category.subcategories.filter(is_active=True).exists():
            raise CategoryServiceError(
                "Bu kategoriyada faol subkategoriyalar mavjud. Avval ularni o‘chiring yoki boshqa kategoriyaga ko‘chiring."
            )

        if category.products.filter(is_active=True).exists():
            raise CategoryServiceError(
                "Ushbu kategoriyada faol mahsulotlar mavjud. Avval mahsulotlarni o‘chiring yoki boshqa kategoriyaga ko‘chiring."
            )

        from django.db.models import ProtectedError
        try:
            category.delete()
        except ProtectedError:
            category.is_active = False
            category.save(update_fields=["is_active"])
        return True

    @staticmethod
    @transaction.atomic
    def archive(category: Category) -> Category:
        category.is_active = False
        category.save(update_fields=["is_active"])
        return category
