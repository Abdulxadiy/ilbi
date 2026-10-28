from rest_framework import serializers


def positive_id(value, field):
    if value in (None, ''):
        return None
    try:
        return serializers.IntegerField(min_value=1).run_validation(value)
    except serializers.ValidationError as exc:
        raise serializers.ValidationError({field: exc.detail}) from exc


def nonnegative_price(value, field):
    try:
        return serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0).run_validation(value)
    except serializers.ValidationError as exc:
        raise serializers.ValidationError({field: exc.detail}) from exc
