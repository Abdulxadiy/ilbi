"""Exercise version checks with genuinely signed JWTs and the real HTTP endpoints."""

import pytest
from api.v1.accounts.views.misc import issue_tokens
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken
from tests.factories import OwnerFactory

pytestmark = pytest.mark.django_db

PROFILE = "/api/v1/auth/profile/"
REFRESH = "/api/v1/auth/token/refresh/"


def token_request(kind, encoded):
    client = APIClient()
    if kind == "access":
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {encoded}")
        return client.get(PROFILE)
    return client.post(REFRESH, {"refresh": encoded}, format="json")


@pytest.mark.parametrize("kind", ["access", "refresh"])
@pytest.mark.parametrize(
    "claims,account_version",
    [
        pytest.param({}, 1, id="missing"),
        pytest.param({"token_version": None}, 1, id="null"),
        pytest.param({"token_version": True}, 1, id="boolean-true"),
        pytest.param({"token_version": False}, 0, id="boolean-false"),
        pytest.param({"token_version": 1.0}, 1, id="float"),
        pytest.param({"token_version": "1"}, 1, id="string"),
        pytest.param({"token_version": [1]}, 1, id="list"),
        pytest.param({"token_version": {"value": 1}}, 1, id="object"),
        pytest.param({"token_version": 0}, 1, id="stale"),
        pytest.param({"token_version": -1}, 1, id="negative"),
        pytest.param({"token_version": 2}, 1, id="future"),
    ],
)
def test_access_and_refresh_reject_missing_malformed_and_mismatched_versions(kind, claims, account_version):
    user = OwnerFactory(token_version=account_version)
    token_class = AccessToken if kind == "access" else RefreshToken
    token = token_class(issue_tokens(user)[kind])
    del token["token_version"]
    token.payload.update(claims)
    # Re-sign the modified payload, so signature rejection cannot mask a broken version check.
    response = token_request(kind, str(token))
    assert response.status_code == 401
    assert "access" not in response.data


@pytest.mark.parametrize("account_version", [0, 1, 5])
def test_current_integer_versions_work_for_access_and_refresh(account_version):
    user = OwnerFactory(token_version=account_version)
    tokens = issue_tokens(user)
    assert token_request("access", tokens["access"]).status_code == 200
    response = token_request("refresh", tokens["refresh"])
    assert response.status_code == 200
    renewed = response.data["access"]
    assert type(AccessToken(renewed)["token_version"]) is int
    assert AccessToken(renewed)["token_version"] == account_version
    assert token_request("access", renewed).status_code == 200


@pytest.mark.parametrize("kind", ["access", "refresh"])
@pytest.mark.parametrize("state", ["inactive", "deleted"])
def test_current_version_does_not_allow_an_inactive_or_deleted_account(kind, state):
    user = OwnerFactory()
    token = issue_tokens(user)[kind]
    if state == "inactive":
        user.is_active = False
        user.save(update_fields=["is_active"])
    else:
        user.delete()
    assert token_request(kind, token).status_code == 401


def test_real_password_change_revokes_old_and_versionless_tokens_and_new_tokens_work():
    user = OwnerFactory(password="BeforeChangeSynthetic785!")
    previous_version = user.token_version
    old = issue_tokens(user)
    legacy_access = AccessToken(old["access"])
    legacy_refresh = RefreshToken(old["refresh"])
    del legacy_access["token_version"]
    del legacy_refresh["token_version"]
    assert token_request("access", old["access"]).status_code == 200

    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {old['access']}")
    response = client.post(
        "/api/v1/auth/change-password/",
        {"old_password": "BeforeChangeSynthetic785!", "new_password": "AfterChangeSynthetic936!"},
        format="json",
    )
    assert response.status_code == 200
    user.refresh_from_db()
    assert user.token_version == previous_version + 1
    assert user.check_password("AfterChangeSynthetic936!")
    for kind, token in (
        ("access", old["access"]),
        ("refresh", old["refresh"]),
        ("access", str(legacy_access)),
        ("refresh", str(legacy_refresh)),
    ):
        assert token_request(kind, token).status_code == 401

    fresh = issue_tokens(user)
    assert token_request("access", fresh["access"]).status_code == 200
    renewed = token_request("refresh", fresh["refresh"])
    assert renewed.status_code == 200
    assert AccessToken(renewed.data["access"])["token_version"] == user.token_version
    assert token_request("access", renewed.data["access"]).status_code == 200
