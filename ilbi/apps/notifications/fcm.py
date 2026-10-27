"""FCM HTTP v1 transport. No business text, credentials or provider responses are logged."""

import json
import re
import threading
import time
from pathlib import Path

import jwt
import requests
from django.conf import settings


class PushTransportError(Exception):
    def __init__(self, code, *, invalid_token=False, retry_after=0):
        super().__init__(code)
        self.code = code
        self.invalid_token = invalid_token
        self.retry_after = retry_after


_lock = threading.Lock()
_cached = {"token": "", "expires": 0, "identity": ""}


def access_token():
    """Use existing PyJWT/cryptography dependencies for service-account OAuth2."""
    path = Path(settings.FCM_SERVICE_ACCOUNT_FILE)
    try:
        if not settings.FCM_SERVICE_ACCOUNT_FILE or not path.is_file() or path.stat().st_size > 65536:
            raise ValueError("credential_file")
        credentials = json.loads(path.read_text())
        if (
            not isinstance(credentials, dict)
            or credentials.get("type") != "service_account"
            or not isinstance(credentials.get("private_key"), str)
            or not isinstance(credentials.get("client_email"), str)
            or not credentials["client_email"].endswith(".gserviceaccount.com")
        ):
            raise ValueError("credential_identity")
        if credentials.get("project_id") != settings.FCM_PROJECT_ID:
            raise ValueError("credential_project")
    except (OSError, ValueError, TypeError) as error:
        raise PushTransportError("credentials_unavailable") from error
    identity = str(path.resolve()) + ":" + str(path.stat().st_mtime_ns)
    with _lock:
        if _cached["identity"] == identity and _cached["expires"] > time.time() + 60:
            return _cached["token"]
        now = int(time.time())
        try:
            assertion = jwt.encode(
                {
                    "iss": credentials["client_email"],
                    "scope": "https://www.googleapis.com/auth/firebase.messaging",
                    "aud": "https://oauth2.googleapis.com/token",
                    "iat": now,
                    "exp": now + 3600,
                },
                credentials["private_key"],
                algorithm="RS256",
            )
            response = requests.post(
                "https://oauth2.googleapis.com/token",
                data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion},
                timeout=(5, 15),
                allow_redirects=False,
            )
            body = response.json()
            if not isinstance(body, dict):
                raise PushTransportError("provider_auth")
            token = body.get("access_token")
            if response.status_code != 200 or not isinstance(token, str) or not token:
                raise PushTransportError("provider_auth")
            _cached.update(
                token=token, expires=now + min(3500, max(60, int(body.get("expires_in", 3600)))), identity=identity
            )
            return token
        except (requests.RequestException, ValueError, KeyError, jwt.PyJWTError) as error:
            raise PushTransportError("provider_auth") from error


def send_fcm(token, notification):
    if not re.fullmatch(r"[a-z][a-z0-9-]{4,61}[a-z0-9]", settings.FCM_PROJECT_ID):
        raise PushTransportError("project_unavailable")
    payload = {
        "message": {
            "token": token,
            "notification": {"title": "ILBI", "body": "Yangi bildirishnoma bor. Tafsilotlarni ilovada ko‘ring."},
            "data": {
                "kind": "ilbi_inbox",
                "notification_id": str(notification.pk),
                "recipient_id": str(notification.recipient_id),
                "tenant_id": str(notification.tenant_id),
            },
            "android": {
                "priority": "normal",
                "ttl": "86400s",
                "notification": {"channel_id": "ilbi-activity", "tag": "ilbi-" + str(notification.pk)},
            },
        }
    }
    try:
        response = requests.post(
            f"https://fcm.googleapis.com/v1/projects/{settings.FCM_PROJECT_ID}/messages:send",
            json=payload,
            headers={"Authorization": "Bearer " + access_token()},
            timeout=(5, 15),
            allow_redirects=False,
        )
        body = response.json()
    except (requests.RequestException, ValueError) as error:
        raise PushTransportError("provider_network") from error
    if not isinstance(body, dict):
        raise PushTransportError("provider_response")
    if response.status_code == 200 and isinstance(body.get("name"), str):
        return body["name"][:255]
    error = body.get("error")
    details = error.get("details", []) if isinstance(error, dict) else []
    codes = (
        {detail.get("errorCode") for detail in details if isinstance(detail, dict)}
        if isinstance(details, list)
        else set()
    )
    if "UNREGISTERED" in codes:
        raise PushTransportError("token_unregistered", invalid_token=True)
    retry_after = response.headers.get("Retry-After", "")
    delay = min(86400, int(retry_after)) if retry_after.isdigit() else 0
    raise PushTransportError("provider_rejected", retry_after=delay)
