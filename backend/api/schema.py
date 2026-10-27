from drf_spectacular.contrib.rest_framework_simplejwt import SimpleJWTScheme
from drf_spectacular.openapi import AutoSchema
from drf_spectacular.utils import PolymorphicProxySerializer, inline_serializer
from rest_framework import serializers


class IlbiJWTScheme(SimpleJWTScheme):
    target_class = 'apps.accounts.authentication.CustomJWTAuthentication'


class IlbiAutoSchema(AutoSchema):
    def get_operation_id(self):
        path = self.path.strip('/').replace('/', '_').replace('{', '').replace('}', '')
        return f'{self.view.__class__.__name__}_{self.method.lower()}_{path}'

    def _map_serializer(self, serializer, direction, bypass_extensions=False):
        schema = super()._map_serializer(serializer, direction, bypass_extensions)
        if direction == 'response':
            for field in ('cost_price', 'last_cost_price'):
                if field not in schema.get('properties', {}):
                    continue
                schema['properties'][field]['description'] = 'Only returned with catalog.view_cost_price permission.'
                if field in schema.get('required', []):
                    schema['required'].remove(field)
        return schema



def optional_pagination(serializer_class):
    """Legacy lists return an array unless the caller supplies ?page=."""
    name = serializer_class.__name__.removesuffix('Serializer')
    page = inline_serializer(name=f'{name}Page', fields={
        'count': serializers.IntegerField(),
        'next': serializers.URLField(allow_null=True),
        'previous': serializers.URLField(allow_null=True),
        'results': serializer_class(many=True),
    })
    return PolymorphicProxySerializer(
        component_name=f'{name}ListResponse',
        serializers=[serializer_class(many=True), page],
        resource_type_field_name=None, many=False,
    )


class PasswordChangeInputSerializer(serializers.Serializer):
    old_password = serializers.CharField()
    new_password = serializers.CharField(min_length=8)


class ImageUploadInputSerializer(serializers.Serializer):
    image = serializers.ImageField()
    order = serializers.IntegerField(required=False, default=0)


class AvatarUploadInputSerializer(serializers.Serializer):
    avatar = serializers.ImageField()


class DocumentUpdateInputSerializer(serializers.Serializer):
    doc = serializers.CharField()
    content = serializers.CharField(allow_blank=True)


class ShiftStatusSerializer(serializers.Serializer):
    shift_id = serializers.IntegerField(allow_null=True)
    last_report_id = serializers.IntegerField(allow_null=True)
    is_open = serializers.BooleanField()
    status = serializers.ChoiceField(choices=['OPEN', 'CLOSED'])
    shift_start = serializers.DateTimeField(allow_null=True)
    incomes = serializers.ListField(child=serializers.DictField())
    expenses = serializers.ListField(child=serializers.DictField())


for _name in (
    'opening_cash', 'suggested_opening_cash', 'total_sale_cash', 'total_sale_card',
    'total_sale_debt', 'total_extra_income', 'total_expenses', 'collected_debt_cash',
    'refund_cash', 'expected_cash',
):
    for _currency in ('uzs', 'usd'):
        ShiftStatusSerializer._declared_fields[f'{_name}_{_currency}'] = serializers.DecimalField(
            max_digits=14, decimal_places=2,
        )
