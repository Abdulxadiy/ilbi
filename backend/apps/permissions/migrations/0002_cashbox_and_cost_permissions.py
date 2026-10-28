from django.db import migrations

PERMISSIONS = [
    ('cashbox', 'view_cashbox', 'Kassa va smena hisobotlarini ko‘rish'),
    ('cashbox', 'record_expense', 'Kassadan chiqim kiritish'),
    ('cashbox', 'record_income', 'Kassaga kirim kiritish'),
    ('cashbox', 'manage_shift', 'Smena ochish va yopish'),
    ('catalog', 'view_cost_price', 'Mahsulot tannarxini ko‘rish'),
]


def seed(apps, schema_editor):
    permission = apps.get_model('permissions', 'Permission')
    for category, codename, name in PERMISSIONS:
        permission.objects.get_or_create(category=category, codename=codename, defaults={'name': name})


class Migration(migrations.Migration):
    dependencies = [('permissions', '0001_initial')]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
