from datetime import timedelta
from decimal import Decimal
import uuid

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.permissions.models import Permission
from apps.inventory.models import Stock, TenantTransfer
from apps.catalog.models import Category
from apps.inventory.services.stock_service import StockService
from apps.inventory.services.transfer_service import TenantTransferError, TenantTransferService
from apps.tenants.models import SellerProfile
from tests.factories import EmployeeFactory, OwnerFactory, ProductVariantFactory, StaffFactory, TenantFactory

pytestmark = pytest.mark.django_db


def paired_shops():
    owner = OwnerFactory()
    profile = SellerProfile.objects.create(
        owner=owner, legal_form="ytt", official_name="Test YTT", tax_identifier="123456789",
        status=SellerProfile.STATUS_APPROVED, expires_at=timezone.now() + timedelta(days=30),
    )
    source = TenantFactory(owner=owner, seller_profile=profile)
    destination = TenantFactory(owner=owner, seller_profile=profile)
    EmployeeFactory(user=owner, tenant=source, is_owner=True)
    EmployeeFactory(user=owner, tenant=destination, is_owner=True)
    return owner, profile, source, destination


def test_owner_transfer_confirms_once_and_moves_stock_atomically():
    owner, _, source, destination = paired_shops()
    source_variant = ProductVariantFactory(tenant=source)
    destination_category = Category.objects.create(tenant=destination, name="Local category", kod="LOCAL", currency="UZS")
    StockService.intake(
        tenant=source, product_variant=source_variant, quantity=Decimal("8"),
        cost_price=Decimal("1"), created_by=owner,
    )

    transfer = TenantTransferService.dispatch(
        source=source, destination_id=destination.id, actor=owner, request_key=uuid.uuid4(),
        items=[{
            "source_variant_id": source_variant.id,
            "quantity": Decimal("3"),
            "destination_category_id": destination_category.id,
        }],
    )

    assert transfer.status == TenantTransfer.STATUS_DELIVERED_OWNER
    assert Stock.objects.get(tenant=source, product_variant=source_variant).quantity == Decimal("5")
    line = transfer.items.get()
    assert line.destination_variant.tenant_id == destination.id
    assert line.destination_variant.product.category_id == destination_category.id
    assert Stock.objects.get(tenant=destination, product_variant=line.destination_variant).quantity == Decimal("3")


def test_staff_transfer_waits_for_receipt_and_records_partial_discrepancy():
    owner, profile, source, destination = paired_shops()
    sender = StaffFactory()
    receiver = StaffFactory()
    EmployeeFactory(user=sender, tenant=source, is_owner=False)
    EmployeeFactory(user=receiver, tenant=destination, is_owner=False)
    source_variant = ProductVariantFactory(tenant=source)
    destination_category = Category.objects.create(tenant=destination, name="Accessories", kod="ACC", currency="UZS")
    StockService.intake(
        tenant=source, product_variant=source_variant, quantity=Decimal("8"),
        cost_price=Decimal("1"), created_by=owner,
    )

    transfer = TenantTransferService.dispatch(
        source=source, destination_id=destination.id, actor=sender, request_key=uuid.uuid4(),
        items=[{"source_variant_id": source_variant.id, "quantity": Decimal("5")}],
    )
    line = transfer.items.get()
    assert transfer.status == TenantTransfer.STATUS_PENDING
    assert Stock.objects.get(tenant=source, product_variant=source_variant).quantity == Decimal("3")
    assert not Stock.objects.filter(tenant=destination).exists()

    received = TenantTransferService.receive(
        transfer_id=transfer.id, destination=destination, actor=receiver,
        items=[{
            "item_id": line.id,
            "received_quantity": Decimal("4"),
            "destination_category_id": destination_category.id,
            "discrepancy_reason": "Bitta dona yetib kelmadi",
        }],
    )

    assert received.status == TenantTransfer.STATUS_DISCREPANCY
    assert line.__class__.objects.get(pk=line.id).destination_variant.product.category_id == destination_category.id
    assert Stock.objects.get(tenant=destination).quantity == Decimal("4")
    assert Stock.objects.get(tenant=source, product_variant=source_variant).quantity == Decimal("3")


def test_same_seller_profile_is_required_and_staff_cannot_claim_owner_shortcut():
    owner, _, source, destination = paired_shops()
    other_profile = SellerProfile.objects.create(
        owner=owner, legal_form="mchj", official_name="Other entity", tax_identifier="987654321",
        status=SellerProfile.STATUS_APPROVED, expires_at=timezone.now() + timedelta(days=30),
    )
    different_seller = TenantFactory(owner=owner, seller_profile=other_profile)
    EmployeeFactory(user=owner, tenant=different_seller, is_owner=True)
    source_variant = ProductVariantFactory(tenant=source)
    StockService.intake(
        tenant=source, product_variant=source_variant, quantity=Decimal("2"),
        cost_price=Decimal("1"), created_by=owner,
    )
    with pytest.raises(TenantTransferError, match="bir xil sotuvchi profiliga"):
        TenantTransferService.dispatch(
            source=source, destination_id=different_seller.id, actor=owner, request_key=uuid.uuid4(),
            items=[{"source_variant_id": source_variant.id, "quantity": Decimal("1")}],
        )

    sender = StaffFactory()
    EmployeeFactory(user=sender, tenant=source, is_owner=False)
    pending = TenantTransferService.dispatch(
        source=source, destination_id=destination.id, actor=sender, request_key=uuid.uuid4(),
        items=[{"source_variant_id": source_variant.id, "quantity": Decimal("1")}],
    )
    assert pending.status == TenantTransfer.STATUS_PENDING
    assert pending.received_by_id is None


def test_physical_return_is_separate_and_source_stock_returns_only_on_acceptance():
    owner, _, source, destination = paired_shops()
    sender = StaffFactory()
    receiver = StaffFactory()
    EmployeeFactory(user=sender, tenant=source, is_owner=False)
    EmployeeFactory(user=receiver, tenant=destination, is_owner=False)
    source_variant = ProductVariantFactory(tenant=source)
    category = Category.objects.create(tenant=destination, name="Category", kod="CAT", currency="UZS")
    StockService.intake(
        tenant=source, product_variant=source_variant, quantity=Decimal("8"),
        cost_price=Decimal("1"), created_by=owner,
    )
    dispatched = TenantTransferService.dispatch(
        source=source, destination_id=destination.id, actor=sender, request_key=uuid.uuid4(),
        items=[{"source_variant_id": source_variant.id, "quantity": Decimal("5")}],
    )
    original_line = dispatched.items.get()
    TenantTransferService.receive(
        transfer_id=dispatched.id, destination=destination, actor=receiver,
        items=[{"item_id": original_line.id, "received_quantity": Decimal("5"),
                "destination_category_id": category.id}],
    )
    original_line.refresh_from_db()

    returning = TenantTransferService.start_return(
        transfer_id=dispatched.id, source=destination, actor=receiver, request_key=uuid.uuid4(),
        items=[{"original_item_id": original_line.id, "quantity": Decimal("2")}],
    )

    assert returning.status == TenantTransfer.STATUS_PENDING
    assert Stock.objects.get(tenant=source, product_variant=source_variant).quantity == Decimal("3")
    assert Stock.objects.get(tenant=destination, product_variant=original_line.destination_variant).quantity == Decimal("3")
    return_line = returning.items.get()
    accepted_return = TenantTransferService.receive(
        transfer_id=returning.id, destination=source, actor=owner,
        items=[{"item_id": return_line.id, "received_quantity": Decimal("2")}],
    )

    original_line.refresh_from_db()
    assert accepted_return.kind == TenantTransfer.KIND_RETURN
    assert original_line.quantity_returned == Decimal("2")
    assert Stock.objects.get(tenant=source, product_variant=source_variant).quantity == Decimal("5")
    assert Stock.objects.get(tenant=destination, product_variant=original_line.destination_variant).quantity == Decimal("3")


def test_idempotency_key_replay_does_not_deduct_stock_twice():
    owner, _, source, destination = paired_shops()
    variant = ProductVariantFactory(tenant=source)
    category = Category.objects.create(tenant=destination, name="Category", kod="CAT", currency="UZS")
    StockService.intake(
        tenant=source, product_variant=variant, quantity=Decimal("5"),
        cost_price=Decimal("1"), created_by=owner,
    )
    key = uuid.uuid4()
    payload = [{"source_variant_id": variant.id, "quantity": Decimal("2"), "destination_category_id": category.id}]
    first = TenantTransferService.dispatch(
        source=source, destination_id=destination.id, actor=owner, request_key=key, items=payload,
    )
    replay = TenantTransferService.dispatch(
        source=source, destination_id=destination.id, actor=owner, request_key=key, items=payload,
    )

    assert first.id == replay.id
    assert TenantTransfer.objects.count() == 1
    assert Stock.objects.get(tenant=source, product_variant=variant).quantity == Decimal("3")


def test_transfer_api_resolves_same_profile_targets_and_records_actual_receive():
    owner, profile, source, destination = paired_shops()
    sender = StaffFactory()
    receiver = StaffFactory()
    sender_employee = EmployeeFactory(user=sender, tenant=source, is_owner=False)
    receiver_employee = EmployeeFactory(user=receiver, tenant=destination, is_owner=False)
    transfer_permission = Permission.objects.get(category="inventory", codename="transfer_stock")
    sender_employee.permissions.add(transfer_permission)
    receiver_employee.permissions.add(transfer_permission)
    variant = ProductVariantFactory(tenant=source)
    category = Category.objects.create(tenant=destination, name="Accessories", kod="ACC", currency="UZS")
    StockService.intake(
        tenant=source, product_variant=variant, quantity=Decimal("5"),
        cost_price=Decimal("1"), created_by=owner,
    )
    source_client = APIClient()
    source_client.force_authenticate(sender)

    targets = source_client.get("/api/v1/tenants/current/transfer-targets/", HTTP_X_TENANT_ID=str(source.id))
    assert targets.status_code == 200
    assert [target["id"] for target in targets.data] == [destination.id]
    sent = source_client.post(
        "/api/v1/inventory/transfers/",
        {"request_key": str(uuid.uuid4()), "destination_tenant_id": destination.id,
         "items": [{"source_variant_id": variant.id, "quantity": "2.000"}]},
        format="json", HTTP_X_TENANT_ID=str(source.id),
    )
    assert sent.status_code == 201
    assert sent.data["status"] == TenantTransfer.STATUS_PENDING

    line = sent.data["items"][0]
    destination_client = APIClient()
    destination_client.force_authenticate(receiver)
    received = destination_client.post(
        f"/api/v1/inventory/transfers/{sent.data['id']}/receive/",
        {"items": [{"item_id": line["id"], "received_quantity": "2.000",
                    "destination_category_id": category.id, "discrepancy_reason": ""}]},
        format="json", HTTP_X_TENANT_ID=str(destination.id),
    )

    assert received.status_code == 200
    assert received.data["status"] == TenantTransfer.STATUS_DELIVERED
    assert Stock.objects.get(tenant=destination).quantity == Decimal("2")
