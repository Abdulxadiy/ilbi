from copy import deepcopy
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from api.v1.sales.serializers import (
    B2BIncomingSaleItemSerializer,
    PublicReceiptItemSerializer,
    SaleItemOutputSerializer,
)
from apps.inventory.models import Stock
from apps.inventory.services import StockService
from apps.sales.models import Sale, SaleItem
from apps.sales.services.sale_service import SaleService
from apps.sales.services.void_service import VoidService
from tests.factories import ProductFactory, ProductVariantFactory

pytestmark = pytest.mark.django_db
MXIK = "03816001001000000"


@pytest.fixture
def variant(tenant, owner):
    product = ProductFactory(tenant=tenant, name="Sement")
    variant = ProductVariantFactory(
        tenant=tenant,
        product=product,
        name="Qop",
        code="01/02/10",
        barcode="0012345678901",
        mxik=MXIK,
        package_code="0001234",
        unit="kg",
        price_recommended="1000",
    )
    StockService.intake(tenant=tenant, product_variant=variant, quantity=10, cost_price=500, created_by=owner)
    return variant


def sell(tenant, owner, variant):
    return SaleService.create_sale(
        tenant=tenant,
        user=owner,
        idempotency_key="snapshot-checkout",
        items_data=[{"product_variant_id": variant.pk, "quantity": "2"}],
    )[0]


def test_catalog_changes_cannot_rewrite_new_receipts_and_replay(tenant, owner, variant):
    sale = sell(tenant, owner, variant)
    original = deepcopy(sale.items.get().product_snapshot)
    assert original == {
        "version": 1,
        "product_name": "Sement",
        "product_variant_name": "Qop",
        "product_code": "01/02/10",
        "product_sku": variant.sku,
        "product_barcode": "0012345678901",
        "unit": "kg",
        "mxik": MXIK,
        "package_code": "0001234",
    }
    variant.product.name = "Yangi mahsulot"
    variant.product.save(update_fields=["name"])
    variant.name, variant.code, variant.barcode = "Yangi variant", "other", "99999999"
    variant.mxik, variant.package_code = "12345678901234567", "0009"
    variant.price_recommended = 9999
    variant.save()
    item = sale.items.get()
    for serializer in (SaleItemOutputSerializer, PublicReceiptItemSerializer, B2BIncomingSaleItemSerializer):
        data = serializer(item).data
        for key in ("product_name", "product_variant_name", "unit", "mxik", "package_code"):
            assert data[key] == original[key]
        if "product_barcode" in data:
            assert data["product_barcode"] == original["product_barcode"]
        assert "cost_price" not in data

    client = APIClient()
    client.force_authenticate(owner)
    client.credentials(HTTP_X_TENANT_ID=str(tenant.pk))
    detail = client.get(f"/api/v1/sales/{sale.pk}/")
    assert detail.status_code == 200, detail.data
    assert detail.data["items"][0]["product_name"] == "Sement"
    client.force_authenticate(None)
    public = client.get(f"/api/v1/sales/public/receipt/{sale.public_token}/")
    assert public.status_code == 200, public.data
    assert public.data["items"][0]["product_name"] == "Sement"
    assert public.data["items"][0]["mxik"] == MXIK
    assert "cost_price" not in public.data["items"][0]

    assert sell(tenant, owner, variant).pk == sale.pk
    assert Sale.objects.filter(tenant=tenant).count() == 1
    assert Stock.objects.get(product_variant=variant).quantity == 8
    assert sale.items.get().product_snapshot == original
    VoidService.void_sale_item(sale_item=item, user=owner, quantity=Decimal("1"), reason="Qisman qaytish")
    sale.refresh_from_db()
    assert sale.total_amount == 2000
    assert sale.refunded_amount == 1000
    assert sale.items.get().product_snapshot == original


def test_empty_codes_remain_empty_after_catalog_is_completed(tenant, owner, variant):
    variant.mxik = variant.package_code = variant.barcode = None
    variant.save()
    sale = sell(tenant, owner, variant)
    ProductVariantFactory(tenant=tenant, mxik=MXIK, package_code="0001")
    variant.mxik, variant.package_code, variant.barcode = MXIK, "0002", "12345"
    variant.save()
    item = sale.items.get()
    data = SaleItemOutputSerializer(item).data
    assert data["mxik"] is data["package_code"] is data["product_barcode"] is None
    assert item.product_snapshot["mxik"] is None


def test_legacy_rows_are_readable_without_backfilling_fiscal_history(tenant, owner, variant):
    sale = Sale.objects.create(tenant=tenant, sold_by=owner, receipt_number="LEGACY-SNAPSHOT", total_amount=1000)
    item = SaleItem.objects.create(
        tenant=tenant, sale=sale, product_variant=variant, quantity=1, unit_price=1000, cost_price=500, total_price=1000
    )
    for serializer in (SaleItemOutputSerializer, PublicReceiptItemSerializer, B2BIncomingSaleItemSerializer):
        data = serializer(item).data
        assert data["product_name"] == "Sement"
        assert data["unit"] == "kg"
        assert data["mxik"] is data["package_code"] is None
    item.refresh_from_db()
    assert item.product_snapshot is None
