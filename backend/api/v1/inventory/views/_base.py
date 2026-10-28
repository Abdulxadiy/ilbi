"""Shared base for inventory views -- see api/mixins.py's
OwnerStaffOnlyAPIView for the platform_admin-blocking rationale
(shared with catalog's identical _base.py)."""

from api.mixins import OwnerStaffOnlyAPIView


class InventoryAPIView(OwnerStaffOnlyAPIView):
    pass
