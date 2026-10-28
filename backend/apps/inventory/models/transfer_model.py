import uuid

from django.db import models
from django.db.models import Q


class TenantTransfer(models.Model):
    KIND_INTERNAL = "internal"
    KIND_RETURN = "return"
    KIND_CHOICES = [(KIND_INTERNAL, "Ichki transfer"), (KIND_RETURN, "Qaytish transferi")]

    STATUS_PENDING = "pending"
    STATUS_DELIVERED = "delivered"
    STATUS_DELIVERED_OWNER = "delivered_owner"
    STATUS_DISCREPANCY = "discrepancy"
    STATUS_CLOSED = "closed"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Qabul kutilmoqda"),
        (STATUS_DELIVERED, "Qabul qilindi"),
        (STATUS_DELIVERED_OWNER, "Yetkazildi (owner tasdig‘i)"),
        (STATUS_DISCREPANCY, "Tafovut bor"),
        (STATUS_CLOSED, "Tafovut yopildi"),
    ]

    request_key = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    request_fingerprint = models.CharField(max_length=64)
    source_tenant = models.ForeignKey("tenants.Tenant", on_delete=models.PROTECT, related_name="outgoing_transfers")
    destination_tenant = models.ForeignKey("tenants.Tenant", on_delete=models.PROTECT, related_name="incoming_transfers")
    seller_profile = models.ForeignKey("tenants.SellerProfile", on_delete=models.PROTECT, related_name="transfers")
    kind = models.CharField(max_length=12, choices=KIND_CHOICES, default=KIND_INTERNAL)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    created_by = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="created_tenant_transfers")
    received_by = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.PROTECT, related_name="received_tenant_transfers")
    return_of = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT, related_name="returns")
    note = models.TextField(blank=True)
    sent_at = models.DateTimeField(auto_now_add=True)
    received_at = models.DateTimeField(null=True, blank=True)
    discrepancy_closed_by = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.PROTECT, related_name="closed_transfer_discrepancies")
    discrepancy_closed_at = models.DateTimeField(null=True, blank=True)
    discrepancy_resolution = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.CheckConstraint(condition=~Q(source_tenant=models.F("destination_tenant")), name="transfer_tenants_differ"),
            models.CheckConstraint(
                condition=(Q(kind="return", return_of__isnull=False) | Q(kind="internal", return_of__isnull=True)),
                name="transfer_return_link_matches_kind",
            ),
        ]


class TenantTransferItem(models.Model):
    transfer = models.ForeignKey(TenantTransfer, on_delete=models.PROTECT, related_name="items")
    source_variant = models.ForeignKey("catalog.ProductVariant", on_delete=models.PROTECT, related_name="transfer_source_lines")
    destination_variant = models.ForeignKey("catalog.ProductVariant", null=True, blank=True, on_delete=models.PROTECT, related_name="transfer_destination_lines")
    destination_category = models.ForeignKey("catalog.Category", null=True, blank=True, on_delete=models.PROTECT, related_name="transfer_destination_lines")
    batch_manifest = models.JSONField(default=list, blank=True)
    quantity_sent = models.DecimalField(max_digits=14, decimal_places=3)
    cost_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    unit = models.CharField(max_length=10, blank=True)
    currency = models.CharField(max_length=3, blank=True)
    quantity_received = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    discrepancy_reason = models.TextField(blank=True)
    quantity_returned = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    quantity_return_in_transit = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    original_item = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT, related_name="return_items"
    )

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(quantity_sent__gt=0), name="transfer_line_sent_positive"),
            models.CheckConstraint(condition=Q(quantity_received__gte=0), name="transfer_line_received_nonnegative"),
            models.CheckConstraint(condition=Q(quantity_received__lte=models.F("quantity_sent")), name="transfer_line_received_lte_sent"),
            models.CheckConstraint(condition=Q(quantity_returned__gte=0), name="transfer_line_returned_nonnegative"),
            models.CheckConstraint(condition=Q(quantity_return_in_transit__gte=0), name="transfer_line_return_transit_nonnegative"),
            models.CheckConstraint(
                condition=Q(quantity_returned__lte=models.F("quantity_received")),
                name="transfer_line_returned_lte_received",
            ),
            models.UniqueConstraint(fields=["transfer", "source_variant"], name="transfer_variant_once"),
        ]
