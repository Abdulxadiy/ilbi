"""Resolve a selected tenant from an authenticated user's active membership.

Tenant selection is request-scoped via X-Tenant-ID, validated against the
database on every request, and never trusted from the JWT or request body.
"""

from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied
from rest_framework.views import APIView

from apps.tenants.models import Tenant
from apps.accounts.services.tenant_context_service import (
    TENANT_HEADER,
    resolve_active_context,
)


class TenantContextMixin:
    """
    Mixin for DRF views that need to know which tenant a request is
    acting on.

    Sets `self.tenant` during permission evaluation:
      - staff / owner    -> active membership selected from the database.
      - platform_admin   -> `None` (platform_admin is not scoped to any
        single tenant by default).

    Views whose URL carries an explicit `tenant_id` (sub-resource
    endpoints like hire/fire, and future 9-bosqich business endpoints)
    should additionally call `resolve_tenant_from_url()` and use its
    return value as the acting tenant -- `self.tenant` alone is not
    enough there, since it is `None` for platform_admin even when the
    URL names a specific tenant.
    """

    # Name of the URL kwarg carrying an explicit tenant id, for views
    # that use resolve_tenant_from_url(). Override on the view if the
    # URL conf names it differently.
    tenant_url_kwarg = "tenant_id"
    tenant = None
    employee = None

    def check_permissions(self, request):
        context = resolve_active_context(
            request.user, request.META.get(TENANT_HEADER)
        )
        self.tenant = request.tenant = context.tenant
        self.employee = request.employee = context.employee
        super().check_permissions(request)

    def resolve_tenant_from_url(self, request, tenant_id=None):
        """
        Resolve the tenant a request is acting on when the URL names an
        explicit tenant (sub-resource endpoints, e.g.
        /tenants/{tenant_id}/employees/hire/).

        Authority rules:
          - platform_admin: may act on ANY tenant named in the URL.
          - owner: may act only on the selected tenant they own.
          - staff: may act only on the tenant in their active employment.

        Raises (both handled by DRF's default exception handler into a
        `{"detail": "..."}` response, matching prior behaviour):
          - Http404 (via get_object_or_404) if the tenant doesn't exist.
          - PermissionDenied (403) if the requester has no authority
            over it, or if the tenant is deactivated.
        """
        if tenant_id is None:
            tenant_id = self.kwargs.get(self.tenant_url_kwarg)

        tenant = get_object_or_404(Tenant, pk=tenant_id)
        user = request.user

        if user.role == "platform_admin":
            pass
        elif self.tenant is not None and tenant.id == self.tenant.id:
            pass
        else:
            raise PermissionDenied("You don't have authority over this tenant.")

        self._ensure_tenant_active(tenant)
        return tenant

    @staticmethod
    def _ensure_tenant_active(tenant):
        """A deactivated tenant is closed for business: no action on its
        behalf is allowed, regardless of who is asking."""
        if tenant is not None and not tenant.is_active:
            raise PermissionDenied("Bu do‘kon faol emas.")


class OwnerStaffOnlyAPIView(TenantContextMixin, APIView):
    """
    Shared base for endpoints that are owner/staff territory ONLY --
    platform_admin has no legitimate reason to manage a tenant's
    day-to-day business data (confirmed 2026-09 for `catalog`; reused
    as-is for `inventory` and every future business app, rather than
    re-deriving this check per app).

    `PermissionService.has_permission()` grants platform_admin every
    permission unconditionally, by design, for OTHER features -- so
    `HasEmployeePermission` alone would let platform_admin through
    here too. `self.tenant` is also `None` for platform_admin
    (`TenantContextMixin` only populates it for staff/owner), which
    would otherwise surface as a confusing empty queryset on GET and a
    crash on POST (tenant=None is not a valid FK value). This class
    closes both gaps with one explicit, loud check.

    Originally written as `catalog`'s private `CatalogAPIView` -- moved
    here once `inventory` needed the exact same behaviour, rather than
    duplicating it a second time.
    """

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if self.tenant is None:
            raise PermissionDenied(
                "this resource is only accessible to a tenant's own owner/staff."
            )
