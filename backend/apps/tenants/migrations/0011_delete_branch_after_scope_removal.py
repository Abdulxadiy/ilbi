from django.db import migrations


def drop_branch_table_if_present(apps, schema_editor):
    branch_model = apps.get_model("tenants", "Branch")
    if branch_model._meta.db_table in schema_editor.connection.introspection.table_names():
        schema_editor.delete_model(branch_model)


def recreate_branch_table_if_missing(apps, schema_editor):
    branch_model = apps.get_model("tenants", "Branch")
    if branch_model._meta.db_table not in schema_editor.connection.introspection.table_names():
        schema_editor.create_model(branch_model)


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0008_remove_branch_model"),
        ("cashbox", "0003_remove_cashbox_branch"),
        ("sales", "0006_remove_sale_branch"),
        ("inventory", "0006_remove_branches_one_stock_per_variant"),
        ("tenants", "0010_sellerprofile_tenant_seller_profile_and_more"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(drop_branch_table_if_present, recreate_branch_table_if_missing),
            ],
            state_operations=[
                migrations.DeleteModel(name="Branch"),
            ],
        ),
    ]
