import hmac
import json
import re

import requests
from django.conf import settings
from django.db import transaction
from django.http import HttpResponse, JsonResponse
from django.utils import timezone

from apps.core.event_clock import event_time

from .cloud import rewrite
from .desktop_api import authenticated, endpoint
from .files import decode_body, encode_request
from .local import aliases_for, enqueue, get_state, runtime_lock
from .protocol import allowed, preconditions, record_changes, title_for
from .transport import Vault, cloud_request, server_url


class DesktopMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not hmac.compare_digest(request.headers.get("X-ILBI-Desktop-Key", ""), settings.DESKTOP_BRIDGE_KEY):
            return JsonResponse({"detail": "Desktop ulanishi tasdiqlanmadi."}, status=403)
        if request.path.startswith("/desktop/"):
            if request.path in {"/desktop/update/prepare/", "/desktop/update/resume/"}:
                key = getattr(settings, "DESKTOP_UPDATE_KEY", "")
                if (
                    not key
                    or request.method != "POST"
                    or not hmac.compare_digest(request.headers.get("X-ILBI-Update-Key", ""), key)
                ):
                    return JsonResponse({"detail": "Yangilash so‘rovi tasdiqlanmadi."}, status=403)
                from .worker import pause_for_update, resume_after_update

                if request.path.endswith("/resume/"):
                    resume_after_update()
                    return JsonResponse({"ready": False})
                from .account_access import jobs, jobs_lock

                with jobs_lock:
                    if any(job["stage"] not in {"ready", "error"} for job in jobs.values()):
                        return JsonResponse({"detail": "Avval offline tayyorlash tugashini kuting."}, status=409)
                # Do not hold runtime_lock while a network sync needs to finish.
                if not pause_for_update():
                    return JsonResponse({"detail": "Sinxronlash hali tugamadi. Birozdan keyin yangilang."}, status=409)
                with runtime_lock:
                    return JsonResponse({"ready": True})
            with runtime_lock:
                return endpoint(request, request.path[len("/desktop/") :])
        if request.path.startswith("/media/"):
            if not get_state("device") or request.headers.get("X-ILBI-Cloud-Session") == "true":
                return self.proxy(request, "")
            from rest_framework.exceptions import APIException

            try:
                authenticated(request)
            except (APIException, ValueError) as exc:
                return JsonResponse({"detail": str(exc)}, status=getattr(exc, "status_code", 401))
            response = self.get_response(request)
            return self.proxy(request, "") if response.status_code == 404 else response
        if not request.path.startswith("/api/v1/"):
            return self.get_response(request)
        path = request.path[len("/api/v1/") :]
        if request.headers.get("X-ILBI-Cloud-Session") == "true":
            # Online login stays online. Offline enrollment is optional;
            # cloud writes must never also enter the local outgoing queue.
            return self.proxy(request, path)
        with runtime_lock:
            device = get_state("device")
            if not device:
                return self.proxy(request, path)
            identifiers = [path.split("/"), [part for value in request.GET.values() for part in value.split(",")]]
            aliases = aliases_for(identifiers)
            if aliases:
                # Forms and open receipts may retain their local IDs after a pull.
                # Translate only identifiers already acknowledged and imported.
                path = re.sub(r"(?<=/)\d+(?=/|$)", lambda match: str(aliases.get(match[0], match[0])), path)
                request.path = request.path_info = "/api/v1/" + path
                query = request.GET.copy()
                for key in query:
                    if key == "id" or key.endswith(("_id", "_ids")):
                        query.setlist(
                            key,
                            [
                                re.sub(r"\d+", lambda match: str(aliases.get(match[0], match[0])), value)
                                for value in query.getlist(key)
                            ],
                        )
                request.GET = query
            if path.startswith("auth/admin-login") or path.startswith("auth/password-reset"):
                return self.proxy(request, path)
            if path == "auth/token/refresh/":
                from rest_framework_simplejwt.tokens import RefreshToken

                from .authentication import DesktopJWTAuthentication
                from .desktop_api import local_tokens

                try:
                    token = RefreshToken(json.loads(request.body)["refresh"])
                    authentication = DesktopJWTAuthentication()
                    authentication.register = request.headers.get("X-ILBI-Register-ID", "primary")
                    user = authentication.get_user(token)
                    return JsonResponse(local_tokens(user, device, authentication.register))
                except Exception:
                    return JsonResponse({"detail": "Offline sessiya muddati tugagan."}, status=401)
            # Cross-store actions and external services require live confirmation.
            remote_only = path.startswith(("support/", "platform/", "inventory/transfers/", "sales/b2b/", "internal/"))
            if remote_only or (request.method not in {"GET", "HEAD", "OPTIONS"} and not allowed(request.method, path)):
                from .models import LocalOperation

                if (
                    request.method not in {"GET", "HEAD", "OPTIONS"}
                    and LocalOperation.objects.exclude(status="done").exists()
                ):
                    return JsonResponse(
                        {"detail": "Bu amal jonli serverda bajariladi. Avval mahalliy navbatni sinxronlang."},
                        status=409,
                    )
                return self.proxy(request, path, enrolled=True)
            if request.method in {"GET", "HEAD", "OPTIONS"}:
                return self.get_response(request)
            try:
                body = encode_request(request)
                aliases.update(aliases_for(body))
                if aliases and request.content_type in {"application/json", "multipart/form-data"}:
                    body = rewrite(body, aliases, strict=False)
                    encoded, content_type = decode_body(body)
                    request._body = encoded.encode() if isinstance(encoded, str) else encoded
                    request.META["CONTENT_TYPE"] = content_type
                    request.META["CONTENT_LENGTH"] = str(len(request._body))
            except ValueError as exc:
                return JsonResponse({"detail": str(exc)}, status=400)
            if path == "sales/" and body.get("counterparty_id"):
                from apps.sales.models import Counterparty

                if Counterparty.objects.filter(pk=body["counterparty_id"], target_tenant__isnull=False).exists():
                    return JsonResponse({"detail": "B2B savdo uchun ikki do‘konning jonli tasdig‘i kerak."}, status=409)
            with transaction.atomic(), record_changes() as changes:
                occurred = timezone.now()
                clock_token = event_time.set(occurred)
                try:
                    response = self.get_response(request)
                finally:
                    event_time.reset(clock_token)
                if response.status_code >= 400:
                    transaction.set_rollback(True)
                    return response
                actors = get_state("actors", {})
                actor = actors.get(str(getattr(request.user, "pk", "")))
                if not actor:
                    transaction.set_rollback(True)
                    return JsonResponse({"detail": "Offline xodim tasdiqlanmadi."}, status=401)
                row = enqueue(
                    user_id=request.user.pk,
                    tenant_id=device["tenant_id"],
                    title=title_for(path, request.method, body, getattr(response, "data", None)),
                    resources=changes["resources"],
                    references=changes["references"],
                    payload={
                        "method": request.method,
                        "path": path,
                        "body": body,
                        "created": changes["created"],
                        "preconditions": preconditions(changes),
                        "occurred_at": occurred.isoformat(),
                        "actor_ticket": actor["actor_ticket"],
                    },
                )
                response["X-ILBI-Operation-ID"] = str(row.id)
                response["X-ILBI-Sync-Status"] = "waiting"
                return response

    def proxy(self, request, path, enrolled=False):
        try:
            if enrolled:
                # Live actions use this cashier's own encrypted credentials.
                # They never inherit the primary owner's permissions.
                from rest_framework.exceptions import APIException

                try:
                    user = authenticated(request)
                    remote = cloud_request(
                        request.method,
                        request.get_full_path()[len("/api/v1/") :],
                        user_id=user.pk,
                        raw=request.body,
                        headers={
                            "Content-Type": request.headers.get("Content-Type", "application/json"),
                            "X-Tenant-ID": str(get_state("device")["tenant_id"]),
                        },
                    )
                except (KeyError, APIException):
                    return JsonResponse(
                        {"detail": "Jonli amal uchun internet orqali hisobingizga qayta kiring."}, status=409
                    )
                if remote.status_code == 401:
                    return JsonResponse(
                        {"detail": "Jonli sessiya tugagan. Internet orqali qayta kiring; offline ishlar saqlangan."},
                        status=409,
                    )
                if request.method not in {"GET", "HEAD", "OPTIONS"} and remote.ok:
                    from .local import set_state, wake_worker

                    set_state("revision", -1)
                    wake_worker.set()
            else:
                base = server_url(settings.DESKTOP_SERVER)
                headers = {
                    key: value
                    for key, value in request.headers.items()
                    if key.lower()
                    in {
                        "authorization",
                        "content-type",
                        "x-tenant-id",
                        "x-support-token",
                        "idempotency-key",
                        "x-idempotency-key",
                        "accept",
                        "range",
                        "if-none-match",
                        "if-modified-since",
                    }
                }
                remote = requests.request(
                    request.method,
                    base + request.get_full_path(),
                    data=request.body,
                    headers=headers,
                    timeout=(5, 30),
                    allow_redirects=False,
                    **({"cookies": Vault().mfa_cookies(
                        request.headers.get("X-ILBI-Register-ID", "primary"))} if path.startswith("auth/admin-login") else {}),
                )
                if path.startswith("auth/admin-login") and remote.ok:
                    Vault().remember_mfa_cookies(request.headers.get("X-ILBI-Register-ID", "primary"), getattr(remote, "cookies", ()))
            response = HttpResponse(
                remote.content,
                status=remote.status_code,
                content_type=remote.headers.get("Content-Type", "application/json"),
            )
            for name in (
                "Content-Disposition",
                "Retry-After",
                "Content-Range",
                "Accept-Ranges",
                "ETag",
                "Last-Modified",
            ):
                if name in remote.headers:
                    response[name] = remote.headers[name]
            if path.startswith("auth/admin-login") and remote.ok:
                try:
                    login = remote.json()
                    if isinstance(login, dict) and login.get("access") and login.get("refresh"):
                        response["X-ILBI-Account-Verified"] = "1"
                except ValueError:
                    pass
            return response
        except ValueError as error:
            return JsonResponse({"detail": str(error)}, status=503)
        except requests.RequestException:
            return JsonResponse(
                {
                    "detail": "Internetga ulanib, qayta urinib ko‘ring. "
                    "Offline rejim oldindan tayyorlangan bo‘lsa, odatiy hisob parolingiz bilan kiring."
                },
                status=503,
            )
