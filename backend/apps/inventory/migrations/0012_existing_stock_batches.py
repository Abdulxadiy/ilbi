from django.db import migrations
from django.db.models import Exists, OuterRef
from django.utils import timezone


def preserve_stock(apps, schema_editor):
    Stock = apps.get_model("inventory", "Stock")
    Batch = apps.get_model("inventory", "StockBatch")
    alias = schema_editor.connection.alias
    existing = Batch.objects.using(alias).filter(
        tenant_id=OuterRef("tenant_id"), product_variant_id=OuterRef("product_variant_id")
    )
    stocks = (
        Stock.objects.using(alias).filter(quantity__gt=0).annotate(has_batch=Exists(existing)).filter(has_batch=False)
    )
    pending = []
    for stock in stocks.iterator(chunk_size=1000):
        pending.append(
            Batch(
                tenant_id=stock.tenant_id,
                product_variant_id=stock.product_variant_id,
                batch_code="",
                quantity=stock.quantity,
                cost_price=stock.last_cost_price,
                expires_on=None,
                received_on=timezone.localtime(stock.created_at).date(),
            )
        )
        if len(pending) == 1000:
            Batch.objects.using(alias).bulk_create(pending)
            pending = []
    if pending:
        Batch.objects.using(alias).bulk_create(pending)


class Migration(migrations.Migration):
    dependencies = [("inventory", "0011_tenanttransferitem_batch_manifest_stockbatch_and_more")]
    operations = [migrations.RunPython(preserve_stock, migrations.RunPython.noop)]
