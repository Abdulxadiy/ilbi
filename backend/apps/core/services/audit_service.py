"""
Service layer for recording immutable audit logs across ILBI.
"""
from typing import Any
from apps.core.models import AuditLog, AuditAction


def get_client_ip(request) -> str | None:
    """Extract genuine client IP from request headers or remote address."""
    if not request:
        return None
    x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    if x_forwarded_for:
        return x_forwarded_for.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def get_user_agent(request) -> str:
    """Extract User-Agent string from request headers."""
    if not request:
        return ""
    return request.META.get("HTTP_USER_AGENT", "")[:500]


class AuditService:
    @staticmethod
    def log(
        *,
        action: str,
        actor=None,
        tenant=None,
        target_model: str = "",
        target_id: str = "",
        changes: dict[str, Any] | None = None,
        description: str = "",
        request=None,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> AuditLog:
        """
        Record an immutable AuditLog entry.
        """
        if request is not None:
            if actor is None and getattr(request, "user", None) and request.user.is_authenticated:
                actor = request.user
            if tenant is None:
                if getattr(request, "tenant", None):
                    tenant = request.tenant
                elif actor is not None:
                    membership = actor.employments.filter(is_active=True).select_related("tenant").first()
                    tenant = membership.tenant if membership else None
            if not ip_address:
                ip_address = get_client_ip(request)
            if not user_agent:
                user_agent = get_user_agent(request)

        if tenant is None and actor is not None:
            membership = actor.employments.filter(is_active=True).select_related("tenant").first()
            tenant = membership.tenant if membership else None

        return AuditLog.objects.create(
            tenant=tenant,
            actor=actor,
            action=action,
            target_model=target_model,
            target_id=str(target_id) if target_id else "",
            changes=changes or {},
            description=description,
            ip_address=ip_address,
            user_agent=user_agent or "",
        )
