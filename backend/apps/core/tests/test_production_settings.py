"""Exercise production settings in fresh processes, without a live DB or real secrets."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
TEST_KEY = "isolated-production-settings-tests-only-ae9d58022e12d4e97d3357c8"


def production_env(**overrides):
    return {
        "PATH": os.environ["PATH"],
        "PYTHONDONTWRITEBYTECODE": "1",
        "DJANGO_SETTINGS_MODULE": "config.settings_production",
        "DJANGO_SECRET_KEY": TEST_KEY,
        "ALLOWED_HOSTS": "production.example,ilbi",
        "FRONTEND_URL": "https://production.example",
        "REDIS_URL": "redis://127.0.0.1:1/0",  # Settings-only checks never connect.
        **overrides,
    }


def run(code, **overrides):
    return subprocess.run(  # noqa: S603
        [sys.executable, "-B", "-c", code],
        cwd=ROOT,
        env=production_env(**overrides),
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )


def inspect_settings(**overrides):
    result = run(
        "from django.conf import settings; import json; "
        "print(json.dumps({name:getattr(settings,name) for name in "
        "['DEBUG','LOCAL_DEMO_LOGIN_ENABLED','SECURE_SSL_REDIRECT','SECURE_SSL_HOST',"
        "'SECURE_PROXY_SSL_HEADER','SESSION_COOKIE_SECURE','CSRF_COOKIE_SECURE',"
        "'CSRF_TRUSTED_ORIGINS','SECURE_HSTS_SECONDS','SECURE_HSTS_INCLUDE_SUBDOMAINS',"
        "'SECURE_HSTS_PRELOAD','EMAIL_HOST_USER','REDIS_URL','CACHES']}))",
        **overrides,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_production_security_and_no_local_dotenv_fallback():
    values = inspect_settings()
    assert values["DEBUG"] is values["LOCAL_DEMO_LOGIN_ENABLED"] is False
    assert values["SECURE_SSL_REDIRECT"] is True
    assert values["SESSION_COOKIE_SECURE"] is values["CSRF_COOKIE_SECURE"] is True
    assert values["SECURE_SSL_HOST"] == "production.example"
    assert values["SECURE_PROXY_SSL_HEADER"] == ["HTTP_X_FORWARDED_PROTO", "https"]
    assert values["CSRF_TRUSTED_ORIGINS"] == ["https://production.example"]
    assert values["SECURE_HSTS_SECONDS"] == 3600
    assert values["SECURE_HSTS_INCLUDE_SUBDOMAINS"] is values["SECURE_HSTS_PRELOAD"] is False
    # A developer's actual .env must never fill missing production values.
    assert values["EMAIL_HOST_USER"] == ""
    assert values["REDIS_URL"] == "redis://127.0.0.1:1/0"
    assert values["CACHES"]["default"]["BACKEND"] == "django.core.cache.backends.redis.RedisCache"
    assert values["CACHES"]["default"]["LOCATION"] == values["REDIS_URL"]
    assert values["CACHES"]["default"]["KEY_PREFIX"] != values["CACHES"]["support"]["KEY_PREFIX"]


@pytest.mark.parametrize(
    "overrides,field",
    [
        ({"DJANGO_DEBUG": "True"}, "DJANGO_DEBUG"),
        ({"LOCAL_DEMO_LOGIN_ENABLED": "True"}, "LOCAL_DEMO_LOGIN_ENABLED"),
        ({"DJANGO_SECRET_KEY": ""}, "DJANGO_SECRET_KEY"),
        ({"ALLOWED_HOSTS": "*"}, "ALLOWED_HOSTS"),
        ({"ALLOWED_HOSTS": ".example"}, "ALLOWED_HOSTS"),
        ({"ALLOWED_HOSTS": "ilbi"}, "ALLOWED_HOSTS"),
        ({"FRONTEND_URL": "http://production.example"}, "FRONTEND_URL"),
        ({"FRONTEND_URL": "https://user:password@production.example"}, "FRONTEND_URL"),
        ({"FRONTEND_URL": "https://production.example/app"}, "FRONTEND_URL"),
        ({"FRONTEND_URL": "https://production.example?next=somewhere"}, "FRONTEND_URL"),
        ({"FRONTEND_URL": "https://production.example:wrong"}, "FRONTEND_URL"),
        ({"SECURE_HSTS_SECONDS": "invalid"}, "SECURE_HSTS_SECONDS"),
        ({"SECURE_HSTS_SECONDS": "0"}, "SECURE_HSTS_SECONDS"),
        ({"SECURE_HSTS_SECONDS": "-1"}, "SECURE_HSTS_SECONDS"),
        ({"REDIS_URL": ""}, "REDIS_URL"),
        ({"REDIS_URL": "http://redis:6379/0"}, "REDIS_URL"),
        ({"REDIS_URL": "redis:///0"}, "REDIS_URL"),
        ({"REDIS_URL": "redis://redis:wrong/0"}, "REDIS_URL"),
        ({"REDIS_URL": "redis://redis:0/0"}, "REDIS_URL"),
        ({"REDIS_URL": "redis://synthetic-user:synthetic-private-value@redis:wrong/0"}, "REDIS_URL"),
    ],
)
def test_invalid_production_configuration_fails_before_startup(overrides, field):
    result = run("from django.conf import settings; print(settings.DEBUG)", **overrides)
    assert result.returncode != 0
    assert "ImproperlyConfigured" in result.stderr
    assert field in result.stderr
    assert "synthetic-private-value" not in result.stderr


def test_https_is_not_redirected_and_private_internal_http_remains_usable():
    result = run("""
import django, json
django.setup()
from django.http import HttpResponse
from django.middleware.security import SecurityMiddleware
from django.test import RequestFactory
factory = RequestFactory()
middleware = SecurityMiddleware(lambda request: HttpResponse('ready'))
results = {}
for label, path, headers in [
    ('public_http', '/api/v1/auth/profile/', {}),
    ('public_https', '/api/v1/auth/profile/', {'HTTP_X_FORWARDED_PROTO':'https'}),
    ('private_internal', '/api/v1/internal/telegram/register/', {}),
    ('similar_public_path', '/api/v1/internal-other/', {}),
]:
    response = middleware(factory.get(path, HTTP_HOST='ilbi', **headers))
    results[label] = {'status':response.status_code, 'location':response.get('Location'),
                      'hsts':response.get('Strict-Transport-Security')}
print(json.dumps(results))
""")
    assert result.returncode == 0, result.stderr
    values = json.loads(result.stdout)
    assert values["public_http"]["status"] == 301
    assert values["public_http"]["location"] == "https://production.example/api/v1/auth/profile/"
    assert values["public_https"]["status"] == 200
    assert values["public_https"]["hsts"] == "max-age=3600"
    assert values["private_internal"]["status"] == 200
    assert values["similar_public_path"]["status"] == 301


def test_real_https_responses_set_secure_cookies():
    result = run("""
import django, json
django.setup()
from django.http import HttpResponse
from django.middleware.csrf import CsrfViewMiddleware, get_token
from django.middleware.security import SecurityMiddleware
from django.contrib.sessions.middleware import SessionMiddleware
from django.test import RequestFactory, override_settings
def view(request):
    request.session['fixture'] = 'isolated-test'
    get_token(request)
    return HttpResponse('ready')
with override_settings(SESSION_ENGINE='django.contrib.sessions.backends.signed_cookies'):
    handler=SecurityMiddleware(SessionMiddleware(CsrfViewMiddleware(view)))
    response=handler(RequestFactory().get('/', HTTP_HOST='production.example', HTTP_X_FORWARDED_PROTO='https'))
    print(json.dumps({name:bool(response.cookies[name]['secure']) for name in ['sessionid','csrftoken']}))
""")
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {"sessionid": True, "csrftoken": True}


@pytest.mark.parametrize(
    "module,requested,expected",
    [
        ("config.settings_production", "true", False),
        ("config.settings_production", "false", False),
        ("config.settings", "true", True),
        ("config.settings", "false", False),
    ],
)
def test_gunicorn_reload_is_only_available_in_development(module, requested, expected):
    result = run(
        "import json,runpy; print(json.dumps(runpy.run_path('gunicorn.conf.py')['reload']))",
        DJANGO_SETTINGS_MODULE=module,
        GUNICORN_RELOAD=requested,
        GUNICORN_WORKER_CLASS="sync",
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) is expected
