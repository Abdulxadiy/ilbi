import logging
import threading
from datetime import timedelta

import requests
from django.db import close_old_connections, transaction
from django.utils import timezone

from .files import cache_media
from .local import activity, get_state, next_operation, runtime_lock, set_state, wake_worker
from .models import LocalAlias, LocalOperation
from .snapshots import import_snapshot
from .transport import cloud_request

log = logging.getLogger(__name__)
update_paused = threading.Event()
cycle_lock = threading.Lock()
last_security_check = 0


def pause_for_update(timeout=65):
    update_paused.set()
    if not cycle_lock.acquire(timeout=timeout):
        update_paused.clear()
        return False
    cycle_lock.release()
    return True


def resume_after_update():
    update_paused.clear()
    wake_worker.set()


def error_message(value):
    if isinstance(value, str):
        return value[:1500]
    if isinstance(value, list):
        return "; ".join(error_message(item) for item in value)[:1500]
    if isinstance(value, dict):
        for key in ("reason", "detail", "details", "error", "message"):
            if key in value:
                return error_message(value[key])
        return "; ".join(error_message(item) for item in value.values())[:1500]
    return "Operatsiyani tekshirish kerak."


def sync_once():
    global last_security_check
    import time

    device = get_state("device")
    if not device:
        return False
    if (
        any(actor.get("credential_mode") == "account" for actor in get_state("actors", {}).values())
        and time.monotonic() - last_security_check >= 60
    ):
        try:
            security = cloud_request("GET", "sync/security/?device_id=" + device["device_id"])
            if security.ok:
                from .security import refresh_grants

                with runtime_lock, transaction.atomic():
                    refresh_grants(security.json(), update_policy=True)
            elif security.status_code in {401, 403}:
                set_state("security_denied", True)
                from .transport import Vault

                Vault().set_denied(True)
        except (requests.RequestException, OSError):
            pass  # Existing signed leases remain valid during a genuine network outage.
        finally:
            last_security_check = time.monotonic()
    with runtime_lock:
        row = next_operation()
        if row:
            row.status = "active"
            row.attempts += 1
            row.save(update_fields=["status", "attempts"])
            activity.update(active=str(row.id), progress=0, stage="uploading")
    try:
        if row:
            response = cloud_request(
                "POST",
                "sync/push/",
                body={"protocol": 1, "device_id": device["device_id"], "operation": row.payload},
                progress=True,
            )
            activity["online"] = True
            with runtime_lock, transaction.atomic():
                if response.ok:
                    result = response.json()
                    if result.get("id") != str(row.id):
                        raise ValueError("Server noto‘g‘ri operatsiyani tasdiqladi.")
                    row.status, row.result, row.completed_at = "done", result, timezone.now()
                    row.error = ""
                    LocalAlias.objects.bulk_create(
                        [
                            LocalAlias(local_id=int(local), remote_id=remote)
                            for local, remote in result.get("id_map", {}).items()
                        ],
                        ignore_conflicts=True,
                    )
                elif response.status_code in {408, 425, 429} or response.status_code >= 500:
                    row.status = "waiting"
                    row.error = "Server vaqtincha band. Qayta yuboriladi."
                    delay = min(60, 2 ** min(row.attempts, 6))
                    row.next_attempt_at = timezone.now() + timedelta(seconds=delay)
                else:
                    row.status = "error"
                    try:
                        row.error = error_message(response.json())
                    except ValueError:
                        row.error = f"Server javobi: {response.status_code}"
                row.save()
            return True
        # Never replace an optimistic local state while any unsent/conflicting
        # command exists. It remains durable and visible for resolution.
        if LocalOperation.objects.exclude(status="done").exists():
            return False
        probe = cloud_request("GET", "sync/changes/?device_id=" + device["device_id"])
        if not probe.ok:
            activity.update(online=probe.status_code < 500, error="Server yoki qurilma ruxsatini tekshiring.")
            return False
        activity["online"] = True
        last_lease_refresh = get_state("lease_refreshed", "")
        from django.utils.dateparse import parse_datetime

        lease_refresh = parse_datetime(last_lease_refresh) if last_lease_refresh else None
        if (
            probe.json().get("revision") == get_state("revision")
            and lease_refresh
            and timezone.now() - lease_refresh < timedelta(hours=6)
        ):
            activity["error"] = ""
            return False
        response = cloud_request("GET", "sync/snapshot/?device_id=" + device["device_id"])
        activity["online"] = response.status_code < 500
        if response.ok:
            data = response.json()
            from django.conf import settings

            missing_media = cache_media(data["snapshot"], settings.DESKTOP_SERVER)
            with runtime_lock:
                if not LocalOperation.objects.exclude(status="done").exists():
                    import_snapshot(data["snapshot"])
                    device["lease_until"] = data["lease_until"]
                    actors = get_state("actors", {})
                    for key in list(actors):
                        if key not in data.get("actors", {}):
                            del actors[key]
                        elif actors[key].get("credential_mode") != "account" or not data.get("grant_key"):
                            actors[key]["actor_ticket"] = data["actors"][key]
                    set_state("actors", actors)
                    set_state("device", device)
                    set_state("revision", data["snapshot"].get("revision", 0))
                    set_state("lease_refreshed", timezone.now().isoformat())
                    set_state("last_sync", timezone.now().isoformat())
                    if data.get("grant_key"):
                        from .security import refresh_grants

                        refresh_grants(data)
            activity["error"] = (
                f"{len(missing_media)} ta rasm hali yuklanmadi. Keyingi ulanishda qayta uriniladi."
                if missing_media
                else ""
            )
        else:
            activity["error"] = "Server bilan sinxronlash tasdiqlanmadi. Hisob yoki qurilma ruxsatini tekshiring."
        return False
    except (requests.RequestException, OSError) as exc:
        activity.update(online=False, error="Serverga ulanish yo‘q. Ishlar kompyuterda saqlanmoqda.")
        if row:
            with runtime_lock:
                row.status = "waiting"
                row.error = "Aloqa tiklanganda qayta yuboriladi."
                row.next_attempt_at = timezone.now() + timedelta(seconds=5)
                row.save()
        log.info("Desktop sync connection unavailable: %s", type(exc).__name__)
        return False
    finally:
        activity.update(active=None, progress=None, stage="waiting")


def run_worker(stop):
    LocalOperation.objects.filter(status="active").update(status="waiting")
    while not stop.is_set():
        close_old_connections()
        try:
            with cycle_lock:
                more = False if update_paused.is_set() else sync_once()
        except Exception:
            log.exception("Desktop sync paused after unexpected failure; outbox retained")
            activity["error"] = (
                "Sinxronlash to‘xtadi. Dastur versiyasini va ulanishni tekshiring; ishlaringiz saqlangan."
            )
            # A failed worker must never leave a forever-active operation.
            LocalOperation.objects.filter(status="active").update(
                status="error", error="Sinxronlashda xatolik. Qayta urinib ko‘ring."
            )
            more = False
        if not more:
            wake_worker.wait(10)
            wake_worker.clear()
    close_old_connections()


def start_worker():
    stop = threading.Event()
    thread = threading.Thread(target=run_worker, args=(stop,), name="ilbi-sync", daemon=True)
    thread.start()
    return stop
