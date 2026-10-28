from django.db import migrations

PERMISSIONS = [
    (
        'analytics',
        'view_dashboard',
        'Dashboard va analitikani ko‘rish',
        'Do‘konning asosiy boshqaruv paneli, savdo va moliyaviy analitika ko‘rsatkichlarini ko‘rish.',
    ),
    (
        'analytics',
        'view_reports',
        'Hisobotlarni ko‘rish',
        'Moliyaviy va umumiy davriy hisobotlarni ko‘rish hamda eksport qilish.',
    ),
]


def seed(apps, schema_editor):
    permission = apps.get_model('permissions', 'Permission')
    for category, codename, name, description in PERMISSIONS:
        permission.objects.get_or_create(
            category=category,
            codename=codename,
            defaults={'name': name, 'description': description},
        )


def remove(apps, schema_editor):
    permission = apps.get_model('permissions', 'Permission')
    for category, codename, _, _ in PERMISSIONS:
        permission.objects.filter(category=category, codename=codename).delete()


class Migration(migrations.Migration):
    dependencies = [('permissions', '0002_cashbox_and_cost_permissions')]
    operations = [migrations.RunPython(seed, remove)]
