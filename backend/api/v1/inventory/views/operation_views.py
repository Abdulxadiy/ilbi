from rest_framework.response import Response

from api.permissions import HasEmployeePermission
from api.v1.inventory.idempotency import OPERATIONS, PROTOCOL
from apps.accounts.models import Employee
from apps.catalog.models import Category
from apps.tenants.models import Tenant, SellerProfile
from django.utils import timezone
from ._base import InventoryAPIView
from drf_spectacular.utils import extend_schema, OpenApiTypes


class InventoryOperationsCapabilitiesView(InventoryAPIView):
    permission_classes = [HasEmployeePermission]
    required_permission = 'inventory.view_stock'

    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        return Response({'protocol': PROTOCOL, 'operations': OPERATIONS})


class InventoryTransferOptionsView(InventoryAPIView):
    """Minimal mapping choices for permitted transfer workflows, never prices."""
    permission_classes = [HasEmployeePermission]
    required_permission = 'inventory.transfer_stock'

    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        def categories(tenant):
            return list(Category.objects.filter(tenant=tenant, is_active=True).order_by('name', 'pk').values('id', 'name', 'currency'))

        profile = self.tenant.seller_profile
        targets = []
        if profile and profile.status == SellerProfile.STATUS_APPROVED and profile.expires_at and profile.expires_at > timezone.now():
            for tenant in Tenant.objects.filter(owner=self.tenant.owner, seller_profile=profile, is_active=True).exclude(pk=self.tenant.pk).order_by('name', 'pk'):
                owner_mapping = (request.user.pk == self.tenant.owner_id == tenant.owner_id
                                 and Employee.objects.filter(tenant=tenant, user=request.user, is_owner=True, is_active=True).exists())
                targets.append({'id': tenant.pk, 'name': tenant.name, 'categories': categories(tenant) if owner_mapping else []})
        return Response({'categories': categories(self.tenant), 'targets': targets})
