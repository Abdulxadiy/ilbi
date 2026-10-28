from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from django.core import signing
from django.test import override_settings
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APIClient

from apps.desktop_sync.cloud import SyncConflict, apply_operation, rewrite
from apps.desktop_sync.local import enqueue, next_operation, ordered_operations, prioritize, queue_status
from apps.desktop_sync.models import LocalOperation, SyncDevice, SyncReceipt
from apps.desktop_sync.protocol import LOCAL_ID_START, allowed
from apps.desktop_sync.snapshots import export_snapshot, import_snapshot
from tests.factories import CounterpartyFactory, EmployeeFactory, ProductVariantFactory, StaffFactory, TenantFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def device(owner, tenant):
    return SyncDevice.objects.create(
        user_id=owner.pk,
        tenant_id=tenant.pk,
        name="Test desktop",
        token_version=owner.token_version,
        lease_until=timezone.now() + timedelta(days=7),
    )


def command(device, path="sales/counterparties/", body=None, **extra):
    ticket = signing.dumps(
        {"device_id": str(device.pk), "user_id": device.user_id, "token_version": device.token_version},
        salt="ilbi-offline-actor",
        compress=True,
    )
    return {
        "id": str(uuid4()),
        "path": path,
        "method": "POST",
        "body": body or {"name": "Offline mijoz", "phone_number": "+998901234567"},
        "created": [],
        "dependencies": [],
        "actor_ticket": ticket,
        "occurred_at": timezone.now().isoformat(),
        **extra,
    }


def local_row(tenant, owner, **values):
    return LocalOperation.objects.create(user_id=owner.pk, tenant_id=tenant.pk, title="Savdo", payload={}, **values)


def test_optional_debt_date_survives_offline_replay_and_snapshot(owner, tenant, device):
    from apps.sales.models import Counterparty
    selected = (timezone.localdate() + timedelta(days=2)).isoformat()
    payload = command(device, body={'name': 'Offline sana', 'phone_number': '+998900000110', 'debt_due_date': selected},
                      created=[{'model': 'sales.counterparty', 'id': LOCAL_ID_START, 'fields': {}}])
    first = apply_operation(owner, device.pk, payload)
    assert apply_operation(owner, device.pk, payload) == first
    pk = first['id_map'][str(LOCAL_ID_START)]
    assert Counterparty.objects.get(pk=pk).debt_due_date.isoformat() == selected
    row = next(row for row in export_snapshot(tenant)['rows'] if row['model'] == 'sales.counterparty' and row['pk'] == pk)
    assert row['fields']['debt_due_date'] == selected
    apply_operation(owner, device.pk, command(device, path=f'sales/counterparties/{pk}/', method='PATCH',
                                            body={'debt_due_date': None}, preconditions=[{
                                                'model': 'sales.counterparty', 'id': pk, 'fields': {'debt_due_date': selected},
                                            }]))
    assert Counterparty.objects.get(pk=pk).debt_due_date is None


def test_offline_date_edits_protect_web_changes_but_ignore_notification_bookkeeping(owner, tenant, device):
    from apps.sales.services import CounterpartyService
    from apps.desktop_sync.protocol import preconditions, record_changes
    old = timezone.localdate()
    cp = CounterpartyFactory(tenant=tenant, debt_due_date=old, debt_balance_uzs=100)
    with record_changes() as changes:
        CounterpartyService.update(cp, debt_due_date=old + timedelta(days=1))
    assert preconditions(changes) == [{'model': 'sales.counterparty', 'id': cp.pk, 'fields': {'debt_due_date': old.isoformat()}}]
    payload = command(device, path=f'sales/counterparties/{cp.pk}/', method='PATCH',
                      body={'debt_due_date': None}, preconditions=preconditions(changes))
    with pytest.raises(SyncConflict):
        apply_operation(owner, device.pk, payload)
    cp.refresh_from_db()
    assert cp.debt_due_date == old + timedelta(days=1)
    with record_changes() as bookkeeping:
        cp.last_notified_debt_due_date = cp.debt_due_date
        cp.save(update_fields=['last_notified_debt_due_date'])
    assert preconditions(bookkeeping) == []


@pytest.mark.parametrize('selected_date', [None, '2035-03-15'])
def test_explicit_unchanged_debt_date_still_guards_against_a_web_replacement(owner, tenant, device, selected_date):
    from datetime import date
    from apps.sales.services import CounterpartyService
    from apps.desktop_sync.protocol import preconditions, record_changes
    selected = date.fromisoformat(selected_date) if selected_date else None
    cp = CounterpartyFactory(tenant=tenant, debt_due_date=selected, debt_balance_uzs=100)
    with record_changes() as changes:
        CounterpartyService.update(cp, debt_due_date=selected)
    expected = [{'model': 'sales.counterparty', 'id': cp.pk, 'fields': {'debt_due_date': selected_date}}]
    assert preconditions(changes) == expected
    CounterpartyService.update(cp, debt_due_date=date(2035, 4, 1))
    payload = command(device, path=f'sales/counterparties/{cp.pk}/', method='PATCH',
                      body={'debt_due_date': selected_date}, preconditions=expected)
    with pytest.raises(SyncConflict):
        apply_operation(owner, device.pk, payload)
    cp.refresh_from_db()
    assert cp.debt_due_date == date(2035, 4, 1)


def test_financial_settlement_does_not_add_a_schedule_conflict(owner, tenant):
    from decimal import Decimal
    from apps.sales.services import DebtService
    from apps.desktop_sync.protocol import preconditions, record_changes
    cp = CounterpartyFactory(tenant=tenant, debt_due_date=timezone.localdate(), debt_balance_uzs=100)
    with record_changes() as changes:
        DebtService.record_payment(counterparty=cp, amount=Decimal('100'), currency='UZS', recorded_by=owner)
    assert preconditions(changes) == []
    cp.refresh_from_db()
    assert cp.debt_due_date is None


def test_lost_ack_replay_is_exactly_once(owner, tenant, device):
    payload = command(device, created=[{"model": "sales.counterparty", "id": LOCAL_ID_START, "fields": {}}])
    first = apply_operation(owner, device.pk, payload)
    second = apply_operation(owner, device.pk, payload)
    assert first == second
    from apps.sales.models import Counterparty

    assert Counterparty.objects.filter(tenant=tenant, name="Offline mijoz").count() == 1
    assert SyncReceipt.objects.filter(device=device).count() == 1
    assert first["id_map"][str(LOCAL_ID_START)] < LOCAL_ID_START


def test_changed_duplicate_is_rejected(owner, device):
    payload = command(device)
    apply_operation(owner, device.pk, payload)
    payload["body"]["name"] = "Boshqa mijoz"
    with pytest.raises(SyncConflict):
        apply_operation(owner, device.pk, payload)


def test_dependency_and_created_id_remapping(owner, tenant, device):
    first = command(device, created=[{"model": "sales.counterparty", "id": LOCAL_ID_START, "fields": {}}])
    second = command(
        device,
        path=f"sales/counterparties/{LOCAL_ID_START}/",
        method="PATCH",
        body={"name": "Yangi ism"},
        dependencies=[first["id"]],
    )
    with pytest.raises(SyncConflict):
        apply_operation(owner, device.pk, second)
    result = apply_operation(owner, device.pk, first)
    apply_operation(owner, device.pk, second)
    from apps.sales.models import Counterparty

    assert Counterparty.objects.get(pk=result["id_map"][str(LOCAL_ID_START)]).name == "Yangi ism"


def test_web_edit_conflict_does_not_erase_data(owner, tenant, device):
    cp = CounterpartyFactory(tenant=tenant, name="Webdagi yangi ism")
    payload = command(
        device,
        path=f"sales/counterparties/{cp.pk}/",
        method="PATCH",
        body={"name": "Offline ism"},
        preconditions=[{"model": "sales.counterparty", "id": cp.pk, "fields": {"name": "Eski ism"}}],
    )
    with pytest.raises(SyncConflict):
        apply_operation(owner, device.pk, payload)
    cp.refresh_from_db()
    assert cp.name == "Webdagi yangi ism"
    assert not SyncReceipt.objects.filter(operation_id=payload["id"]).exists()


def test_device_and_tenant_isolation(owner, tenant, device):
    other = TenantFactory()
    with pytest.raises(PermissionDenied):
        apply_operation(other.owner, device.pk, command(device))
    assert not SyncReceipt.objects.exists()


def test_revoked_actor_is_rejected(owner, tenant, device):
    staff = StaffFactory()
    employee = EmployeeFactory(user=staff, tenant=tenant)
    payload = command(device)
    payload["actor_ticket"] = signing.dumps(
        {"device_id": str(device.pk), "user_id": staff.pk, "token_version": staff.token_version},
        salt="ilbi-offline-actor",
        compress=True,
    )
    employee.is_active = False
    employee.save()
    with pytest.raises(PermissionDenied):
        apply_operation(owner, device.pk, payload)


def test_actor_permissions_are_not_replaced_by_owners(owner, tenant, device):
    staff = StaffFactory()
    EmployeeFactory(user=staff, tenant=tenant)
    payload = command(device)
    payload["actor_ticket"] = signing.dumps(
        {"device_id": str(device.pk), "user_id": staff.pk, "token_version": staff.token_version},
        salt="ilbi-offline-actor",
        compress=True,
    )
    with pytest.raises(SyncConflict):
        apply_operation(owner, device.pk, payload)
    assert not SyncReceipt.objects.exists()


def test_priority_preserves_active_and_fifo(owner, tenant):
    active = local_row(tenant, owner, status="active")
    normal = local_row(tenant, owner)
    urgent1 = local_row(tenant, owner)
    urgent2 = local_row(tenant, owner)
    prioritize(urgent1.id)
    prioritize(urgent2.id)
    result = ordered_operations(LocalOperation.objects.all())
    assert [row.id for row in result] == [active.id, urgent1.id, urgent2.id, normal.id]
    active.refresh_from_db()
    assert active.status == "active" and active.payload == {}


def test_priority_brings_dependency_first(owner, tenant):
    unrelated = local_row(tenant, owner)
    parent = local_row(tenant, owner)
    child = local_row(tenant, owner, dependencies=[str(parent.id)])
    prioritize(child.id)
    assert [row.id for row in ordered_operations(LocalOperation.objects.all())] == [parent.id, child.id, unrelated.id]
    assert next_operation().id == parent.id
    parent.status = "error"
    parent.save()
    assert next_operation().id == unrelated.id


def test_shared_stock_dependency_is_automatic(owner, tenant):
    first = enqueue(
        user_id=owner.pk,
        tenant_id=tenant.pk,
        payload={},
        resources={"inventory.stock:1"},
        references=set(),
        title="Savdo",
    )
    second = enqueue(
        user_id=owner.pk,
        tenant_id=tenant.pk,
        payload={},
        resources={"inventory.stock:1"},
        references=set(),
        title="Qaytarish",
    )
    third = enqueue(
        user_id=owner.pk,
        tenant_id=tenant.pk,
        payload={},
        resources={"catalog.product:2"},
        references=set(),
        title="Tahrir",
    )
    assert second.dependencies == [str(first.id)]
    assert third.dependencies == []


def test_snapshot_excludes_passwords_and_unrelated_stores(owner, tenant):
    other = TenantFactory()
    foreign_variant = ProductVariantFactory(product__category__tenant=other)
    local_variant = ProductVariantFactory(product__category__tenant=tenant)
    snapshot = export_snapshot(tenant)
    objects = {(row["model"], row["pk"]) for row in snapshot["rows"]}
    assert ("catalog.productvariant", local_variant.pk) in objects
    assert ("catalog.productvariant", foreign_variant.pk) not in objects
    assert ("tenants.tenant", other.pk) not in objects
    for row in snapshot["rows"]:
        if row["model"] == "accounts.user":
            assert row["fields"]["password"].startswith("!")
            assert not row["fields"]["is_superuser"]


def test_snapshot_import_cannot_touch_cloud(owner, tenant):
    with pytest.raises(RuntimeError):
        import_snapshot(export_snapshot(tenant))


def test_snapshot_import_retains_queue_and_reserved_ids(owner, tenant):
    snapshot = export_snapshot(tenant)
    row = local_row(tenant, owner)
    with override_settings(DESKTOP_MODE=True):
        with pytest.raises(ValueError):
            import_snapshot(snapshot)
        row.status = "done"
        row.save()
        import_snapshot(snapshot)
    assert LocalOperation.objects.filter(id=row.id, status="done").exists()
    from apps.sales.models import Counterparty

    new = Counterparty.objects.create(tenant_id=tenant.pk, name="Local")
    assert new.pk >= LOCAL_ID_START


def test_forbidden_replay_routes():
    for path in [
        "auth/change-password/",
        "internal/shop/orders/",
        "platform/accounts/",
        "sales/b2b/1/accept/",
        "../tenants/1/",
    ]:
        assert not allowed("POST", path)
    assert allowed("POST", "catalog/products/1000000000000/variants/")


def test_id_rewrite_preserves_money_and_barcode():
    result = rewrite(
        {
            "category": LOCAL_ID_START,
            "amount": LOCAL_ID_START,
            "barcode": str(LOCAL_ID_START),
            "items": [{"product_variant_id": LOCAL_ID_START}],
        },
        {str(LOCAL_ID_START): 17},
    )
    assert result == {
        "category": 17,
        "amount": LOCAL_ID_START,
        "barcode": str(LOCAL_ID_START),
        "items": [{"product_variant_id": 17}],
    }


def test_one_primary_per_store_but_independent_stores_can_enroll(owner, tenant):
    client = APIClient()
    client.force_authenticate(owner)
    first = client.post("/api/v1/sync/devices/", {"protocol": 1, "tenant_id": tenant.pk}, format="json")
    assert first.status_code == 200, first.data
    assert (
        client.post("/api/v1/sync/devices/", {"protocol": 1, "tenant_id": tenant.pk}, format="json").status_code == 400
    )


def test_cash_income_replay_keeps_historical_time(owner, tenant, device):
    from apps.cashbox.models import CashIncome

    instant = timezone.now() - timedelta(minutes=1)
    device.created_at = instant - timedelta(minutes=1)
    device.save(update_fields=["created_at"])
    payload = command(
        device,
        path="cashbox/income/",
        body={"amount": "15000", "currency": "UZS", "source": "Offline kirim"},
        occurred_at=instant.isoformat(),
    )
    apply_operation(owner, device.pk, payload)
    income = CashIncome.objects.get(tenant=tenant)
    assert income.created_at == instant
    assert str(income.amount) == "15000.00"


def test_thousands_of_prioritized_dependencies_do_not_overflow_stack():
    rows = []
    for index in range(2500):
        rows.append(
            SimpleNamespace(
                id=str(index),
                dependencies=[str(index - 1)] if index else [],
                priority=1 if index == 2499 else 0,
                status="waiting",
            )
        )
    assert [row.id for row in ordered_operations(rows)] == [str(index) for index in range(2500)]


def test_transitive_blocked_and_promoted_rows_are_visible(owner, tenant):
    first = local_row(tenant, owner, status="error")
    second = local_row(tenant, owner, dependencies=[str(first.id)])
    third = local_row(tenant, owner, dependencies=[str(second.id)], priority=1)
    rows = {row["id"]: row for row in queue_status()["operations"]}
    assert rows[str(second.id)]["status"] == rows[str(third.id)]["status"] == "blocked"
    assert all(row["promoted"] for row in rows.values())


def test_expired_primary_requires_explicit_revocation(owner, tenant, device):
    device.lease_until = timezone.now() - timedelta(days=1)
    device.save()
    client = APIClient()
    client.force_authenticate(owner)
    assert (
        client.post("/api/v1/sync/devices/", {"protocol": 1, "tenant_id": tenant.pk}, format="json").status_code == 400
    )
    assert client.post(f"/api/v1/sync/devices/{device.pk}/revoke/", {}, format="json").status_code == 200
    assert (
        client.post("/api/v1/sync/devices/", {"protocol": 1, "tenant_id": tenant.pk}, format="json").status_code == 200
    )


def test_malformed_sync_payload_is_a_client_error(owner, device):
    client = APIClient()
    client.force_authenticate(owner)
    response = client.post(
        "/api/v1/sync/push/", {"protocol": 1, "device_id": str(device.pk), "operation": {}}, format="json"
    )
    assert response.status_code == 400
    assert not SyncReceipt.objects.exists()


def test_bad_receipt_does_not_leak_replay_clock(owner, device):
    from rest_framework.exceptions import ValidationError

    from apps.core.event_clock import event_time
    from apps.desktop_sync.protocol import replaying

    payload = command(
        device,
        created=[{"model": "sales.sale", "id": LOCAL_ID_START, "fields": {"receipt_number": 123}}],
    )
    with pytest.raises(ValidationError):
        apply_operation(owner, device.pk, payload)
    assert replaying.get() is False
    assert event_time.get() is None


def test_reenroll_same_installation_renews_owner_lease(owner, tenant, device):
    device.lease_until = timezone.now() - timedelta(days=1)
    device.token_version = owner.token_version + 1
    device.save()
    client = APIClient()
    client.force_authenticate(owner)
    result = client.post(
        "/api/v1/sync/devices/",
        {"protocol": 1, "tenant_id": tenant.pk, "installation_id": str(device.pk)},
        format="json",
    )
    assert result.status_code == 200, result.data
    device.refresh_from_db()
    assert device.lease_until > timezone.now()
    assert device.token_version == owner.token_version
    assert SyncDevice.objects.filter(tenant_id=tenant.pk).count() == 1


def test_partner_headings_do_not_expose_partner_private_settings(owner, tenant):
    other = TenantFactory(telegram_group_id="private-partner-chat", address="Private partner address")
    CounterpartyFactory(tenant=tenant, target_tenant=other)
    snapshot = export_snapshot(tenant)
    rows = {(row["model"], row["pk"]): row["fields"] for row in snapshot["rows"]}
    partner = rows[("tenants.tenant", other.pk)]
    assert partner["name"] == other.name
    assert partner["telegram_group_id"] == partner["address"] == ""
    identity = rows[("accounts.user", other.owner_id)]
    assert identity["phone_number"] == f"ref-{other.owner_id}"
    assert identity["username"].startswith("offline-ref-")
    assert identity["password"].startswith("!")
    with override_settings(DESKTOP_MODE=True):
        import_snapshot(snapshot)


def test_queue_management_uses_store_ownership_not_global_owner_role(owner, tenant):
    from apps.desktop_sync.desktop_api import can_manage_queue
    from apps.desktop_sync.local import set_state
    from tests.factories import OwnerFactory

    other_owner = OwnerFactory()
    EmployeeFactory(user=other_owner, tenant=tenant, is_owner=False)
    set_state("device", {"tenant_id": tenant.pk})
    assert can_manage_queue(owner)
    assert not can_manage_queue(other_owner)


@override_settings(DEBUG=True)
def test_changed_default_sale_price_cannot_silently_change_offline_receipt(owner, tenant, device):
    from decimal import Decimal

    from apps.inventory.services import StockService
    from apps.sales.models import Sale

    variant = ProductVariantFactory(product__category__tenant=tenant, price_recommended=Decimal("20000"))
    StockService.intake(
        tenant=tenant, product_variant=variant, quantity=Decimal("10"), cost_price=Decimal("5000"), created_by=owner
    )
    payload = command(
        device,
        path="sales/",
        body={"items": [{"product_variant_id": variant.pk, "quantity": "1"}], "payment_type": "cash"},
        created=[
            {
                "model": "sales.sale",
                "id": LOCAL_ID_START,
                "fields": {
                    "receipt_number": f"O{device.id.hex[:6]}-20261021-0001",
                    "public_token": "A" * 48,
                    "total_amount": "12000.00",
                },
            },
        ],
    )
    with pytest.raises(SyncConflict, match="Chek summasi"):
        apply_operation(owner, device.pk, payload)
    assert not Sale.objects.filter(tenant=tenant).exists()
    assert not SyncReceipt.objects.filter(device=device).exists()
    payload["body"]["items"][0]["unit_price"] = "12000"
    from apps.cashbox.models import CashShift

    shift = CashShift.objects.get(tenant=tenant, closed_at__isnull=True)
    payload["created"][0]["fields"]["shift_id"] = shift.pk
    shift.closed_at = timezone.now()
    shift.save()
    replacement = CashShift.objects.create(tenant=tenant, opened_by=owner)
    with pytest.raises(SyncConflict, match="smenasi"):
        apply_operation(owner, device.pk, payload)
    assert not Sale.objects.filter(tenant=tenant).exists()
    payload["created"][0]["fields"]["shift_id"] = replacement.pk
    apply_operation(owner, device.pk, payload)
    assert Sale.objects.get(tenant=tenant).total_amount == Decimal("12000")


def test_fast_workspace_reminder_replay_and_conflict(owner, tenant, device):
    from apps.core.models import WorkspaceReminder

    first = command(
        device,
        path="workspace/reminders/",
        body={"title": "Offline eslatma", "due_at": (timezone.now() + timedelta(days=1)).isoformat()},
        created=[{"model": "core.workspacereminder", "id": LOCAL_ID_START, "fields": {}}],
    )
    result = apply_operation(owner, device.pk, first)
    reminder = WorkspaceReminder.objects.get(pk=result["id_map"][str(LOCAL_ID_START)])
    assert reminder.title == "Offline eslatma"
    update = command(
        device,
        path=f"workspace/reminders/{LOCAL_ID_START}/",
        method="PATCH",
        body={"title": "Bajarilgan eslatma", "completed": True},
        dependencies=[first["id"]],
        preconditions=[
            {"model": "core.workspacereminder", "id": LOCAL_ID_START, "fields": {"title": "Offline eslatma"}}
        ],
    )
    apply_operation(owner, device.pk, update)
    reminder.refresh_from_db()
    assert reminder.title == "Bajarilgan eslatma"
    assert reminder.completed_at.isoformat() == update["occurred_at"]
    conflicting = command(
        device,
        path=f"workspace/reminders/{reminder.pk}/",
        method="PATCH",
        body={"title": "Eski tahrir"},
        preconditions=[{"model": "core.workspacereminder", "id": reminder.pk, "fields": {"title": "Offline eslatma"}}],
    )
    with pytest.raises(SyncConflict):
        apply_operation(owner, device.pk, conflicting)
    delete = command(device, path=f"workspace/reminders/{reminder.pk}/", method="DELETE", body={"unused": True})
    apply_operation(owner, device.pk, delete)
    assert not WorkspaceReminder.objects.filter(pk=reminder.pk).exists()


@override_settings(DESKTOP_SERVER="https://ilbi.uz")
def test_desktop_public_release_feed_uses_official_cloud_origin():
    import json
    from unittest.mock import Mock, patch

    from django.test import RequestFactory

    from apps.desktop_sync.desktop_api import endpoint

    upstream = Mock(ok=True, status_code=200)
    upstream.json.return_value = {"schema": 1, "windows": {"version": "1.2.0"}}
    with patch("apps.desktop_sync.desktop_api.requests.get", return_value=upstream) as fetch:
        response = endpoint(RequestFactory().get("/desktop/releases/"), "releases/")
    assert response.status_code == 200
    assert json.loads(response.content)["origin"] == "https://ilbi.uz"
    fetch.assert_called_once_with(
        "https://ilbi.uz/downloads/releases.json", timeout=(5, 15), allow_redirects=False
    )
