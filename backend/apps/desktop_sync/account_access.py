"""Trusted-account onboarding. There is no separate user-chosen offline password."""

import secrets
import threading
import time
from uuid import uuid4

import requests
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import close_old_connections, transaction
from django.http import JsonResponse
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken

from .files import cache_media
from .grants import verify_grant
from .local import get_state, runtime_lock, set_state, wake_worker
from .security import (
    DesktopLocked,
    accept_server_time,
    activate_actor,
    apply_policy,
    assert_session,
    assert_mfa,
    audit,
    lock,
    lock_register,
    needs_unlock,
    pending_for,
    register_id,
    remember_pending,
    seal_actor,
    seal_session,
    verified_actor,
    verify_password,
)
from .snapshots import import_snapshot
from .transport import Vault, cloud_request, server_url

jobs = {}
jobs_lock = threading.Lock()


def cloud_headers(request):
    return {"Authorization": request.headers.get("Authorization", "")}


def cloud_profile(request):
    server = server_url(settings.DESKTOP_SERVER)
    response = requests.get(
        server + "/api/v1/auth/me/", headers=cloud_headers(request), timeout=(5, 20), allow_redirects=False
    )
    if not response.ok:
        raise ValueError("Hisobingizni internet orqali qayta tasdiqlang.")
    return response.json()


def prepare_account(request, data):
    server = server_url(settings.DESKTOP_SERVER)
    password = data.get("password", "")
    if not isinstance(password, str) or not password or len(password) > 4096:
        raise ValueError("Odatiy hisob parolingizni kiriting.")
    device = get_state("device")
    installation = device["device_id"] if device else get_state("installation_id") or str(uuid4())
    if not device:
        set_state("installation_id", installation)
    response = requests.post(
        server + "/api/v1/sync/credentials/",
        headers=cloud_headers(request),
        json={"password": password, "device_id": installation, "register_id": register_id(request)},
        timeout=(5, 20),
        allow_redirects=False,
    )
    if not response.ok:
        raise ValueError("Hisob paroli tasdiqlanmadi. Internet orqali qayta kiring.")
    proof = response.json()
    remember_pending(
        proof["user_id"], proof["username"], password, proof["credential_ticket"], proof.get("aliases", []), proof.get("mfa_proof")
    )
    Vault().put_grant_key(proof["grant_key"])
    return proof


def save_actor(result, pending, access, refresh, register):
    user = get_user_model().objects.filter(pk=result["user_id"]).first()
    if user is None:
        raise ValueError("Do‘kon egasi bazani yangilagach, hisobingiz bilan qayta kiring.")
    device = get_state("device")
    Vault().put_grant_key(result["grant_key"])
    claims = verify_grant(result["offline_grant"], result["grant_key"])
    if claims["user"] != user.pk or claims["device"] != device["device_id"]:
        raise ValueError("Qurilma yoki hisob ruxsati mos kelmadi.")
    apply_policy(user, device, claims)
    actor = {
        "user_id": user.pk,
        "username": pending["username"],
        "aliases": pending.get("aliases", []),
        "credential_mode": "account",
        "password_hash": pending["password_hash"],
        "actor_ticket": result["actor_ticket"],
        "offline_grant": result["offline_grant"],
        "sessions": {},
    }
    previous = get_state("actors", {}).get(str(user.pk), {})
    from .security import verify_session

    for key, session in previous.get("sessions", {}).items():
        try:
            verify_session(user.pk, key, session)
            actor["sessions"][key] = session
        except DesktopLocked:
            continue
    from .security import verify_actor_mac

    try:
        verify_actor_mac(previous)
        actor["mfa_proofs"] = dict(previous.get("mfa_proofs", {}))
    except (DesktopLocked, KeyError):
        actor["mfa_proofs"] = {}
    actor["mfa_proofs"][register] = pending.get("mfa_proof")
    accept_server_time(claims["issued"])
    assert_mfa(user, device, seal_actor(actor), register)
    actor = seal_actor(activate_actor(user, actor, register))
    actors = get_state("actors", {})
    actors[str(user.pk)] = actor
    set_state("actors", actors)
    if user.pk == device["user_id"]:
        device["lease_until"] = result["lease_until"]
        set_state("device", device)
    set_state("security_denied", False)
    Vault().set_denied(False)
    Vault().put_user(
        user.pk,
        {
            "server": server_url(settings.DESKTOP_SERVER),
            "access": result.get("cloud_tokens", {}).get("access", access.removeprefix("Bearer ")),
            "refresh": result.get("cloud_tokens", {}).get("refresh", refresh),
            **({"cloud_credential": result["cloud_credential"]} if result.get("cloud_credential") else {}),
        },
        primary=user.pk == device["user_id"],
    )
    wake_worker.set()
    from .desktop_api import local_tokens

    return local_tokens(user, device, register)


def link_account(request, data, pending):
    device = get_state("device")
    response = requests.post(
        server_url(settings.DESKTOP_SERVER) + "/api/v1/sync/actors/",
        headers=cloud_headers(request),
        json={
            "device_id": device["device_id"],
            "credential_mode": "account",
            "credential_ticket": pending["credential_ticket"],
        },
        timeout=(5, 20),
        allow_redirects=False,
    )
    if not response.ok:
        raise ValueError("Bu hisobni shu do‘konda offline ishlashga ulab bo‘lmadi. Online ishlashingiz mumkin.")
    with transaction.atomic():
        return save_actor(
            response.json(), pending, cloud_headers(request)["Authorization"], data.get("refresh"), register_id(request)
        )


def enroll_job(job, *, pending, access, refresh, tenant_id, register):
    close_old_connections()
    try:
        job.update(stage="verifying", message="Do‘kon ruxsati tekshirilmoqda…")
        installation = get_state("installation_id") or str(uuid4())
        set_state("installation_id", installation)
        response = requests.post(
            server_url(settings.DESKTOP_SERVER) + "/api/v1/sync/devices/",
            headers={"Authorization": access},
            json={
                "protocol": 1,
                "tenant_id": tenant_id,
                "name": "ILBI Desktop",
                "installation_id": installation,
                "credential_mode": "account",
                "credential_ticket": pending["credential_ticket"],
            },
            timeout=(5, 90),
            allow_redirects=False,
        )
        if not response.ok:
            try:
                detail = response.json().get("detail") or response.json()
            except ValueError:
                detail = "Do‘konni tayyorlash server tomonidan tasdiqlanmadi."
            raise ValueError(str(detail)[:1000])
        result = response.json()
        job.update(stage="images", message="Do‘kon ma’lumotlari olindi. Rasmlar yuklanmoqda…")
        missing = cache_media(
            result["snapshot"],
            server_url(settings.DESKTOP_SERVER),
            on_progress=lambda done, total: job.update(files_done=done, files_total=total),
        )
        job.update(stage="saving", message="Ma’lumotlar shu kompyuterga saqlanmoqda…")
        with runtime_lock, transaction.atomic():
            if get_state("device"):
                raise ValueError("Do‘kon allaqachon tayyorlangan. Hisobingiz bilan qayta kiring.")
            import_snapshot(result["snapshot"])
            device = {key: result[key] for key in ("device_id", "user_id", "lease_until")}
            device["tenant_id"] = result["snapshot"]["tenant_id"]
            set_state("device", device)
            set_state("revision", result["snapshot"].get("revision", 0))
            tokens = save_actor(result, pending, access, refresh, register)
            audit("offline_enabled", pending["user_id"], register)
        job.update(stage="ready", message="Offline ishlash tayyor.", tokens=tokens, missing_images=len(missing))
    except Exception as exc:
        job.update(stage="error", message=str(exc)[:1000])
    finally:
        close_old_connections()


def token_user(request, *, check_lock=True):
    from .authentication import DesktopJWTAuthentication

    token = AccessToken(request.headers.get("Authorization", "").removeprefix("Bearer "))
    authentication = DesktopJWTAuthentication()
    authentication.register = register_id(request)
    authentication.check_lock = check_lock
    return authentication.get_user(token), token


def endpoint(request, path, data, device):
    register = register_id(request)
    if path == "status/" and request.method == "GET":
        return JsonResponse(
            {
                "desktop": True,
                "enrolled": bool(device),
                "server": settings.DESKTOP_SERVER,
                "unlock_required": needs_unlock(register),
                "credential_mode": "account",
            }
        )
    if path == "register-start/" and request.method == "POST":
        lock_register(register)
        return JsonResponse({"ready": True})
    if path == "session/" and request.method == "POST":
        proof = prepare_account(request, data)
        if not device:
            return JsonResponse({"prepared": False, "account_verified": True})
        try:
            tokens = link_account(request, data, pending_for(proof["user_id"]))
            return JsonResponse({"prepared": True, **tokens})
        except ValueError as exc:
            return JsonResponse({"prepared": False, "account_verified": True, "notice": str(exc)})
    if path == "unlock/" and request.method == "POST":
        if not device:
            return JsonResponse({"detail": "Bu hisob hali offline tayyorlanmagan.", "code": "not_prepared"}, status=404)
        if get_state("security_denied", False) or Vault().read().get("security_denied", False):
            raise DesktopLocked("Ruxsatni internet orqali odatiy hisobingiz bilan qayta tasdiqlang.")
        username, password = data.get("username", ""), data.get("password", "")
        if (
            not isinstance(username, str)
            or len(username) > 254
            or not isinstance(password, str)
            or len(password) > 4096
        ):
            raise ValueError("Login yoki parol noto‘g‘ri.")
        actor = verify_password(username, password, register)
        user = get_user_model().objects.get(pk=actor["user_id"], is_active=True)
        verified_actor(user, device, actor)
        assert_mfa(user, device, actor, register)
        actors = get_state("actors", {})
        actors[str(user.pk)] = activate_actor(user, actor, register)
        set_state("actors", actors)
        from .desktop_api import local_tokens

        return JsonResponse(local_tokens(user, device, register))
    if path in {"enroll/", "actor/", "reconnect/"} and request.method == "POST":
        server_url(settings.DESKTOP_SERVER)  # Reject altered destinations before any credential request.
        profile = cloud_profile(request)
        try:
            pending = pending_for(profile["id"])
        except ValueError as exc:
            return JsonResponse({"detail": str(exc), "code": "account_verification_required"}, status=409)
        if device:
            return JsonResponse(link_account(request, data, pending))
        if path != "enroll/":
            raise ValueError("Do‘kon egasi avval offline ishlashni tayyorlasin.")
        with jobs_lock:
            now = time.monotonic()
            for key in list(jobs):
                if jobs[key]["until"] < now:
                    del jobs[key]
            if any(row["stage"] not in {"ready", "error"} for row in jobs.values()):
                raise ValueError("Do‘kon tayyorlanmoqda. Jarayon tugashini kuting.")
            secret = secrets.token_urlsafe(32)
            job = {"stage": "verifying", "until": now + 1800, "message": "Do‘kon ruxsati tekshirilmoqda…"}
            jobs[secret] = job
            threading.Thread(
                target=enroll_job,
                kwargs={
                    "job": job,
                    "pending": dict(pending),
                    "access": cloud_headers(request)["Authorization"],
                    "refresh": data.get("refresh"),
                    "tenant_id": data.get("tenant_id"),
                    "register": register,
                },
                daemon=True,
                name="ilbi-offline-setup",
            ).start()
        return JsonResponse({"job_token": secret, "stage": job["stage"]}, status=202)
    if path == "setup-status/" and request.method == "POST":
        key = data.get("job_token", "")
        job = jobs.get(key) if isinstance(key, str) else None
        if not job or job["until"] < time.monotonic():
            raise ValueError("Tayyorlash holati topilmadi. Qayta tekshiring.")
        public = dict(job)
        public.pop("until", None)
        return JsonResponse(public)
    if path in {"activity/", "lock/", "session-state/", "security-settings/"}:
        user, token = token_user(request, check_lock=path not in {"lock/", "session-state/"})
        actors = get_state("actors", {})
        actor = actors[str(user.pk)]
        if path == "lock/" and request.method == "POST":
            lock(user.pk, register)
            return JsonResponse({"locked": True})
        if path == "activity/" and request.method == "POST":
            actor["sessions"][register]["activity"] = timezone.now().timestamp()
            actor["sessions"][register] = seal_session(user.pk, register, actor["sessions"][register])
            actors[str(user.pk)] = actor
            set_state("actors", actors)
            return JsonResponse({"accepted": True})
        if path == "session-state/":
            locked = False
            try:
                assert_session(user, actor, register, token)
            except DesktopLocked:
                locked = True
            grant = verified_actor(user, device, actor)
            mfa = assert_mfa(user, device, actor, register)
            return JsonResponse(
                {
                    "locked": locked,
                    "lease_until": grant["expires"],
                    "mfa_expires_at": mfa["expires"],
                    "idle_minutes": get_state("idle_minutes", 10),
                    "owner": grant["policy"]["owner"],
                }
            )
        from .desktop_api import can_manage_queue

        if not can_manage_queue(user):
            return JsonResponse({"detail": "Bu sozlamani faqat do‘kon egasi o‘zgartiradi."}, status=403)
        if request.method == "POST":
            minutes = data.get("idle_minutes")
            if type(minutes) is not int or not 1 <= minutes <= 60:
                raise ValueError("Qulflash vaqti 1–60 daqiqa bo‘lsin.")
            set_state("idle_minutes", minutes)
            audit("idle_timeout_changed", user.pk, register)
        return JsonResponse(
            {"idle_minutes": get_state("idle_minutes", 10), "audit": get_state("security_audit", [])[-30:]}
        )
    if path in {"owner-authorize/", "pairing-relay/"} and request.method == "POST":
        from .desktop_api import can_manage_queue

        user, _ = token_user(request)
        if not can_manage_queue(user):
            return JsonResponse({"detail": "Bu amalni faqat do‘kon egasi bajaradi."}, status=403)
        if data.get("reauth_password") is not None:
            actor = verify_password(user.username or user.phone_number, str(data["reauth_password"]), register)
            if actor["user_id"] != user.pk:
                raise ValueError("Do‘kon egasi hisobi tasdiqlanmadi.")
            audit("owner_reauthenticated", user.pk, register)
        if path == "owner-authorize/":
            if data.get("event") in {"backup_created", "backup_restore_requested", "register_revoked"}:
                audit(data["event"], user.pk, register)
            return JsonResponse(
                {"owner": True, "user_id": user.pk, "device_id": device["device_id"], "tenant_id": device["tenant_id"]}
            )
        action = data.get("action")
        if action == "create":
            remote = cloud_request("POST", "sync/pairings/", body={"device_id": device["device_id"]}, user_id=user.pk)
        elif action in {"state", "approve", "cancel"}:
            from uuid import UUID

            pairing_id = str(UUID(str(data.get("id"))))
            remote = cloud_request(
                "POST",
                f"sync/pairings/{pairing_id}/",
                user_id=user.pk,
                body={"action": action, **({"payload": data["payload"]} if action == "approve" else {})},
            )
        else:
            raise ValueError("Ulanish amali noto‘g‘ri.")
        value = remote.json()
        if remote.ok and action in {"create", "approve", "cancel"}:
            audit("register_pairing_" + action, user.pk, register)
        return JsonResponse(value, status=remote.status_code, safe=isinstance(value, dict))
    return None
