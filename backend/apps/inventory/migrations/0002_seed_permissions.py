# Seeds the "inventory" Permission rows into apps.permissions.Permission.
# Same reasoning and pattern as apps/catalog/migrations/0002_seed_permissions.py.
#
# `add_stock_intake` is deliberately separate from `adjust_stock`
# (confirmed 2026-09): "kirim" carries cost_price -- an owner may want
# to keep purchase-cost data restricted to trusted staff while still
# letting others record stocktake corrections, returns, and write-offs.

from django.db import migrations

INVENTORY_PERMISSIONS = [
    ("view_stock", "Zaxirani ko'rish", "Stock va StockMovement tarixini ko'rish."),
    ("add_stock_intake", "Kirim qilish", "Yangi \"kirim\" (xarid, tannarx bilan) yozish."),
    ("adjust_stock", "Zaxirani tuzatish",
     "Tuzatish, mijoz/yetkazib beruvchiga qaytarish, isrofgarchilik yozish -- tannarxsiz harakatlar."),
]


def seed_permissions(apps, schema_editor):
    Permission = apps.get_model("permissions", "Permission")
    for codename, name, description in INVENTORY_PERMISSIONS:
        Permission.objects.get_or_create(
            category="inventory",
            codename=codename,
            defaults={"name": name, "description": description},
        )


def remove_permissions(apps, schema_editor):
    Permission = apps.get_model("permissions", "Permission")
    Permission.objects.filter(
        category="inventory",
        codename__in=[codename for codename, _, _ in INVENTORY_PERMISSIONS],
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("inventory", "0001_initial"),
        ("permissions", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_permissions, remove_permissions),
    ]
