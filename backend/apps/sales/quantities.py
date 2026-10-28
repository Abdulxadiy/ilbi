"""One recognition rule for sales analytics and replenishment."""
from django.db.models import Case, DecimalField, F, Q, When


def effective_quantity(item):
    if item.sale.b2b_target_tenant_id or item.sale.status.startswith('b2b_'):
        return item.b2b_accepted_quantity
    return item.quantity - item.voided_quantity


def effective_quantity_expression():
    return Case(
        When(Q(sale__b2b_target_tenant__isnull=False) | Q(sale__status__startswith='b2b_'),
             then=F('b2b_accepted_quantity')),
        default=F('quantity') - F('voided_quantity'),
        output_field=DecimalField(max_digits=14, decimal_places=3),
    )
