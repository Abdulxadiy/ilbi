"""Real production cache in separate Python workers, against a disposable Redis.

Requires Docker and an existing redis:7-alpine image. No application DB is used.
Business handlers/membership checks are covered by the normal API tests; these
tests exercise real view dispatch, throttles, cache keys, expiry and HTTP 429.
"""

import json
import shutil
import subprocess
import time
import uuid

import pytest
import redis

from .test_production_settings import run

WORKER = """
import json, os
from unittest.mock import patch
import django
django.setup()
from django.contrib.auth import get_user_model
from django.db.backends.base.base import BaseDatabaseWrapper
from rest_framework.response import Response
from rest_framework.test import APIRequestFactory, force_authenticate
from api.permissions import IsActiveOwner
from api.v1.sales.views.sale_views import PublicReceiptDetailView
from api.v1.tenants.views import MyTenantsView

data = json.loads(os.environ['THROTTLE_TEST_INPUT'])
factory = APIRequestFactory()
is_receipt = data['kind'] == 'receipt'
view_class = PublicReceiptDetailView if is_receipt else MyTenantsView
method = data.get('method', 'get' if is_receipt else 'post')
user = get_user_model()(pk=data['actor'], username='synthetic-owner', role='owner') if not is_receipt else None
def business_handler(self, request, **kwargs):
    return Response({'synthetic': True}, status=201 if method == 'post' else 200)

statuses, retries, codes = [], [], []
with patch.object(BaseDatabaseWrapper, 'connect', side_effect=AssertionError('Test must not use a database')), \
     patch.object(view_class, method, business_handler), \
     patch.object(IsActiveOwner, 'has_permission', return_value=True), \
     patch('rest_framework.throttling.SimpleRateThrottle.timer', return_value=data['now']):
    view = view_class.as_view()
    for _ in range(data['count']):
        request = getattr(factory, method)(
            '/synthetic-throttle-test/', {}, format='json',
            HTTP_HOST='production.example', HTTP_X_FORWARDED_PROTO='https',
            REMOTE_ADDR='172.31.0.1', HTTP_X_FORWARDED_FOR=str(data['actor']),
        )
        if user is not None:
            force_authenticate(request, user=user)
        response = view(request, **({'token': 'synthetic-token'} if is_receipt else {}))
        statuses.append(response.status_code)
        retries.append(response.get('Retry-After'))
        codes.append(response.data.get('error', {}).get('code'))
print(json.dumps({'statuses': statuses, 'retries': retries, 'codes': codes}))
"""


def docker(*args):
    executable = shutil.which("docker")
    assert executable, "These integration tests require Docker."
    return subprocess.run(  # noqa: S603 -- fixed test commands, no shell or real secrets
        [executable, *args], capture_output=True, text=True, timeout=30, check=True
    ).stdout


@pytest.fixture(scope="module")
def isolated_redis():
    name = "ilbi-rate-limit-test-" + uuid.uuid4().hex[:16]
    docker("image", "inspect", "redis:7-alpine")  # Never download or use the application Redis.
    created = False
    client = None
    try:
        docker(
            "run",
            "--pull=never",
            "--detach",
            "--name",
            name,
            "--label",
            "io.ilbi.rate-limit-test=true",
            "--publish",
            "127.0.0.1::6379",
            "--tmpfs",
            "/data:rw,noexec,nosuid,size=16m",
            "--memory",
            "128m",
            "redis:7-alpine",
            "redis-server",
            "--save",
            "",
            "--appendonly",
            "no",
        )
        created = True
        info = json.loads(docker("inspect", name))[0]
        port = info["NetworkSettings"]["Ports"]["6379/tcp"][0]["HostPort"]
        url = f"redis://127.0.0.1:{port}/0"
        client = redis.Redis.from_url(url, socket_connect_timeout=0.5, socket_timeout=0.5)
        for _ in range(50):
            try:
                if client.ping():
                    break
            except redis.RedisError:
                pass
            time.sleep(0.1)
        else:
            pytest.fail("Disposable test Redis did not start.")
        yield url
    finally:
        if client is not None:
            client.close()
        if created:
            docker("rm", "--force", "--volumes", name)


def request_from_new_worker(url, *, kind, actor, count=1, now=2_000_000_000, **extra):
    result = run(
        WORKER,
        REDIS_URL=url,
        THROTTLE_TEST_INPUT=json.dumps({"kind": kind, "actor": actor, "count": count, "now": now, **extra}),
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


@pytest.mark.parametrize("kind,limit,duration", [("receipt", 60, 60), ("tenant", 5, 86400)])
def test_workers_share_existing_limits_and_recover_after_expiry(isolated_redis, kind, limit, duration):
    actor = (
        f"198.18.{uuid.uuid4().int % 256}.{uuid.uuid4().int % 256}" if kind == "receipt" else uuid.uuid4().int % 2**62
    )
    success = 200 if kind == "receipt" else 201
    first = request_from_new_worker(isolated_redis, kind=kind, actor=actor, count=limit)
    assert first["statuses"] == [success] * limit

    # New processes have no local history, and must still see the exhausted budget.
    for _ in range(2):
        blocked = request_from_new_worker(isolated_redis, kind=kind, actor=actor)
        assert blocked["statuses"] == [429]
        assert blocked["codes"] == ["throttled"]
        assert 0 < int(blocked["retries"][0]) <= duration

    other = "203.0.113.77" if kind == "receipt" else actor + 1
    assert request_from_new_worker(isolated_redis, kind=kind, actor=other)["statuses"] == [success]
    if kind == "tenant":
        # The daily creation budget must not prevent listing existing shops.
        assert request_from_new_worker(isolated_redis, kind=kind, actor=actor, method="get")["statuses"] == [200]
    renewed = request_from_new_worker(isolated_redis, kind=kind, actor=actor, now=2_000_000_000 + duration + 1)
    assert renewed["statuses"] == [success]


def test_default_support_and_login_keys_remain_separate(isolated_redis):
    marker = "synthetic-cache-" + uuid.uuid4().hex
    first = run(
        """
import django, os, redis
django.setup()
from django.conf import settings
from django.core.cache import cache, caches
marker = os.environ['CACHE_TEST_MARKER']
cache.set(marker, 'default-value', 60)
caches['support'].set(marker, 'support-value', 60)
redis.Redis.from_url(settings.REDIS_URL).set(marker, 'login-value', ex=60)
""",
        REDIS_URL=isolated_redis,
        CACHE_TEST_MARKER=marker,
    )
    assert first.returncode == 0, first.stderr
    second = run(
        """
import django, os, redis, json
django.setup()
from django.conf import settings
from django.core.cache import cache, caches
marker = os.environ['CACHE_TEST_MARKER']
print(json.dumps([cache.get(marker), caches['support'].get(marker),
                  redis.Redis.from_url(settings.REDIS_URL, decode_responses=True).get(marker)]))
""",
        REDIS_URL=isolated_redis,
        CACHE_TEST_MARKER=marker,
    )
    assert second.returncode == 0, second.stderr
    assert json.loads(second.stdout) == ["default-value", "support-value", "login-value"]


@pytest.mark.parametrize("module", ["config.settings", "config.settings_test"])
def test_default_cache_remains_local_outside_production(module):
    result = run(
        """
from django.conf import settings
from django.core.cache import cache
assert settings.CACHES['default']['BACKEND'] == 'django.core.cache.backends.locmem.LocMemCache'
cache.set('synthetic-local-only', 'value')
assert cache.get('synthetic-local-only') == 'value'
""",
        DJANGO_SETTINGS_MODULE=module,
        REDIS_URL="redis://127.0.0.1:1/0",  # The local cache must work without Redis.
    )
    assert result.returncode == 0, result.stderr


def test_production_does_not_allow_local_cache_fallback_when_redis_is_down():
    result = run("""
from django.core.cache import cache
from redis.exceptions import ConnectionError, TimeoutError
try:
    cache.get('synthetic-unavailable-redis')
except (ConnectionError, TimeoutError):
    pass
else:
    raise AssertionError('Production must not silently fall back to local counters')
""")
    assert result.returncode == 0, result.stderr
