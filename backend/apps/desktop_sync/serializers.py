from rest_framework import serializers

from .protocol import LOCAL_ID_START


class OperationSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    method = serializers.ChoiceField(choices=["POST", "PATCH", "DELETE"])
    path = serializers.CharField(max_length=250)
    body = serializers.DictField()
    actor_ticket = serializers.CharField(max_length=4096)
    occurred_at = serializers.DateTimeField()
    dependencies = serializers.ListField(child=serializers.UUIDField(), max_length=5000)
    created = serializers.ListField(child=serializers.DictField(), max_length=5000)
    preconditions = serializers.ListField(child=serializers.DictField(), max_length=5000, required=False)

    def validate_created(self, value):
        from .snapshots import LABELS

        identifiers = set()
        for row in value:
            if (
                row.get("model") not in LABELS
                or type(row.get("id")) is not int
                or row["id"] < LOCAL_ID_START
                or row["id"] in identifiers
                or not isinstance(row.get("fields"), dict)
            ):
                raise serializers.ValidationError("Yangi yozuv identifikatori noto‘g‘ri.")
            identifiers.add(row["id"])
        return value

    def validate_preconditions(self, value):
        for row in value:
            if (
                row.get("model")
                not in {
                    "catalog.category",
                    "catalog.product",
                    "catalog.productvariant",
                    "sales.counterparty",
                    "core.workspacereminder",
                }
                or type(row.get("id")) is not int
                or not isinstance(row.get("fields"), dict)
            ):
                raise serializers.ValidationError("Versiya sharti noto‘g‘ri.")
        return value
