"""Field permissions shared by tenant business responses."""
from apps.accounts.services.permission_service import PermissionService


class SensitiveCostSerializerMixin:
    cost_fields = ('cost_price', 'last_cost_price')

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request')
        allowed = False
        if request is not None:
            # One permission lookup per request, shared by all rows and nested
            # serializers; never retain authorization between requests.
            cache = getattr(request, "_cost_permission_cache", None)
            if cache is None:
                cache = request._cost_permission_cache = {}
            tenant = getattr(request, 'tenant', None)
            employee = getattr(request, 'employee', None)
            key = (request.user.pk, getattr(tenant, 'pk', None), getattr(employee, 'pk', None))
            if key not in cache:
                cache[key] = PermissionService.has_permission(
                    request.user, 'catalog.view_cost_price', tenant=tenant, employee=employee,
                )
            allowed = cache[key]
        if not allowed:
            for field in self.cost_fields:
                data.pop(field, None)
        return data


class SensitiveSupplierSerializerMixin:
    supplier_fields = ('supplier',)

    def to_representation(self, instance):
        import re

        data = super().to_representation(instance)
        request = self.context.get('request')
        allowed = False
        if request is not None:
            cache = getattr(request, "_supplier_permission_cache", None)
            if cache is None:
                cache = request._supplier_permission_cache = {}
            tenant = getattr(request, 'tenant', None)
            employee = getattr(request, 'employee', None)
            key = (request.user.pk, getattr(tenant, 'pk', None), getattr(employee, 'pk', None))
            if key not in cache:
                cache[key] = PermissionService.has_permission(
                    request.user, 'inventory.view_supplier', tenant=tenant, employee=employee,
                )
            allowed = cache[key]
        if not allowed:
            for field in self.supplier_fields:
                data.pop(field, None)
            if "note" in data and isinstance(data["note"], str):
                data["note"] = re.sub(r"Ta[’']minotchi:\s*[^|]+(\|)?", "", data["note"], flags=re.IGNORECASE).strip(" |")
        return data
