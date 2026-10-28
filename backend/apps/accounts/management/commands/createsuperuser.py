import os
import sys

from django.contrib.auth.management.commands import createsuperuser
from django.core.management.base import CommandError
from django.db import transaction

from apps.tg_bot.identity import current_bot_id, is_private_chat_id
from apps.tg_bot.models import TelegramContact


class Command(createsuperuser.Command):
    help = "Create a platform_admin superuser and link their Telegram Chat ID for 2FA OTP."

    def add_arguments(self, parser):
        super().add_arguments(parser)
        parser.add_argument(
            "--chat_id",
            dest="chat_id",
            default=None,
            help="Telegram Chat ID for 2FA OTP verification.",
        )

    def handle(self, *args, **options):
        # Platform Admin faqat bitta bo'lishi shart (Singleton qoidasi)
        existing_admin = self.UserModel.objects.filter(role="platform_admin").first()
        if existing_admin:
            raise CommandError(
                f"Platform Admin allaqachon mavjud ({existing_admin.username})! "
                "Tizimda faqat 1 ta Platform Admin bo'lishi mumkin. "
                "Parolni o'zgartirish uchun 'python manage.py changepassword' buyrug'idan foydalaning."
            )

        chat_id = options.get("chat_id") or os.environ.get("DJANGO_SUPERUSER_CHAT_ID")

        if options.get("interactive", True) and not chat_id:
            while not chat_id:
                try:
                    val = input("Telegram Chat ID (masalan @userinfobot dan olingan): ").strip()
                    if val:
                        chat_id = val
                    else:
                        self.stderr.write(
                            "Error: Platform Admin 2FA uchun Telegram Chat ID bo'sh bo'lishi mumkin emas."
                        )
                except KeyboardInterrupt:
                    self.stderr.write("\nBekor qilindi.")
                    sys.exit(1)

        if not chat_id and not options.get("interactive", True):
            raise CommandError("You must provide --chat_id or DJANGO_SUPERUSER_CHAT_ID with --noinput.")

        chat_id = str(chat_id).strip()
        if not is_private_chat_id(chat_id):
            raise CommandError("2FA uchun shaxsiy Telegram chat IDsi talab qilinadi.")

        bot_id = current_bot_id()
        if not bot_id:
            raise CommandError("TELEGRAM_BOT_TOKEN must identify the ILBI login bot before creating an administrator.")

        with transaction.atomic():
            super().handle(*args, **options)

            # Retrieve newly created superuser
            phone_number = options.get(self.UserModel.USERNAME_FIELD) or options.get("phone_number")
            if phone_number:
                norm_phone = self.UserModel.objects.normalize_phone_number(phone_number)
                user = self.UserModel.objects.filter(phone_number=norm_phone).first()
            else:
                user = self.UserModel.objects.filter(is_superuser=True).order_by("-id").first()

            if user and chat_id:
                contact, created = TelegramContact.objects.update_or_create(
                    phone_number=user.phone_number,
                    defaults={"chat_id": str(chat_id).strip(), "bot_id": bot_id},
                )
                action = "yaratildi va ulandi" if created else "yangilandi"
                self.stdout.write(
                    self.style.SUCCESS(
                        f"✓ Telegram kontakt muvaffaqiyatli {action}: {user.phone_number} -> Chat ID: {chat_id}"
                    )
                )
