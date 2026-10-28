"""Production docs are absent; development UI and offline schemas still work."""

import json

import pytest

from .test_production_settings import run

BOOTSTRAP = """
from unittest.mock import patch
with patch('dotenv.load_dotenv', return_value=False):
    import django
    django.setup()
"""


def test_production_technical_docs_are_404_without_accessing_database_or_redis():
    result = run(
        BOOTSTRAP
        + """
import json
from django.db.backends.base.base import BaseDatabaseWrapper
from django.test import Client
from django.urls import resolve
from redis import Redis
client = Client(HTTP_HOST='production.example', HTTP_X_FORWARDED_PROTO='https')
with patch.object(BaseDatabaseWrapper, 'connect', side_effect=AssertionError('No database access')), \
     patch.object(Redis, 'execute_command', side_effect=AssertionError('No Redis access')):
    results = {path: client.get(path).status_code for path in (
        '/api/schema/', '/api/docs/', '/api/redoc/',
        '/api/schema/?format=json', '/api/docs', '/api/redoc', '/api/schema',
    )}
    # Product help, support, health and business routes remain registered.
    for path in ('/api/v1/docs/', '/api/v1/support/metadata/',
                 '/api/v1/internal/health/ready/', '/api/v1/tenants/my/'):
        assert resolve(path)
print(json.dumps(results))
"""
    )
    assert result.returncode == 0, result.stderr
    assert set(json.loads(result.stdout).values()) == {404}


@pytest.mark.parametrize("module", ["config.settings", "config.settings_test"])
def test_development_and_test_keep_technical_docs(module):
    result = run(
        BOOTSTRAP
        + """
from django.db.backends.base.base import BaseDatabaseWrapper
from django.test import Client
from django.urls import resolve, reverse
from redis import Redis
client = Client(HTTP_HOST='localhost')
with patch.object(BaseDatabaseWrapper, 'connect', side_effect=AssertionError('No database access')), \
     patch.object(Redis, 'execute_command', side_effect=AssertionError('No Redis access')):
    assert reverse('schema') == '/api/schema/'
    assert resolve('/api/schema/').url_name == 'schema'
    for path, marker in (('/api/docs/', b'swagger-ui'), ('/api/redoc/', b'redoc')):
        response = client.get(path)
        assert response.status_code == 200, (path, response.status_code)
        assert marker in response.content.lower()
""",
        DJANGO_SETTINGS_MODULE=module,
        ALLOWED_HOSTS="localhost,127.0.0.1,ilbi",
    )
    assert result.returncode == 0, result.stderr


def test_production_offline_openapi_generation_still_validates():
    result = run(
        BOOTSTRAP
        + """
import io, json
from django.core.management import call_command
from django.db.backends.base.base import BaseDatabaseWrapper
from redis import Redis
output = io.StringIO()
with patch.object(BaseDatabaseWrapper, 'connect', side_effect=AssertionError('No database access')), \
     patch.object(Redis, 'execute_command', side_effect=AssertionError('No Redis access')):
    call_command('spectacular', format='openapi-json', validate=True, fail_on_warn=True, stdout=output)
schema = json.loads(output.getvalue())
assert schema['openapi'] and schema['paths']
assert '/api/v1/tenants/my/' in schema['paths']
for path in ('/api/schema/', '/api/docs/', '/api/redoc/', '/api/v1/internal/health/ready/'):
    assert path not in schema['paths']
print('validated')
"""
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "validated"
