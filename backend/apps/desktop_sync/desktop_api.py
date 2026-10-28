import json
from uuid import UUID

import requests
from django.conf import settings
from django.http import JsonResponse
from rest_framework.exceptions import APIException
from rest_framework_simplejwt.tokens import RefreshToken

from .authentication import DesktopJWTAuthentication
from .local import get_state, prioritize, queue_status, wake_worker
from .models import LocalOperation
from .transport import server_url


def local_tokens(user, device, register="primary"):
    token = RefreshToken.for_user(user)
    token["desktop_device"] = device["device_id"]
    token["token_version"] = user.token_version
    actor = get_state("actors", {}).get(str(user.pk), {})
    if actor.get("credential_mode") == "account":
        from .security import assert_mfa

        proof = assert_mfa(user, device, actor, register)
        token["desktop_mfa_expires"] = proof["expires"]
        token["desktop_register"] = register
        token["desktop_session"] = actor.get("sessions", {}).get(register, {}).get("id", "")
    return {"access": str(token.access_token), "refresh": str(token)}


def authenticated(request):
    result = DesktopJWTAuthentication().authenticate(request)
    if result is None:
        raise ValueError("Avval hisobga kiring.")
    return result[0]


def can_manage_queue(user):
    from apps.accounts.models import Employee

    device = get_state("device") or {}
    return Employee.objects.filter(user=user, tenant_id=device.get("tenant_id"), is_active=True, is_owner=True).exists()


def endpoint(request, path):
    try:
        data = json.loads(request.body or b"{}") if request.method == "POST" else {}
        if not isinstance(data, dict):
            raise ValueError("So‘rov JSON obyekt bo‘lishi kerak.")
        device = get_state("device")
        from .account_access import endpoint as account_endpoint

        response = account_endpoint(request, path, data, device)
        if response is not None:
            return response
        if path == "status/" and request.method == "GET":
            # No account names, operations or credentials in the pre-login status.
            return JsonResponse({"desktop": True, "enrolled": bool(device), "server": settings.DESKTOP_SERVER})
        if path == "releases/" and request.method == "GET":
            origin = server_url(settings.DESKTOP_SERVER)
            response = requests.get(origin + "/downloads/releases.json", timeout=(5, 15), allow_redirects=False)
            if response.status_code == 404:
                return JsonResponse({"origin": origin, "release": {"schema": 1}})
            if not response.ok:
                return JsonResponse({"detail": "Yuklab olish ma’lumotlari vaqtincha mavjud emas."}, status=503)
            return JsonResponse({"origin": origin, "release": response.json()})
        user = authenticated(request)
        if path == "queue/" and request.method == "GET":
            status = queue_status()
            from .security import verified_actor

            grant = verified_actor(user, device, get_state("actors")[str(user.pk)])
            status["lease_until"] = grant["expires"]
            # A cashier sees only their own work; owners can inspect the whole store.
            if not can_manage_queue(user):
                ids = set(
                    str(i)
                    for i in LocalOperation.objects.filter(user_id=user.pk)
                    .exclude(status="done")
                    .values_list("id", flat=True)
                )
                status["operations"] = [row for row in status["operations"] if row["id"] in ids]
            return JsonResponse(status)
        if request.method == "POST" and path in {"priority/", "retry/"}:
            row = LocalOperation.objects.get(id=UUID(str(data.get("id"))))
            if row.user_id != user.pk and not can_manage_queue(user):
                return JsonResponse({"detail": "Bu operatsiya sizga tegishli emas."}, status=403)
            if path == "priority/":
                prioritize(row.id)
            elif row.status not in {"active", "done"}:
                row.status, row.next_attempt_at, row.error = "waiting", None, ""
                row.save(update_fields=["status", "next_attempt_at", "error"])
                wake_worker.set()
            return JsonResponse({"accepted": True})
        return JsonResponse({"detail": "Amal topilmadi."}, status=404)
    except APIException as exc:
        return JsonResponse({"detail": str(exc.detail)}, status=exc.status_code)
    except (ValueError, KeyError, TypeError, LocalOperation.DoesNotExist) as exc:
        return JsonResponse({"detail": str(exc)}, status=400)
    except requests.RequestException:
        return JsonResponse(
            {"detail": "Serverga ulanish yo‘q. Tayyorlangan hisobga odatiy parolingiz bilan kiring."}, status=503
        )
