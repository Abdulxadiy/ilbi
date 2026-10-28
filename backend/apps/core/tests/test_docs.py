import pytest
from rest_framework.test import APIClient
from rest_framework import status

pytestmark = pytest.mark.django_db


def test_openapi_schema_endpoint():
    client = APIClient()
    response = client.get('/api/schema/')
    assert response.status_code == status.HTTP_200_OK
    assert 'openapi' in response.data or 'paths' in response.data


def test_swagger_ui_endpoint():
    client = APIClient()
    response = client.get('/api/docs/')
    assert response.status_code == status.HTTP_200_OK
    assert b"swagger-ui" in response.content.lower()


def test_redoc_ui_endpoint():
    client = APIClient()
    response = client.get('/api/redoc/')
    assert response.status_code == status.HTTP_200_OK
    assert b"redoc" in response.content.lower()
