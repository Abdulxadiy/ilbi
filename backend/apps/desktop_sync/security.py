"""Device-bound ordinary account verification, idle locks and offline clock checks."""

import hashlib
import hmac
import json
import os
import time
from datetime import timedelta
from uuid import uuid4

from django.contrib.auth.hashers import check_password, make_password
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import APIException

from .grants import access_policy, verify_grant
from .local import get_state, set_state
from .transport import Vault

pending_accounts = {}
clock_anchor = None


class DesktopLocked(APIException):
    status_code = 423
    default_detail = "Kassa qulflangan. Odatiy hisob parolingiz bilan qayta kiring."
    default_code = "desktop_locked"


def mac(value):
    raw = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hmac.digest(os.environ["ILBI_DESKTOP_VAULT_KEY"].encode(), raw, "sha256").hex()


def audit(event, user_id=None, register="primary"):
    entries = get_state("security_audit", [])
    entry = {
        "event": event,
        "user": user_id,
        "register": register,
        "at": timezone.now().isoformat(),
        "previous": entries[-1]["mac"] if entries else "",
    }
    entry["mac"] = mac(entry)
    set_state("security_audit", [*entries[-499:], entry])


def register_id(request):
    return request.headers.get("X-ILBI-Register-ID", "primary")[:80]


def password_value(user_id, password):
    # A copied PostgreSQL verifier cannot be guessed without the OS-protected key.
    return hmac.digest(
        os.environ["ILBI_DESKTOP_VAULT_KEY"].encode(),
        ("ilbi-account-v2:" + str(user_id) + ":" + password).encode(),
        "sha256",
    ).hex()


def seal_actor(actor):
    value = {key: actor[key] for key in ("user_id", "username", "password_hash", "offline_grant")}
    value["aliases"] = actor.get("aliases", [])
    value["actor_ticket"] = actor.get("actor_ticket", "")
    if "mfa_proofs" in actor:
        value["mfa_proofs"] = actor["mfa_proofs"]
    actor["credential_mac"] = mac(value)
    return actor


def verified_actor(user, device, actor):
    if actor.get("credential_mode") != "account":
        raise DesktopLocked("Yangilanishdan keyin bir marta internet orqali odatiy hisobingizga kiring.")
    verify_actor_mac(actor)
    stored = Vault().read()
    try:
        grant = verify_grant(actor["offline_grant"], stored["grant_key"])
        if (
            grant["device"] != device["device_id"]
            or grant["user"] != user.pk
            or grant["tenant"] != device["tenant_id"]
            or grant["policy"] != access_policy(user, device["tenant_id"])
        ):
            raise ValueError("Do‘kon yoki xodim ruxsati o‘zgargan.")
        if trusted_now() >= grant["expires"]:
            raise ValueError("Offline ruxsat muddati tugadi. Internet orqali qayta tasdiqlang.")
        return grant
    except (ValueError, KeyError) as exc:
        raise DesktopLocked(str(exc)) from exc


def verify_actor_mac(actor):
    expected = seal_actor(dict(actor))["credential_mac"]
    if not hmac.compare_digest(actor.get("credential_mac", ""), expected):
        raise DesktopLocked("Mahalliy kirish ma’lumotlari tasdiqlanmadi. Internet orqali qayta kiring.")


def assert_mfa(user, device, actor, register):
    from apps.accounts.services.daily_mfa import WINDOW

    verify_actor_mac(actor)
    try:
        proof = verify_grant(actor.get("mfa_proofs", {}).get(register, ""), Vault().read()["grant_key"])
        if (proof.get("kind") != "daily_mfa" or proof.get("device") != device["device_id"]
                or proof.get("user") != user.pk or proof.get("register") != register
                or proof.get("token_version") != user.token_version
                or type(proof.get("verified_at")) is not int or proof["expires"] != proof["verified_at"] + WINDOW
                or not proof["verified_at"] <= trusted_now() < proof["expires"]):
            raise ValueError
        return proof
    except (ValueError, TypeError, KeyError) as exc:
        raise DesktopLocked("24 soatlik 2FA tasdig‘i kerak. Internetga ulanib, Telegram kodi bilan qayta kiring.") from exc


def accept_server_time(issued):
    global clock_anchor
    now = max(float(issued), timezone.now().timestamp())
    clock_anchor = (now, time.monotonic())
    value = {"time": now}
    value["mac"] = mac(value)
    set_state("trusted_clock", value)


def trusted_now():
    global clock_anchor
    wall = timezone.now().timestamp()
    stored = get_state("trusted_clock", {})
    if stored:
        valid = hmac.compare_digest(stored.get("mac", ""), mac({"time": stored.get("time")}))
        if not valid or wall + 120 < stored["time"]:
            raise DesktopLocked("Kompyuter vaqti orqaga o‘zgargan. Internet orqali vaqt va hisobni tasdiqlang.")
    if clock_anchor is None:
        clock_anchor = (max(wall, stored.get("time", wall)), time.monotonic())
    current = max(wall, clock_anchor[0] + time.monotonic() - clock_anchor[1])
    if current - stored.get("time", 0) > 30:
        value = {"time": current}
        value["mac"] = mac(value)
        set_state("trusted_clock", value)
    return current


def remember_pending(user_id, username, password, ticket, aliases=None, mfa_proof=None):
    pending_accounts[user_id] = {
        "user_id": user_id,
        "username": username,
        "aliases": aliases or [],
        "password_hash": make_password(password_value(user_id, password)),
        "credential_ticket": ticket,
        "until": time.monotonic() + 570,
        "mfa_proof": mfa_proof,
    }


def pending_for(user_id):
    value = pending_accounts.get(user_id)
    if not value or value["until"] <= time.monotonic():
        pending_accounts.pop(user_id, None)
        raise ValueError("Hisobni qayta tasdiqlang: odatiy parolingizni kiriting. Yangi offline parol kerak emas.")
    return value


def activate_actor(user, actor, register):
    sessions = actor.setdefault("sessions", {})
    sessions[register] = seal_session(
        user.pk, register, {"id": str(uuid4()), "locked": False, "activity": timezone.now().timestamp()}
    )
    audit("account_unlocked", user.pk, register)
    return actor


def seal_session(user_id, register, session):
    value = {key: session.get(key) for key in ("id", "locked", "activity")}
    return {**value, "mac": mac({"user": user_id, "register": register, **value})}


def verify_session(user_id, register, session):
    expected = seal_session(user_id, register, session)["mac"]
    if not hmac.compare_digest(session.get("mac", ""), expected):
        raise DesktopLocked("Sessiya xavfsizlik holati tasdiqlanmadi. Qayta kiring.")


def assert_session(user, actor, register, token):
    session = actor.get("sessions", {}).get(register, {})
    verify_session(user.pk, register, session)
    # The native register locks exactly on its timer. Allow its bounded activity
    # delivery interval here so a recent input cannot race the polling request.
    timeout = get_state("idle_minutes", 10) * 60 + 10
    if session.get("locked", True) or token.get("desktop_session") != session.get("id"):
        raise DesktopLocked()
    if timezone.now().timestamp() - session.get("activity", 0) >= timeout:
        lock(user.pk, register, "idle_lock")
        raise DesktopLocked()


def lock(user_id, register, event="account_locked"):
    actors = get_state("actors", {})
    actor = actors.get(str(user_id))
    if actor and register in actor.get("sessions", {}):
        actor["sessions"][register]["locked"] = True
        actor["sessions"][register] = seal_session(user_id, register, actor["sessions"][register])
        set_state("actors", actors)
        audit(event, user_id, register)


def lock_register(register):
    actors = get_state("actors", {})
    for actor in actors.values():
        if register in actor.get("sessions", {}):
            actor["sessions"][register]["locked"] = True
            actor["sessions"][register] = seal_session(actor["user_id"], register, actor["sessions"][register])
    set_state("actors", actors)


def refresh_grants(data, *, update_policy=False):
    from django.contrib.auth import get_user_model

    Vault().put_grant_key(data["grant_key"])
    device = get_state("device")
    actors = get_state("actors", {})
    for key in list(actors):
        actor = actors[key]
        if actor.get("credential_mode") != "account":
            continue
        verify_actor_mac(actor)
        signed = data.get("offline_grants", {}).get(key)
        if not signed:
            audit("account_permission_revoked", actor["user_id"])
            del actors[key]
            continue
        grant = verify_grant(signed, data["grant_key"])
        if grant["device"] != device["device_id"] or str(grant["user"]) != key:
            raise ValueError("Offline ruxsat do‘kon yoki hisobga mos kelmadi.")
        if update_policy:
            user = get_user_model().objects.get(pk=actor["user_id"])
            if user.token_version != grant["policy"]["token_version"]:
                del actors[key]
                continue  # A changed cloud password requires fresh online verification.
            apply_policy(user, device, grant)
        actor["offline_grant"] = signed
        if key in data.get("actors", {}):
            actor["actor_ticket"] = data["actors"][key]
        actors[key] = seal_actor(actor)
        accept_server_time(grant["issued"])
    set_state("actors", actors)
    set_state("security_denied", False)
    Vault().set_denied(False)
    if data.get("lease_until"):
        device["lease_until"] = data["lease_until"]
        set_state("device", device)


def apply_policy(user, device, grant):
    from apps.accounts.models import Employee
    from apps.permissions.models import Permission

    policy = grant["policy"]
    if policy["role"] not in {"owner", "staff"}:
        raise ValueError("Bu hisob bilan offline ishlash mumkin emas.")
    user.role = policy["role"]
    user.token_version = policy["token_version"]
    user.is_active = True
    user.is_staff = False
    user.is_superuser = False
    user.save(update_fields=["role", "token_version", "is_active", "is_staff", "is_superuser"])
    employee = Employee.objects.get(user=user, tenant_id=device["tenant_id"])
    employee.is_active = True
    employee.is_owner = policy["owner"]
    employee.save(update_fields=["is_active", "is_owner"])
    permissions = []
    for code in policy["permissions"]:
        category, codename = code.split(".", 1)
        permission, _ = Permission.objects.get_or_create(category=category, codename=codename, defaults={"name": code})
        permissions.append(permission)
    employee.permissions.set(permissions)


def needs_unlock(register):
    return bool(get_state("device")) and bool(get_state("actors", {}))


def verify_password(username, password, register):
    actors = get_state("actors", {})
    actor = next((row for row in actors.values() if row["username"] == username), None)
    if actor is None:
        matches = [
            row
            for row in actors.values()
            if username.casefold() in [alias.casefold() for alias in row.get("aliases", [])]
        ]
        actor = matches[0] if len(matches) == 1 else None
    identity = actor["username"] if actor else username
    key = "login_attempt:" + hashlib.sha256((register + ":" + identity.casefold()).encode()).hexdigest()[:48]
    attempts = get_state(key, {})
    blocked = parse_datetime(attempts.get("until", ""))
    if blocked and blocked > timezone.now():
        error = DesktopLocked("Ko‘p noto‘g‘ri urinish. Birozdan keyin qayta urinib ko‘ring.")
        error.status_code = 429
        raise error
    if actor and actor.get("credential_mode") != "account":
        raise DesktopLocked("Bu hisobni bir marta internet orqali tasdiqlang. Alohida offline parol endi kerak emas.")
    valid = actor and check_password(password_value(actor["user_id"], password), actor["password_hash"])
    if not valid:
        failures = int(attempts.get("failures", 0)) + 1
        value = {"failures": failures}
        if failures >= 5:
            value["until"] = (timezone.now() + timedelta(seconds=min(900, 30 * 2 ** min(failures - 5, 5)))).isoformat()
        set_state(key, value)
        raise ValueError("Login yoki parol noto‘g‘ri.")
    set_state(key, {})
    return actor
