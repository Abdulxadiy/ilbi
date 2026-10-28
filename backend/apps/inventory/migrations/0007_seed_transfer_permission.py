from django.db import migrations


def add_permission(apps, schema_editor):
    Permission = apps.get_model("permissions", "Permission")
    Permission.objects.get_or_create(
        category="inventory",
        codename="transfer_stock",
        defaults={
            "name": "Do‘konlararo transfer",
            "description": "Bir xil tasdiqlangan sotuvchi profilidagi do‘konlar orasida ichki transfer boshlash yoki qabul qilish.",
        },
    )


def remove_permission(apps, schema_editor):
    apps.get_model("permissions", "Permission").objects.filter(
        category="inventory", codename="transfer_stock"
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0006_remove_branches_one_stock_per_variant"),
        ("permissions", "0001_initial"),
    ]

    operations = [migrations.RunPython(add_permission, remove_permission)]
