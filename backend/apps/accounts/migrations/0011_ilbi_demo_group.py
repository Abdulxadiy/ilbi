from django.db import migrations


def rename_group(apps, old_name, new_name):
    group = apps.get_model("auth", "Group")
    # Keep both existing groups intact if they already coexist.
    if not group.objects.filter(name=new_name).exists():
        group.objects.filter(name=old_name).update(name=new_name)


def forward(apps, schema_editor):
    rename_group(apps, "inventra_local_demo", "ilbi_local_demo")


def backward(apps, schema_editor):
    rename_group(apps, "ilbi_local_demo", "inventra_local_demo")


class Migration(migrations.Migration):
    dependencies = [("accounts", "0010_employee_directory_actions")]
    operations = [migrations.RunPython(forward, backward)]
