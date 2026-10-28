import json
from unittest.mock import Mock, patch

import pytest
import requests
from django.http import HttpResponse
from django.test import RequestFactory, override_settings

from apps.desktop_sync.middleware import DesktopMiddleware
from apps.desktop_sync.server_policy import OFFICIAL_SERVER


@override_settings(DESKTOP_BRIDGE_KEY="synthetic-bridge", DESKTOP_SERVER=OFFICIAL_SERVER)
@pytest.mark.parametrize("method", ["GET", "POST", "PATCH", "PUT", "DELETE"])
def test_online_actions_do_not_require_or_write_an_offline_database(method):
    request = RequestFactory().generic(
        method,
        "/api/v1/catalog/categories/?page=2",
        b'{"name":"synthetic"}',
        content_type="application/json",
        HTTP_X_ILBI_DESKTOP_KEY="synthetic-bridge",
        HTTP_X_ILBI_CLOUD_SESSION="true",
        HTTP_AUTHORIZATION="Bearer online-user-token",
        HTTP_X_TENANT_ID="7",
        HTTP_IDEMPOTENCY_KEY="synthetic-operation",
    )
    remote = Mock(status_code=201, content=b'{"id":71}', headers={"Content-Type": "application/json"})
    with (
        patch("apps.desktop_sync.middleware.get_state") as state,
        patch("apps.desktop_sync.middleware.enqueue") as enqueue,
        patch("apps.desktop_sync.middleware.requests.request", return_value=remote) as send,
    ):
        response = DesktopMiddleware(lambda _: pytest.fail("Online action reached local business views"))(request)
    assert response.status_code == 201
    state.assert_not_called()
    enqueue.assert_not_called()
    assert send.call_args.args == (method, OFFICIAL_SERVER + "/api/v1/catalog/categories/?page=2")
    options = send.call_args.kwargs
    assert options["data"] == request.body
    assert options["headers"]["Authorization"] == "Bearer online-user-token"
    assert options["headers"]["X-Tenant-Id"] == "7"
    assert options["headers"]["Idempotency-Key"] == "synthetic-operation"
    assert options["allow_redirects"] is False
    assert "X-Ilbi-Desktop-Key" not in options["headers"]


@override_settings(DESKTOP_BRIDGE_KEY="synthetic-bridge", DESKTOP_SERVER=OFFICIAL_SERVER)
def test_online_network_errors_do_not_force_enrollment_or_queue_an_action():
    request = RequestFactory().post(
        "/api/v1/catalog/categories/", {}, HTTP_X_ILBI_DESKTOP_KEY="synthetic-bridge", HTTP_X_ILBI_CLOUD_SESSION="true"
    )
    with (
        patch("apps.desktop_sync.middleware.requests.request", side_effect=requests.ConnectionError),
        patch("apps.desktop_sync.middleware.enqueue") as enqueue,
    ):
        response = DesktopMiddleware(lambda _: None)(request)
    assert response.status_code == 503
    assert "Internetga ulanib" in json.loads(response.content)["detail"]
    enqueue.assert_not_called()


@override_settings(DESKTOP_BRIDGE_KEY="synthetic-bridge", DESKTOP_SERVER=OFFICIAL_SERVER)
def test_uncached_online_media_comes_from_cloud_but_offline_cached_media_stays_local():
    request = RequestFactory().get(
        "/media/catalog/synthetic.png", HTTP_X_ILBI_DESKTOP_KEY="synthetic-bridge", HTTP_RANGE="bytes=0-1"
    )
    remote = Mock(
        status_code=206, content=b"\x89P", headers={"Content-Type": "image/png", "Content-Range": "bytes 0-1/100"}
    )
    with (
        patch("apps.desktop_sync.middleware.requests.request", return_value=remote) as send,
        patch("apps.desktop_sync.middleware.get_state", return_value=None),
    ):
        response = DesktopMiddleware(lambda _: HttpResponse(status=404))(request)
        assert response.status_code == 206
        assert response.content == b"\x89P"
        assert response["Content-Range"] == "bytes 0-1/100"
        assert send.call_args.args[1] == OFFICIAL_SERVER + "/media/catalog/synthetic.png"
        send.reset_mock()
        with (
            patch("apps.desktop_sync.middleware.get_state", return_value={"device_id": "synthetic"}),
            patch("apps.desktop_sync.middleware.authenticated"),
        ):
            assert DesktopMiddleware(lambda _: HttpResponse(b"cached"))(request).content == b"cached"
        send.assert_not_called()


@override_settings(DESKTOP_BRIDGE_KEY="synthetic-bridge", DESKTOP_SERVER=OFFICIAL_SERVER)
def test_locked_register_cannot_read_store_media():
    from apps.desktop_sync.security import DesktopLocked

    request = RequestFactory().get("/media/private.png", HTTP_X_ILBI_DESKTOP_KEY="synthetic-bridge")
    with (
        patch("apps.desktop_sync.middleware.get_state", return_value={"device_id": "synthetic"}),
        patch("apps.desktop_sync.middleware.authenticated", side_effect=DesktopLocked()),
    ):
        response = DesktopMiddleware(lambda _: pytest.fail("Locked media reached the filesystem"))(request)
    assert response.status_code == 423
