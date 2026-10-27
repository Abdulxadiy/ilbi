from django.db import models
from .event_clock import EventDateTimeField


class BaseModel(models.Model):
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.CASCADE)
    created_at = EventDateTimeField(auto_now_add=True)
    updated_at = EventDateTimeField(auto_now=True)

    class Meta:
        abstract = True


class WorkspaceReminder(BaseModel):
    title = models.CharField(max_length=200)
    due_at = models.DateTimeField()
    created_by = models.ForeignKey('accounts.User', on_delete=models.CASCADE, related_name='created_workspace_reminders')
    assigned_to = models.ForeignKey('accounts.User', on_delete=models.CASCADE, related_name='workspace_reminders')
    completed_at = models.DateTimeField(null=True, blank=True)
    due_notified_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['due_at', 'pk']
        indexes = [
            models.Index(fields=['tenant', 'assigned_to', 'completed_at', 'due_at'], name='workspace_reminder_due_idx'),
            models.Index(fields=['due_at', 'id'], condition=models.Q(completed_at__isnull=True, due_notified_at__isnull=True), name='workspace_due_notice_idx'),
        ]


class AuditAction(models.TextChoices):
    CATALOG_CREATE = "catalog_create", "Katalogga qo‘shildi"
    CATALOG_UPDATE = "catalog_update", "Katalog tahrirlandi"
    CATALOG_ARCHIVE = "catalog_archive", "Katalog arxivlandi"
    CATALOG_RESTORE = "catalog_restore", "Katalog tiklandi"
    CATALOG_DELETE = "catalog_delete", "Katalogdan o‘chirildi"
    ACCOUNT_IDENTITY_UPDATE = "account_identity_update", "Login va Telegram yangilandi"
    SUPPORT_TELEGRAM_SETTINGS = "support_telegram_settings", "Yordam bildirishnomalari sozlandi"
    CATALOG_IMPORT = "catalog_import", "Catalog import"
    COUNTERPARTY_IMPORT = "counterparty_import", "Mijozlar fayldan yuklandi"
    BARCODE_GENERATE = "barcode_generate", "Barcode generated"
    PRICE_CHANGE = "price_change", "Price Change"
    EMPLOYEE_HIRE = "employee_hire", "Employee Hire"
    EMPLOYEE_FIRE = "employee_fire", "Employee Fire"
    EMPLOYEE_UPDATE = "employee_update", "Employee Update"
    EMPLOYEE_BLOCK = "employee_block", "Employee Block"
    EMPLOYEE_UNBLOCK = "employee_unblock", "Employee Unblock"
    EMPLOYEE_ARCHIVE = "employee_archive", "Employee Archive"
    EMPLOYEE_RESTORE = "employee_restore", "Employee Restore"
    EMPLOYEE_INVITE = "employee_invite", "Employee Invite"
    OWNER_TRANSFER = "owner_transfer", "Owner Transfer"
    TENANT_CREATE = "tenant_create", "Tenant Create"
    TENANT_UPDATE = "tenant_update", "Tenant Update"
    VOID_SALE = "void_sale", "Void Sale"
    STOCK_ADJUSTMENT = "stock_adjustment", "Stock Adjustment"
    CASH_DISCREPANCY = "cash_discrepancy", "Cash Discrepancy"
    LOGIN_ATTEMPT = "login_attempt", "Login Attempt"
    PASSWORD_RESET = "password_reset", "Password Reset"
    RECEIPT_TOKEN_ROTATE = "receipt_token_rotate", "Receipt Token Rotate"
    SELLER_PROFILE_SUBMIT = "seller_profile_submit", "Seller Profile Submit"
    SELLER_PROFILE_REVIEW = "seller_profile_review", "Seller Profile Review"
    SELLER_PROFILE_BINDING = "seller_profile_binding", "Seller Profile Binding"
    TENANT_TRANSFER_DISPATCH = "tenant_transfer_dispatch", "Tenant Transfer Dispatch"
    TENANT_TRANSFER_RECEIVE = "tenant_transfer_receive", "Tenant Transfer Receive"
    TENANT_TRANSFER_DISCREPANCY = "tenant_transfer_discrepancy", "Tenant Transfer Discrepancy"
    TENANT_TRANSFER_RETURN = "tenant_transfer_return", "Tenant Transfer Return"
    B2B_RETURN_PENDING = "b2b_return_pending", "B2B Return Pending"
    B2B_RETURN_RECEIVE = "b2b_return_receive", "B2B Return Receive"
    B2B_RETURN_DISCREPANCY_CLOSE = "b2b_return_discrepancy_close", "B2B Return Discrepancy Close"


class ImmutableAuditLogQuerySet(models.QuerySet):
    def delete(self):
        from django.core.exceptions import ValidationError
        raise ValidationError("AuditLog entries cannot be deleted.")

    def update(self, **kwargs):
        # Allow Django CASCADE/SET_NULL collector to set foreign keys to NULL on delete
        allowed_null_keys = {'tenant', 'actor'}
        if set(kwargs.keys()).issubset(allowed_null_keys) and all(v is None for v in kwargs.values()):
            return super().update(**kwargs)
        from django.core.exceptions import ValidationError
        raise ValidationError("AuditLog entries cannot be updated.")


class AuditLog(models.Model):
    tenant = models.ForeignKey(
        'tenants.Tenant',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='audit_logs',
        db_index=True,
    )
    actor = models.ForeignKey(
        'accounts.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='audit_logs',
    )
    action = models.CharField(
        max_length=50,
        choices=AuditAction.choices,
        db_index=True,
    )
    target_model = models.CharField(max_length=100, blank=True)
    target_id = models.CharField(max_length=64, blank=True)
    changes = models.JSONField(default=dict, blank=True)
    description = models.TextField(blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    objects = ImmutableAuditLogQuerySet.as_manager()

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['tenant', 'action', '-created_at']),
        ]

    def save(self, *args, **kwargs):
        if self.pk:
            from django.core.exceptions import ValidationError
            raise ValidationError("AuditLog entries are immutable and cannot be updated.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        from django.core.exceptions import ValidationError
        raise ValidationError("AuditLog entries are append-only and cannot be deleted.")

    def __str__(self):
        return f"[{self.created_at}] {self.action} by {self.actor_id or 'System'} (Tenant: {self.tenant_id})"
