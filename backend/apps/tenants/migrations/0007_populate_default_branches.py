from django.db import migrations

def create_default_branches(apps, schema_editor):
    Tenant = apps.get_model('tenants', 'Tenant')
    Branch = apps.get_model('tenants', 'Branch')
    for tenant in Tenant.objects.all():
        if not Branch.objects.filter(tenant=tenant).exists():
            Branch.objects.create(
                tenant=tenant,
                name='Asosiy filial',
                is_main=True,
                is_active=True,
            )

class Migration(migrations.Migration):
    dependencies = [
        ('tenants', '0006_branch'),
    ]
    operations = [
        migrations.RunPython(create_default_branches, reverse_code=migrations.RunPython.noop),
    ]
