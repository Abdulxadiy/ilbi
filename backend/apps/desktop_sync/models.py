import uuid

from django.db import models


class SyncDevice(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user_id = models.BigIntegerField()
    tenant_id = models.BigIntegerField()
    name = models.CharField(max_length=100)
    token_version = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)
    lease_until = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)


class SyncReceipt(models.Model):
    device = models.ForeignKey(SyncDevice, on_delete=models.PROTECT)
    operation_id = models.UUIDField()
    fingerprint = models.CharField(max_length=64)
    result = models.JSONField()
    received_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["device", "operation_id"], name="sync_receipt_device_operation")]


class SyncActor(models.Model):
    device = models.ForeignKey(SyncDevice, on_delete=models.CASCADE)
    user_id = models.BigIntegerField()
    token_version = models.PositiveIntegerField()
    credential_digest = models.CharField(max_length=64, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["device", "user_id"], name="sync_actor_device_user")]


class LocalOperation(models.Model):
    id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    sequence = models.BigAutoField(primary_key=True)
    user_id = models.BigIntegerField()
    tenant_id = models.BigIntegerField()
    title = models.CharField(max_length=200)
    payload = models.JSONField()
    dependencies = models.JSONField(default=list)
    resources = models.JSONField(default=list)
    status = models.CharField(max_length=20, default="waiting", db_index=True)
    priority = models.PositiveBigIntegerField(default=0)
    attempts = models.PositiveIntegerField(default=0)
    next_attempt_at = models.DateTimeField(null=True)
    error = models.TextField(blank=True)
    result = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True)

    class Meta:
        ordering = ["sequence"]


class LocalState(models.Model):
    key = models.CharField(max_length=80, primary_key=True)
    value = models.JSONField(default=dict)


class TenantSyncRevision(models.Model):
    tenant_id = models.BigIntegerField(primary_key=True)
    revision = models.PositiveBigIntegerField(default=0)


class SyncObjectMap(models.Model):
    device = models.ForeignKey(SyncDevice, on_delete=models.PROTECT)
    local_id = models.BigIntegerField()
    remote_id = models.BigIntegerField()
    model = models.CharField(max_length=80)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["device", "local_id"], name="sync_map_device_local_id")]


class LocalAlias(models.Model):
    local_id = models.BigIntegerField(primary_key=True)
    remote_id = models.BigIntegerField()
    active = models.BooleanField(default=False)


class PairingSession(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    device = models.ForeignKey(SyncDevice, on_delete=models.CASCADE)
    code_digest = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)
    claimed_at = models.DateTimeField(null=True)
    claim_digest = models.CharField(max_length=64, blank=True)
    client_name = models.CharField(max_length=80, blank=True)
    client_public_key = models.CharField(max_length=100, blank=True)
    encrypted_payload = models.JSONField(null=True)
    completed_at = models.DateTimeField(null=True)
