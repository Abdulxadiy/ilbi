# Seeds the "catalog" Permission rows into apps.permissions.Permission.
#
# There's no admin UI or management command yet for entering these by
# hand (see roadmap, 0.3: "Django admin UI ... yo'q"), so a data
# migration is the only repeatable, version-controlled way to seed
# them today. This pattern should be reused for every future business
# app (inventory, sales, payments, analytics).
#
# Consolidated on purpose: ProductVariant has no permissions of its
# own -- a Product permission covers its variants too, since a variant
# can't exist independently of its Product. See
# Architectures/ilbi-yol-xaritasi.md, 9-bosqich.

from django.db import migrations

CATALOG_PERMISSIONS = [
    ("view_category", "Kategoriyalarni ko'rish", "Category ro'yxati va tafsilotini ko'rish."),
    ("add_category", "Kategoriya qo'shish", "Yangi Category yaratish."),
    ("change_category", "Kategoriyani tahrirlash", "Category nomi va kodini o'zgartirish."),
    ("archive_category", "Kategoriyani arxivlash", "Category'ni is_active=False qilish."),
    ("view_product", "Mahsulotlarni ko'rish", "Product va uning barcha ProductVariant'larini ko'rish."),
    ("add_product", "Mahsulot qo'shish", "Yangi Product (majburiy birinchi ProductVariant bilan) yaratish."),
    ("change_product", "Mahsulotni tahrirlash", "Product va uning variantlarini tahrirlash, yangi variant qo'shish."),
    ("archive_product", "Mahsulotni arxivlash", "Product'ni va barcha variantlarini (kaskad) arxivlash."),
]


def seed_permissions(apps, schema_editor):
    Permission = apps.get_model("permissions", "Permission")
    for codename, name, description in CATALOG_PERMISSIONS:
        Permission.objects.get_or_create(
            category="catalog",
            codename=codename,
            defaults={"name": name, "description": description},
        )


def remove_permissions(apps, schema_editor):
    Permission = apps.get_model("permissions", "Permission")
    Permission.objects.filter(
        category="catalog",
        codename__in=[codename for codename, _, _ in CATALOG_PERMISSIONS],
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("catalog", "0001_initial"),
        ("permissions", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_permissions, remove_permissions),
    ]
