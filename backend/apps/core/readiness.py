"""Private, read-only readiness checks. Never return dependency credentials or errors."""

import logging
from ipaddress import ip_address

from django.conf import settings
from django.db import connections
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_safe
from redis import Redis
from redis.backoff import NoBackoff
from redis.retry import Retry

logger = logging.getLogger(__name__)


def database_ready():
    # A separate short-lived connection keeps probe timeouts and transaction
    # state out of normal requests, and reconnects cleanly after a DB restart.
    database = connections["default"].copy(alias="readiness")
    options = database.settings_dict["OPTIONS"]
    options["connect_timeout"] = 2
    options["options"] = f"{options.get('options', '')} -c statement_timeout=1000"
    with database.temporary_connection() as cursor:
        cursor.execute("SELECT 1")
        return cursor.fetchone() == (1,)


def redis_ready():
    if not settings.REDIS_URL:
        return False
    with Redis.from_url(
        settings.REDIS_URL,
        socket_connect_timeout=1,
        socket_timeout=1,
        retry=Retry(NoBackoff(), 0),
    ) as client:
        return client.ping() is True


@never_cache
@require_safe
def readiness(request):
    # Trust the actual socket peer, never client-supplied proxy headers.
    try:
        local = ip_address(request.META.get("REMOTE_ADDR", "")).is_loopback
    except ValueError:
        local = False
    if not local:
        return JsonResponse({"status": "forbidden"}, status=403)

    for name, check in (("database", database_ready), ("redis", redis_ready)):
        try:
            available = check()
        except Exception:  # Readiness must fail closed without exposing exception text.
            available = False
        if not available:
            logger.warning("Readiness dependency unavailable: %s", name)
            return JsonResponse({"status": "not_ready"}, status=503)
    return JsonResponse({"status": "ready"})
