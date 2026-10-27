from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field

from apps.core.models import AuditLog
from apps.core.audit_privacy import safe_audit_data, safe_audit_text


class AuditLogSerializer(serializers.ModelSerializer):
    changes = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()
    user_agent = serializers.SerializerMethodField()
    tenant_name = serializers.CharField(source="tenant.name", read_only=True, default=None)
    actor_phone = serializers.CharField(source="actor.phone_number", read_only=True, default=None)
    actor_name = serializers.CharField(source="actor.first_name", read_only=True, default=None)

    @extend_schema_field(serializers.JSONField())
    def get_changes(self, obj):
        return safe_audit_data(obj.changes)

    def get_description(self, obj) -> str:
        return safe_audit_text(obj.description)

    def get_user_agent(self, obj) -> str:
        return safe_audit_text(obj.user_agent)

    class Meta:
        model = AuditLog
        fields = [
            "id",
            "tenant",
            "tenant_name",
            "actor",
            "actor_phone",
            "actor_name",
            "action",
            "target_model",
            "target_id",
            "changes",
            "description",
            "ip_address",
            "user_agent",
            "created_at",
        ]
        read_only_fields = fields
