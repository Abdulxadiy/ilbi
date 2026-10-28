"""Bounded HTTPS transport; a completed upload is distinct from cloud acceptance."""

import json
import os
import threading
from pathlib import Path

import requests
from cryptography.fernet import Fernet
from django.conf import settings
from django.core.serializers.json import DjangoJSONEncoder

from .local import activity
from .server_policy import migrate_stored_server, server_url  # noqa: F401 -- retained for existing transport imports


class Vault:
    lock = threading.RLock()

    def __init__(self):
        self.path = Path(settings.DESKTOP_DATA_DIR) / "cloud.credentials"
        self.cipher = Fernet(os.environ["ILBI_DESKTOP_VAULT_KEY"].encode())

    def read(self):
        with self.lock:
            if not self.path.exists():
                return {}
            stored = json.loads(self.cipher.decrypt(self.path.read_bytes()))
            if stored.get("server"):
                server = migrate_stored_server(stored["server"])
                if server != stored["server"]:
                    stored["server"] = server
                    for actor in stored.get("actors", {}).values():
                        if "server" in actor:
                            actor["server"] = migrate_stored_server(actor["server"])
                    self.write(stored)
            return stored

    def write(self, value):
        with self.lock:
            temporary = self.path.with_suffix(".new")
            temporary.write_bytes(self.cipher.encrypt(json.dumps(value).encode()))
            temporary.chmod(0o600)
            temporary.replace(self.path)

    def put_user(self, user_id, value, primary=False):
        with self.lock:
            current = self.read()
            current.setdefault("actors", {})[str(user_id)] = value
            current["server"] = value["server"]
            if primary:
                current.update(value)
                current["primary_user"] = user_id
            self.write(current)

    def put_grant_key(self, key):
        with self.lock:
            current = self.read()
            current["grant_key"] = key
            self.write(current)

    def set_denied(self, denied):
        with self.lock:
            current = self.read()
            current["security_denied"] = bool(denied)
            self.write(current)

    def mfa_cookies(self, register):
        return self.read().get("mfa_cookies", {}).get(register, {})

    def remember_mfa_cookies(self, register, cookies):
        from apps.accounts.services.daily_mfa import COOKIE_PREFIX

        values = {cookie.name: cookie.value for cookie in cookies if cookie.name.startswith(COOKIE_PREFIX)}
        if not values:
            return
        with self.lock:
            current = self.read()
            current.setdefault("mfa_cookies", {}).setdefault(register, {}).update(values)
            self.write(current)


class UploadBody:
    def __init__(self, data):
        self.data = data

    def __len__(self):
        return len(self.data)

    def __iter__(self):
        for offset in range(0, len(self.data), 32768):
            chunk = self.data[offset : offset + 32768]
            activity["progress"] = round(min(len(self.data), offset + len(chunk)) / len(self.data) * 100)
            yield chunk
        activity["stage"] = "confirming"


def cloud_request(method, path, *, body=None, progress=False, headers=None, user_id=None, raw=None):
    vault = Vault()
    stored = vault.read()
    actor_id = stored.get("primary_user") if user_id is None else user_id
    credentials = (
        dict(stored.get("actors", {})[str(user_id)])
        if user_id is not None
        else dict(stored.get("actors", {}).get(str(actor_id), {}))
    )
    if not credentials and user_id is None:
        credentials = {key: stored[key] for key in ("server", "access", "refresh", "cloud_credential") if key in stored}
    base = server_url(stored["server"])
    auth = {"Authorization": "Bearer " + credentials["access"], **(headers or {})}
    kwargs = {"allow_redirects": False, "headers": auth}
    if raw is not None:
        kwargs["data"] = raw
    if body is not None:
        data = json.dumps(body, cls=DjangoJSONEncoder).encode()
        kwargs["data"] = UploadBody(data) if progress else data
        kwargs["headers"]["Content-Type"] = "application/json"
        kwargs["headers"]["Content-Length"] = str(len(data))
    response = requests.request(method, base + "/api/v1/" + path, timeout=(5, 45), **kwargs)
    if response.status_code == 401:
        refreshed = None
        if credentials.get("refresh"):
            refreshed = requests.post(
                base + "/api/v1/auth/token/refresh/",
                json={"refresh": credentials["refresh"]},
                timeout=(5, 20),
                allow_redirects=False,
            )
        if (refreshed is None or not refreshed.ok) and credentials.get("cloud_credential"):
            refreshed = requests.post(
                base + "/api/v1/sync/session/",
                json=credentials["cloud_credential"],
                timeout=(5, 20),
                allow_redirects=False,
            )
        if refreshed is not None and refreshed.ok:
            credentials.update(refreshed.json())
            vault.put_user(
                actor_id,
                {**credentials, "server": base},
                primary=actor_id == stored.get("primary_user"),
            )
            kwargs["headers"]["Authorization"] = "Bearer " + credentials["access"]
            response = requests.request(method, base + "/api/v1/" + path, timeout=(5, 45), **kwargs)
    return response
