# Generated for apps.inventory -- Stock, StockMovement
# (9-bosqich, inventory, 2026-09)

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('tenants', '0001_initial'),
        ('catalog', '0001_initial'),
        ('accounts', '0002_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='Stock',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('quantity', models.DecimalField(decimal_places=3, default=0, max_digits=14)),
                ('last_cost_price', models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ('product_variant', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='stock', to='catalog.productvariant')),
                ('tenant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='tenants.tenant')),
            ],
            options={
                'abstract': False,
            },
        ),
        migrations.CreateModel(
            name='StockMovement',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('type', models.CharField(choices=[('kirim', 'Kirim'), ('sotuv', 'Sotuv'), ('mijoz_qaytardi', 'Mijoz qaytardi'), ('yetkazib_beruvchiga_qaytarish', 'Yetkazib beruvchiga qaytarish'), ('isrofgarchilik', 'Isrofgarchilik'), ('tuzatish', 'Tuzatish (inventarizatsiya)')], max_length=32)),
                ('direction', models.CharField(choices=[('in', 'Kirim'), ('out', 'Chiqim')], max_length=3)),
                ('quantity', models.DecimalField(decimal_places=3, max_digits=14)),
                ('cost_price', models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ('note', models.TextField(blank=True)),
                ('created_by', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='stock_movements', to='accounts.user')),
                ('product_variant', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='stock_movements', to='catalog.productvariant')),
                ('tenant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='tenants.tenant')),
            ],
            options={
                'ordering': ['-created_at'],
                'abstract': False,
            },
        ),
        migrations.AddConstraint(
            model_name='stock',
            constraint=models.CheckConstraint(condition=models.Q(('quantity__gte', 0)), name='stock_quantity_never_negative'),
        ),
        migrations.AddConstraint(
            model_name='stockmovement',
            constraint=models.CheckConstraint(condition=models.Q(('quantity__gt', 0)), name='stock_movement_quantity_positive'),
        ),
    ]
