"""Untrusted destinations must be rejected before any credentials leave the app."""

import json
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import Mock, patch

import pytest
from django.test import RequestFactory, override_settings

from apps.desktop_sync.desktop_api import endpoint
from apps.desktop_sync.middleware import DesktopMiddleware
from apps.desktop_sync.server_policy import OFFICIAL_SERVER, server_url
from apps.desktop_sync.transport import Vault, cloud_request


@pytest.mark.parametrize(
    "value",
    [
        None,
        {},
        "https://retired.example",
        "https://evil.example",
        "http://127.0.0.1:8000",
        "http://ilbi.uz",
        "https://ilbi.uz.evil.example",
        "https://ilbi.uz@evil.example",
        "https://user:password@ilbi.uz",
        "https://ilbi.uz:8443",
        "https://ilbi.uz./",
        "https://ilbi.uz/path",
        "https://ilbi.uz/?server=evil",
        "https://ilbi.uz/#evil",
    ],
)
def test_unapproved_destinations_are_rejected(value):
    with pytest.raises(ValueError, match="rasmiy ILBI"):
        server_url(value)


def test_official_origin_matches_electron_policy():
    assert server_url(OFFICIAL_SERVER + "/") == OFFICIAL_SERVER
    source = Path(__file__).resolve().parents[4] / "desktop/ilbi/runtime.cjs"
    assert f"const OFFICIAL_SERVER = '{OFFICIAL_SERVER}';" in source.read_text()


def test_previous_encrypted_vault_migrates_without_losing_credentials(tmp_path, monkeypatch):
    from cryptography.fernet import Fernet

    monkeypatch.setenv("ILBI_DESKTOP_VAULT_KEY", Fernet.generate_key().decode())
    stored = {
        "server": "https://new-dev.site", "primary_user": 1,
        "access": "private-access", "refresh": "private-refresh", "grant_key": "private-grant",
        "actors": {"1": {"server": "https://new-dev.site", "access": "actor-access"}},
    }
    with override_settings(DESKTOP_DATA_DIR=str(tmp_path)):
        vault = Vault()
        vault.write(stored)
        updated = vault.read()
        assert updated == {**stored, "server": OFFICIAL_SERVER,
                           "actors": {"1": {"server": OFFICIAL_SERVER, "access": "actor-access"}}}
        assert vault.read() == updated
        assert (vault.path.stat().st_mode & 0o777) == 0o600
    with pytest.raises(ValueError):
        server_url("https://new-dev.site")


@override_settings(DESKTOP_SERVER="https://evil.example")
def test_altered_login_destination_never_receives_a_password():
    request = RequestFactory().post(
        "/api/v1/auth/token/", {"username": "example", "password": "private"}, content_type="application/json"
    )
    with patch("apps.desktop_sync.middleware.requests.request") as send:
        response = DesktopMiddleware(lambda _: None).proxy(request, "auth/token/")
    assert response.status_code == 503
    assert "rasmiy ILBI" in json.loads(response.content)["detail"]
    send.assert_not_called()


@override_settings(DESKTOP_SERVER="https://evil.example")
@pytest.mark.parametrize("path", ["releases/", "enroll/", "actor/", "reconnect/"])
def test_altered_destination_cannot_receive_enrollment_or_release_requests(path):
    factory = RequestFactory()
    request = (
        factory.get("/desktop/" + path)
        if path == "releases/"
        else factory.post("/desktop/" + path, {"pin": "private-pin"}, content_type="application/json")
    )
    with (
        patch("apps.desktop_sync.desktop_api.get_state", return_value=None),
        patch("apps.desktop_sync.desktop_api.requests.get") as get,
        patch("apps.desktop_sync.desktop_api.requests.post") as post,
    ):
        response = endpoint(request, path)
    assert response.status_code == 400
    get.assert_not_called()
    post.assert_not_called()


def test_altered_credential_vault_cannot_send_access_or_refresh_tokens():
    stored = {"server": "https://evil.example", "access": "private-access", "refresh": "private-refresh"}
    with (
        patch("apps.desktop_sync.transport.Vault") as vault,
        patch("apps.desktop_sync.transport.requests.request") as send,
        patch("apps.desktop_sync.transport.requests.post") as refresh,
    ):
        vault.return_value.read.return_value = stored
        with pytest.raises(ValueError, match="rasmiy ILBI"):
            cloud_request("POST", "sync/operations/", body={"private": "store data"})
    send.assert_not_called()
    refresh.assert_not_called()


def test_cloud_token_refresh_keeps_the_pinned_origin_and_refuses_redirects():
    stored = {"server": OFFICIAL_SERVER, "primary_user": 1, "access": "old", "refresh": "private-refresh"}
    with (
        patch("apps.desktop_sync.transport.Vault") as vault,
        patch(
            "apps.desktop_sync.transport.requests.request", side_effect=[Mock(status_code=401), Mock(status_code=200)]
        ) as send,
        patch("apps.desktop_sync.transport.requests.post") as refresh,
    ):
        vault.return_value.read.return_value = stored
        refresh.return_value.ok = True
        refresh.return_value.json.return_value = {"access": "new", "refresh": "new-refresh"}
        assert cloud_request("GET", "sync/changes/").status_code == 200
    refresh.assert_called_once_with(
        OFFICIAL_SERVER + "/api/v1/auth/token/refresh/",
        json={"refresh": "private-refresh"},
        timeout=(5, 20),
        allow_redirects=False,
    )
    assert len(send.call_args_list) == 2
    for call in send.call_args_list:
        assert call.args[1] == OFFICIAL_SERVER + "/api/v1/sync/changes/"
        assert call.kwargs["allow_redirects"] is False


def test_packaged_settings_ignore_an_environment_server_override(tmp_path):
    environment = {
        **os.environ,
        "ILBI_DESKTOP_SERVER": "https://evil.example",
        "ILBI_DESKTOP_SECRET": "disposable-policy-test-secret",
        "ILBI_DESKTOP_DATA": str(tmp_path),
        "ILBI_DESKTOP_BRIDGE_KEY": "disposable-key",
        "ILBI_DESKTOP_DB_PASSWORD": "disposable-password",
        "ILBI_DESKTOP_DB_PORT": "1",
    }
    result = subprocess.run(
        [sys.executable, "-c", "from config.settings_desktop import DESKTOP_SERVER; print(DESKTOP_SERVER)"],
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )
    assert result.stdout.strip() == OFFICIAL_SERVER
