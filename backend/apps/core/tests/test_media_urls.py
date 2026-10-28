import pytest

from apps.core.media_urls import public_media_url


@pytest.mark.parametrize("host", ["ilbi", "inventra", "nginx", "ilbi:8000", "inventra:8000"])
def test_internal_media_hosts_and_ports_become_relative(host):
    assert public_media_url(f"https://{host}/media/a.png?width=10#preview") == "/media/a.png?width=10#preview"


@pytest.mark.parametrize("value", [
    "https://ilbi.uz/media/a.png", "https://inventra.example/media/a.png",
    "https://ilbi.example.com/media/a.png", "/media/a.png", "", None,
])
def test_public_hosts_and_existing_relative_urls_are_preserved(value):
    assert public_media_url(value) == value
