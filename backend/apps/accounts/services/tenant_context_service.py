"""Resolve and authorize the tenant used by a request."""

from dataclasses import dataclass

from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.models import Employee

TENANT_HEADER = "HTTP_X_TENANT_ID"


@dataclass(frozen=True)
class ActiveContext:
    tenant: object | None
    employee: Employee | None


def _parse_header(raw):
    if raw in (None, ""):
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValidationError({"detail": "X-Tenant-ID noto‘g‘ri formatda."}) from exc
    if value <= 0:
        raise ValidationError({"detail": "X-Tenant-ID noto‘g‘ri formatda."})
    return value


def resolve_active_context(user, raw_header) -> ActiveContext:
    """Read active membership from the database; never trust a token tenant claim."""
    if user is None or not getattr(user, "is_authenticated", False):
        return ActiveContext(None, None)
    if user.role == "platform_admin":
        return ActiveContext(None, None)

    header_id = _parse_header(raw_header)
    if user.role == "owner":
        memberships = Employee.objects.select_related("tenant").filter(
            user=user,
            is_active=True,
            is_owner=True,
            tenant__owner=user,
            tenant__is_active=True,
        )
        if header_id is not None:
            employee = memberships.filter(tenant_id=header_id).first()
            if employee is None:
                raise PermissionDenied("Bu do‘konga kirish huquqingiz yo‘q.")
        else:
            rows = list(memberships[:2])
            if len(rows) > 1:
                raise ValidationError(
                    {"detail": "Do‘konni tanlang (X-Tenant-ID sarlavhasi majburiy)."}
                )
            if not rows:
                return ActiveContext(None, None)
            employee = rows[0]
    elif user.role == "staff":
        employee = (
            Employee.objects.select_related("tenant")
            .filter(user=user, is_active=True, is_owner=False, tenant__is_active=True)
            .first()
        )
        if employee is None:
            return ActiveContext(None, None)
        if header_id is not None and header_id != employee.tenant_id:
            raise PermissionDenied("Bu do‘konga kirish huquqingiz yo‘q.")
    else:
        return ActiveContext(None, None)

    return ActiveContext(employee.tenant, employee)
