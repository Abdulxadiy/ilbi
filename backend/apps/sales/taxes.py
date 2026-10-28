"""Decimal VAT calculations; turnover and profit taxes never increase checkout totals."""

from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")


def money(value):
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


def calculate_line(*, quantity, unit_price, is_vat_payer=False, vat_rate=0, price_includes_vat=True):
    amount = money(Decimal(str(quantity)) * Decimal(str(unit_price)))
    if not is_vat_payer:
        return amount, Decimal("0.00"), amount
    rate = Decimal(str(vat_rate)) / 100
    if price_includes_vat:
        net = money(amount / (1 + rate))
        return net, amount - net, amount
    tax = money(amount * rate)
    return amount, tax, amount + tax


def cumulative_item_amount(item, quantity):
    """Prorate the original charged total, including VAT and original rounding."""
    quantity = Decimal(str(quantity))
    if quantity >= item.quantity:
        return item.total_price
    return money(item.total_price * quantity / item.quantity)
