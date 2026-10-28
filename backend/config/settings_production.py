"""HTTPS production settings. Select explicitly with DJANGO_SETTINGS_MODULE."""

import os
import re
from urllib.parse import urlsplit

from django.core.exceptions import ImproperlyConfigured

from . import settings as base
from .settings import *  # noqa: F401,F403

if base.DEBUG or base.LOCAL_DEMO_LOGIN_ENABLED:
    raise ImproperlyConfigured("Production requires DJANGO_DEBUG=False and LOCAL_DEMO_LOGIN_ENABLED=False.")

DEBUG = False
LOCAL_DEMO_LOGIN_ENABLED = False
# Keep technical schema/UI routes out of the production URL configuration.
# Offline schema generation still uses REST_FRAMEWORK/DRF spectacular normally.
API_DOCS_ENABLED = False
ALLOWED_HOSTS = base.ALLOWED_HOSTS
if any(host == "*" or host.startswith(".") for host in ALLOWED_HOSTS):
    raise ImproperlyConfigured("Production ALLOWED_HOSTS must contain exact hostnames, without wildcards.")

FRONTEND_URL = base.FRONTEND_URL.rstrip("/")
try:
    public_url = urlsplit(FRONTEND_URL)
    valid_url = (
        public_url.scheme == "https"
        and public_url.hostname
        and re.fullmatch(r"[a-z0-9.-]+", public_url.hostname)
        and "." in public_url.hostname
        and public_url.port in (None, 443)
        and not public_url.username
        and not public_url.password
        and not public_url.path
        and not public_url.query
        and not public_url.fragment
    )
except ValueError:
    valid_url = False
if not valid_url:
    raise ImproperlyConfigured("Production FRONTEND_URL must be an HTTPS origin, e.g. https://ilbi.uz.")
if public_url.hostname not in ALLOWED_HOSTS:
    raise ImproperlyConfigured("The FRONTEND_URL hostname must be explicitly listed in ALLOWED_HOSTS.")

# DRF's default cache must be shared by all Gunicorn workers and replicas.
# Require an explicit URL: production must never fall back to process-local counters.
try:
    redis_url = urlsplit(base.REDIS_URL or "")
    valid_redis_url = (
        redis_url.scheme in ("redis", "rediss")
        and redis_url.hostname
        and (redis_url.port is None or 1 <= redis_url.port <= 65535)
    )
except ValueError:
    valid_redis_url = False
if not valid_redis_url:
    raise ImproperlyConfigured("Production requires REDIS_URL with a redis:// or rediss:// server URL.")

CACHES = {
    **base.CACHES,
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": base.REDIS_URL,
        "KEY_PREFIX": f"ilbi:{public_url.hostname}:production",
        "OPTIONS": {"socket_connect_timeout": 2, "socket_timeout": 2},
    },
}

SECURE_SSL_REDIRECT = True
SECURE_SSL_HOST = public_url.netloc
# Only the private Docker network can reach Django. The TLS edge overwrites this header.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = False
# Authenticated service-to-service calls stay private HTTP; the edge blocks this prefix.
SECURE_REDIRECT_EXEMPT = [r"^api/v1/internal/"]
CSRF_TRUSTED_ORIGINS = [f"https://{public_url.netloc}"]
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SECURE_CONTENT_TYPE_NOSNIFF = True

try:
    SECURE_HSTS_SECONDS = int(os.environ.get("SECURE_HSTS_SECONDS", "3600"))
except ValueError as exc:
    raise ImproperlyConfigured("SECURE_HSTS_SECONDS must be a positive integer.") from exc
if SECURE_HSTS_SECONDS <= 0:
    raise ImproperlyConfigured("SECURE_HSTS_SECONDS must be a positive integer.")
# Subdomains and browser preload require a separate domain-wide deployment decision.
SECURE_HSTS_INCLUDE_SUBDOMAINS = False
SECURE_HSTS_PRELOAD = False
