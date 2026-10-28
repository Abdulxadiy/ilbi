from rest_framework.permissions import BasePermission
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
import secrets

from apps.accounts.services.permission_service import PermissionService
from apps.accounts.models import Employee


class IsInternalService(BasePermission):
    """Allow only tokens came from an internal service.
    Header: Authorization: Internal <token>"""

    def has_permission(self, request, view):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Internal '):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Internal service token talab qilinadi.")
        token = auth_header.split('Internal ')[1].strip()
        expected = getattr(settings, 'INTERNAL_SERVICE_TOKEN', '') or ''
        if not expected or not secrets.compare_digest(token, expected):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Yaroqsiz internal service token.")
        return True


class IsPlatformAdmin(BasePermission):
    """Allow access only authenticated platform_admin users."""

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role == 'platform_admin'
        )


class IsOwner(BasePermission):
    """Allow access only authenticated owner users."""

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role == 'owner'
        )


class IsActiveOwner(BasePermission):
    """Allow an owner only while they have an active owner membership."""

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and user.role == "owner"
            and Employee.objects.filter(
                user=user, is_owner=True, is_active=True, tenant__owner=user
            ).exists()
        )


class IsOwnerOrPlatformAdmin(BasePermission):
    """Allow access to either owner or platform_admin users."""

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in ('owner', 'platform_admin')
        )


class IsTenantMember(BasePermission):
    """
    Allows platform_admin(any tenant), owner(own tenant only),
    staff(own tenant only, read-only enforced in the view).
    """

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
        )

    def has_object_permission(self, request, view, obj):
        user = request.user
        if user.role == 'platform_admin':
            return True
        if user.role == 'owner':
            tenant = getattr(request, 'tenant', None)
            return bool(tenant and obj.id == tenant.id and obj.owner_id == user.id)
        if user.role == 'staff':
            tenant = getattr(request, 'tenant', None)
            return bool(tenant and obj.id == tenant.id)
        return False


class IsTenantOwnerOrPlatformAdmin(BasePermission):
    """Allows platform_admin(any tenant) or tenant's own owner."""

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
        )

    def has_object_permission(self, request, view, obj):
        user = request.user
        if user.role == 'platform_admin':
            return True
        tenant = getattr(request, 'tenant', None)
        return bool(
            user.role == 'owner'
            and tenant
            and obj.id == tenant.id
            and obj.owner_id == user.id
        )


class HasEmployeePermission(BasePermission):
    """
    Action-level permission gate, driven by PermissionService (checks
    Employee.permissions on the active employment, NOT
    user.user_permissions/Group).

    This class alone does NOT check WHICH tenant the user is acting
    on -- combine it with a tenant-scoping class (IsTenantMember /
    IsTenantOwnerOrPlatformAdmin) in any view whose data belongs to a
    specific tenant, e.g.:

        permission_classes = [HasEmployeePermission, IsTenantMember]

    Views declare what they need with a `required_permission`
    attribute -- a "app_label.codename" string, same format as
    Django's built-in user.has_perm():

        class ProductCreateView(APIView):
            required_permission = "catalog.add_product"
            permission_classes = [HasEmployeePermission, IsTenantMember]

    For views that need a different permission per HTTP method (e.g. a
    list+create view where GET needs "view_x" but POST needs
    "add_x"), declare `permission_map` instead:

        permission_map = {"GET": "catalog.view_product", "POST": "catalog.add_product"}
    """

    def has_permission(self, request, view):
        codename = self._required_permission(request, view)
        if isinstance(codename, (list, tuple, set)):
            return any(
                PermissionService.has_permission(
                    request.user,
                    c,
                    tenant=getattr(request, 'tenant', None),
                    employee=getattr(request, 'employee', None),
                )
                for c in codename
            )
        return PermissionService.has_permission(
            request.user,
            codename,
            tenant=getattr(request, 'tenant', None),
            employee=getattr(request, 'employee', None),
        )

    @staticmethod
    def _required_permission(request, view):
        permission_map = getattr(view, "permission_map", None)
        if permission_map is not None:
            method = "GET" if request.method == "HEAD" else request.method
            codename = permission_map.get(method)
            if method == "OPTIONS":
                codename = permission_map.get("GET") or next(iter(permission_map.values()), None)
            if codename is None:
                raise ImproperlyConfigured(
                    f"{view.__class__.__name__}.permission_map has no entry "
                    f"for method '{request.method}'."
                )
            return codename

        codename = getattr(view, "required_permission", None)
        if codename is None:
            raise ImproperlyConfigured(
                f"{view.__class__.__name__} uses HasEmployeePermission but "
                "defines neither `required_permission` nor `permission_map`."
            )
        return codename
