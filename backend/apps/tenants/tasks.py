from celery import shared_task

from apps.tenants.exchange_rates import ExchangeRateError, sync_cbu_rates


@shared_task(autoretry_for=(ExchangeRateError,), retry_backoff=60, retry_backoff_max=1800, max_retries=5)
def sync_cbu_rates_task():
    return {code: str(rate) for code, (rate, _) in sync_cbu_rates().items()}
