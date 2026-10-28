from django.db import migrations

def backfill_branches(apps, schema_editor):
    Tenant = apps.get_model('tenants', 'Tenant')
    Branch = apps.get_model('tenants', 'Branch')
    Stock = apps.get_model('inventory', 'Stock')
    StockMovement = apps.get_model('inventory', 'StockMovement')
    Sale = apps.get_model('sales', 'Sale')
    DailyCashReport = apps.get_model('cashbox', 'DailyCashReport')
    CashExpense = apps.get_model('cashbox', 'CashExpense')
    CashIncome = apps.get_model('cashbox', 'CashIncome')

    for t in Tenant.objects.all():
        mb = Branch.objects.filter(tenant=t, is_main=True).first()
        if not mb:
            mb = Branch.objects.filter(tenant=t).first()
        if not mb:
            mb = Branch.objects.create(tenant=t, name='Asosiy filial', is_main=True, is_active=True)
        Stock.objects.filter(tenant=t, branch__isnull=True).update(branch=mb)
        StockMovement.objects.filter(tenant=t, branch__isnull=True).update(branch=mb)
        Sale.objects.filter(tenant=t, branch__isnull=True).update(branch=mb)
        DailyCashReport.objects.filter(tenant=t, branch__isnull=True).update(branch=mb)
        CashExpense.objects.filter(tenant=t, branch__isnull=True).update(branch=mb)
        CashIncome.objects.filter(tenant=t, branch__isnull=True).update(branch=mb)

class Migration(migrations.Migration):
    dependencies = [
        ('inventory', '0004_stocktransfer_stocktransferitem_stock_branch_and_more'),
        ('sales', '0005_sale_branch'),
        ('cashbox', '0002_cashexpense_branch_cashincome_branch_and_more'),
    ]
    operations = [
        migrations.RunPython(backfill_branches, reverse_code=migrations.RunPython.noop),
    ]
