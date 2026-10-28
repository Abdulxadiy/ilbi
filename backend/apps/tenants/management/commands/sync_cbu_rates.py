from django.core.management.base import BaseCommand, CommandError

from apps.tenants.exchange_rates import ExchangeRateError, sync_cbu_rates


class Command(BaseCommand):
    help = "Fetch shared official USD, EUR and RUB rates from CBU."

    def handle(self, *args, **options):
        try:
            rates = sync_cbu_rates()
        except ExchangeRateError as exc:
            raise CommandError(str(exc)) from exc
        for code, (rate, date) in rates.items():
            self.stdout.write(self.style.SUCCESS(f"{code}: {rate} UZS ({date})"))
