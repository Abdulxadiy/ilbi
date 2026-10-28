from django.db import migrations

SALES_PERMISSIONS = [
    ("view_sale", "Sotuvlarni ko'rish", "Sotuvlar va cheklar tarixini ko'rish."),
    ("add_sale", "Yangi sotuv", "POS kassada yangi sotuv amalga oshirish."),
    ("void_sale", "Sotuvni bekor qilish", "Chekni yoki alohida tovarni bekor qilish (void)."),
    ("manage_counterparty", "Kontragentlarni boshqarish", "Kontragentlar ro'yxatini ko'rish, qo'shish va tahrirlash."),
    ("manage_b2b", "B2B transferlarni boshqarish", "B2B tovar o'tkazmalarini qabul qilish va rad etish."),
    ("record_debt_payment", "Qarz to'lovlarini kiritish", "Qarz to'lovlarini kiritish va xatolarni tuzatish."),
]


def seed_permissions(apps, schema_editor):
    Permission = apps.get_model("permissions", "Permission")
    for codename, name, description in SALES_PERMISSIONS:
        Permission.objects.get_or_create(
            category="sales",
            codename=codename,
            defaults={"name": name, "description": description},
        )


def remove_permissions(apps, schema_editor):
    Permission = apps.get_model("permissions", "Permission")
    Permission.objects.filter(
        category="sales",
        codename__in=[codename for codename, _, _ in SALES_PERMISSIONS],
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("sales", "0001_initial"),
        ("permissions", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_permissions, remove_permissions),
    ]
