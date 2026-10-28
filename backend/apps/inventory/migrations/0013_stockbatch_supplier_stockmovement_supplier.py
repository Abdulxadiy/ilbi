import re
from django.db import migrations, models


def seed_permission_and_backfill_suppliers(apps, schema_editor):
    Permission = apps.get_model("permissions", "Permission")
    alias = schema_editor.connection.alias

    Permission.objects.using(alias).get_or_create(
        category="inventory",
        codename="view_supplier",
        defaults={
            "name": "Ta’minotchi ma’lumotlarini ko‘rish",
            "description": "Omborda, partiyalarda va harakatlarda tovarlar qaysi ta’minotchi tomonidan keltirilganini ko‘rish.",
        },
    )

    StockMovement = apps.get_model("inventory", "StockMovement")
    StockBatch = apps.get_model("inventory", "StockBatch")

    # Find movements with Ta’minotchi in note
    pattern = re.compile(r"Ta[’']minotchi:\s*([^|]+)", re.IGNORECASE)
    for m in StockMovement.objects.using(alias).filter(note__icontains="minotchi").iterator():
        match = pattern.search(m.note)
        if match:
            supplier = match.group(1).strip()[:255]
            if supplier:
                StockMovement.objects.using(alias).filter(pk=m.pk).update(supplier=supplier)
                # If there are batch allocations or batches associated
                allocations = m.batch_allocations.all()
                for alloc in allocations:
                    if not alloc.batch.supplier:
                        StockBatch.objects.using(alias).filter(pk=alloc.batch_id).update(supplier=supplier)


def remove_permission(apps, schema_editor):
    Permission = apps.get_model("permissions", "Permission")
    alias = schema_editor.connection.alias
    Permission.objects.using(alias).filter(category="inventory", codename="view_supplier").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("inventory", "0012_existing_stock_batches"),
        ("permissions", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="stockbatch",
            name="supplier",
            field=models.CharField(blank=True, db_index=True, max_length=255),
        ),
        migrations.AddField(
            model_name="stockmovement",
            name="supplier",
            field=models.CharField(blank=True, db_index=True, max_length=255),
        ),
        migrations.RunPython(
            seed_permission_and_backfill_suppliers,
            remove_permission,
        ),
    ]
