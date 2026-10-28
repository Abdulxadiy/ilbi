import pytest
from django.test import override_settings


@pytest.fixture(autouse=True)
def local_nonfiscal_sales_sandbox():
    """Sales service tests model local development, never production fiscality."""
    with override_settings(DEBUG=True):
        yield
