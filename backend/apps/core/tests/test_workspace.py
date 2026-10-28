from datetime import timedelta

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import WorkspaceReminder
from apps.permissions.models import Permission
from tests.factories import (
    CounterpartyFactory,
    EmployeeFactory,
    ProductVariantFactory,
    SaleFactory,
    StaffFactory,
    TenantFactory,
)

pytestmark = pytest.mark.django_db
ROOT = "/api/v1/workspace/"


@pytest.fixture
def client(owner, tenant):
    client = APIClient()
    client.force_authenticate(owner)
    return client


def task(title="Mijozga qo‘ng‘iroq", **extra):
    return {"title": title, "due_at": (timezone.now() - timedelta(minutes=5)).isoformat(), **extra}


def test_reminder_lifecycle_and_owner_assignment(client, owner, tenant):
    staff = StaffFactory()
    EmployeeFactory(user=staff, tenant=tenant)
    response = client.post(ROOT + "reminders/", task(assigned_to_id=staff.pk), format="json")
    assert response.status_code == 201, response.data
    assert response.data["assigned_to_id"] == staff.pk
    url = ROOT + f"reminders/{response.data['id']}/"
    listing = client.get(ROOT + "reminders/").data
    assert listing["count"] == 1 and listing["overdue_count"] == 1
    assert client.patch(url, {"completed": True}, format="json").data["completed"]
    assert client.get(ROOT + "reminders/").data["count"] == 0
    assert client.get(ROOT + "reminders/?completed=true").data["count"] == 1
    assert not client.patch(url, {"completed": False, "title": "Qayta tekshirish"}, format="json").data["completed"]
    assert client.delete(url).status_code == 204
    assert not WorkspaceReminder.objects.filter(tenant=tenant).exists()
    assert {row["id"] for row in client.get(ROOT + "members/").data} == {owner.pk, staff.pk}


def test_staff_tasks_are_private_and_tenant_scoped(client, tenant, owner):
    staff, other_staff = StaffFactory(), StaffFactory()
    EmployeeFactory(user=staff, tenant=tenant)
    EmployeeFactory(user=other_staff, tenant=tenant)
    own = client.post(ROOT + "reminders/", task(assigned_to_id=staff.pk), format="json").data
    private = client.post(ROOT + "reminders/", task("Egasi uchun"), format="json").data
    other_tenant = TenantFactory()
    foreign = WorkspaceReminder.objects.create(
        tenant=other_tenant,
        created_by=other_tenant.owner,
        assigned_to=other_tenant.owner,
        title="Boshqa do‘kon",
        due_at=timezone.now(),
    )
    client.force_authenticate(staff)
    assert [row["id"] for row in client.get(ROOT + "reminders/").data["results"]] == [own["id"]]
    assert client.patch(ROOT + f"reminders/{own['id']}/", {"completed": True}, format="json").status_code == 200
    for pk in (private["id"], foreign.pk):
        assert client.patch(ROOT + f"reminders/{pk}/", {"completed": True}, format="json").status_code == 404
        assert client.delete(ROOT + f"reminders/{pk}/").status_code == 404
    assert client.post(ROOT + "reminders/", task(assigned_to_id=other_staff.pk), format="json").status_code == 403
    assert [row["id"] for row in client.get(ROOT + "members/").data] == [staff.pk]
    assert client.post(ROOT + "reminders/", task(), format="json").status_code == 201
    client.force_authenticate(owner)
    assert (
        client.post(ROOT + "reminders/", task(assigned_to_id=other_tenant.owner_id), format="json").status_code == 404
    )


def test_global_search_is_bounded_and_does_not_leak_across_tenants(client, tenant, owner):
    ProductVariantFactory.create_batch(
        8, tenant=tenant, product__tenant=tenant, product__name="LOOKUP local", barcode=None
    )
    CounterpartyFactory.create_batch(8, tenant=tenant, name="LOOKUP customer")
    for index in range(8):
        SaleFactory(tenant=tenant, sold_by=owner, receipt_number=f"LOOKUP-SALE-{index}")
    ProductVariantFactory(product__name="LOOKUP FOREIGN")
    CounterpartyFactory(name="LOOKUP FOREIGN")
    SaleFactory(receipt_number="LOOKUP-FOREIGN")
    result = client.get(ROOT + "search/?q=LOOKUP")
    assert result.status_code == 200, result.data
    assert len(result.data["results"]) == 18
    assert {row["type"] for row in result.data["results"]} == {"product", "customer", "sale"}
    assert not any("FOREIGN" in row["title"] for row in result.data["results"])
    assert client.get(ROOT + "search/?q=L").data["results"] == []
    assert client.get(ROOT + "search/?q=%20%20").data["results"] == []


def test_search_permissions_and_revoked_membership(tenant):
    staff = StaffFactory()
    employee = EmployeeFactory(user=staff, tenant=tenant)
    CounterpartyFactory(tenant=tenant, name="Anvar")
    ProductVariantFactory(tenant=tenant, product__tenant=tenant, product__name="Anvar un")
    SaleFactory(tenant=tenant, receipt_number="Anvar-chek")
    client = APIClient()
    client.force_authenticate(staff)
    assert client.get(ROOT + "search/?q=Anvar").data["results"] == []
    employee.permissions.add(Permission.objects.get(category="sales", codename="manage_counterparty"))
    assert {row["type"] for row in client.get(ROOT + "search/?q=Anvar").data["results"]} == {"customer"}
    employee.is_active = False
    employee.save(update_fields=["is_active"])
    for endpoint in ("search/?q=Anvar", "reminders/", "members/", "overview/"):
        assert client.get(ROOT + endpoint).status_code == 403


def test_overview_has_bounded_queries_and_scoped_results(client, tenant, owner):
    ProductVariantFactory(tenant=tenant, product__tenant=tenant)
    SaleFactory.create_batch(8, tenant=tenant, sold_by=owner)
    SaleFactory(receipt_number="FOREIGN")
    with CaptureQueriesContext(connection) as first:
        response = client.get(ROOT + "overview/")
    assert response.status_code == 200, response.data
    assert response.data["low_stock_count"] == 1
    assert len(response.data["recent_sales"]) == 5
    SaleFactory.create_batch(30, tenant=tenant, sold_by=owner)
    with CaptureQueriesContext(connection) as large:
        second = client.get(ROOT + "overview/")
    assert len(first) == len(large)
    assert not any(row["receipt_number"] == "FOREIGN" for row in second.data["recent_sales"])


def test_reminder_validation_anonymous_and_platform_admin(client, platform_admin):
    for body in (task(title=" "), task(due_at="not-a-date"), task(title="a" * 201)):
        assert client.post(ROOT + "reminders/", body, format="json").status_code == 400
    client.force_authenticate(platform_admin)
    assert client.get(ROOT + "reminders/").status_code == 403
    client.force_authenticate(None)
    assert client.get(ROOT + "search/?q=Anvar").status_code == 401


def test_reminder_list_is_bounded_and_paginated(client, tenant, owner):
    WorkspaceReminder.objects.bulk_create(
        [
            WorkspaceReminder(
                tenant=tenant, created_by=owner, assigned_to=owner, title=f"Vazifa {index}", due_at=timezone.now()
            )
            for index in range(53)
        ]
    )
    first = client.get(ROOT + "reminders/?page=1").data
    second = client.get(ROOT + "reminders/?page=2").data
    assert first["count"] == second["count"] == 53
    assert len(first["results"]) == 50 and len(second["results"]) == 3
    assert not ({row["id"] for row in first["results"]} & {row["id"] for row in second["results"]})
    assert client.get(ROOT + "reminders/?page=0").status_code == 400
