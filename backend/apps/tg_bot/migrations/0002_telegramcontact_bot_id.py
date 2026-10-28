from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("tg_bot", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="telegramcontact",
            name="bot_id",
            field=models.CharField(blank=True, default="", max_length=32),
        ),
    ]
