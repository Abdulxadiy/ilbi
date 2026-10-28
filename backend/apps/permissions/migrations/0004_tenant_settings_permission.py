from django.db import migrations


def seed(apps, schema_editor):
    apps.get_model("permissions", "Permission").objects.get_or_create(
        category="tenants",
        codename="manage_settings",
        defaults={
            "name": "Do‘kon sozlamalarini boshqarish",
            "description": "Faol do‘konning chek, soliq, kurs va bildirishnoma sozlamalarini boshqarish.",
        },
    )


def remove(apps, schema_editor):
    apps.get_model("permissions", "Permission").objects.filter(
        category="tenants",
        codename="manage_settings",
    ).delete()


class Migration(migrations.Migration):
    dependencies = [("permissions", "0003_seed_analytics_permissions")]
    operations = [migrations.RunPython(seed, remove)]
