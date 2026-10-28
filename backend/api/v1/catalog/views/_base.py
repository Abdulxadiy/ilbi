"""Shared base for catalog views. See api/mixins.py's OwnerStaffOnlyAPIView
for the platform_admin-blocking rationale (originally written here for
catalog, 2026-09; moved to api/mixins.py once `inventory` needed the
exact same behaviour)."""

from contextlib import nullcontext

from django.db import transaction

from api.mixins import OwnerStaffOnlyAPIView
from apps.core.services.catalog_activity import catalog_snapshot, record_catalog_activity


class CatalogAPIView(OwnerStaffOnlyAPIView):
    history_model = None

    def dispatch(self, request, *args, **kwargs):
        context = transaction.atomic() if request.method in ("POST", "PATCH", "DELETE") else nullcontext()
        with context:
            return super().dispatch(request, *args, **kwargs)

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        self._history_before = {}
        if self.history_model and request.method in ("POST", "PATCH", "DELETE"):
            # Serialize the before snapshot with the write, including category/image edits.
            type(self.tenant).objects.select_for_update().get(pk=self.tenant.pk)
            variant_id = request.data.get("variant_id")
            self._history_variant = variant_id if str(variant_id).isdigit() else None
            obj = self.history_model.objects.filter(pk=kwargs.get("pk"), tenant=self.tenant).first()
            self._history_before = catalog_snapshot(obj, variant_id=self._history_variant)

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        if self.history_model and request.method in ("POST", "PATCH", "DELETE") and 200 <= response.status_code < 300:
            target_id = kwargs.get("pk") or (response.data or {}).get("id")
            if target_id:
                obj = self.history_model.objects.filter(pk=target_id, tenant=self.tenant).first()
                record_catalog_activity(
                    request=request,
                    tenant=self.tenant,
                    model_name=self.history_model.__name__,
                    target_id=target_id,
                    before=self._history_before,
                    after=catalog_snapshot(obj, variant_id=self._history_variant),
                )
        return response
