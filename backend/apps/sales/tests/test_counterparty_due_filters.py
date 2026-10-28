"""Real server-side business-day debt filters, summaries and exports."""

import json
import os
from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import pytest
from django.utils import timezone
from openpyxl import load_workbook
from rest_framework.test import APIClient

from apps.permissions.models import Permission
from apps.sales.models import DebtPayment
from tests.factories import CounterpartyFactory, EmployeeFactory, StaffFactory, TenantFactory

pytestmark = pytest.mark.django_db
TODAY = date(2026, 10, 29)
NOW = datetime(2026, 10, 28, 20, 0, tzinfo=dt_timezone.utc)
PATH = "/api/v1/sales/counterparties/"


def client_for(user, tenant):
    client = APIClient()
    client.force_authenticate(user)
    client.credentials(HTTP_X_TENANT_ID=str(tenant.pk))
    return client


@pytest.fixture
def debt_rows(tenant):
    rows = {}
    for label, offset in [
        ("overdue", -1),
        ("today", 0),
        ("soon", 1),
        ("soon_edge", 7),
        ("future", 8),
        ("undated", None),
    ]:
        rows[label] = CounterpartyFactory(
            tenant=tenant,
            name=label,
            debt_balance_uzs="10.25",
            debt_due_date=TODAY + timedelta(days=offset) if offset is not None else None,
        )
    rows["usd"] = CounterpartyFactory(tenant=tenant, name="USD", debt_balance_usd="2.50", debt_due_date=TODAY)
    rows["mixed"] = CounterpartyFactory(
        tenant=tenant, name="Mixed", debt_balance_uzs="5.00", debt_balance_usd="-4.00", debt_due_date=TODAY
    )
    rows["credit"] = CounterpartyFactory(
        tenant=tenant, name="Credit", debt_balance_uzs="-3.00", debt_balance_usd="-1.00", debt_due_date=TODAY
    )
    rows["settled"] = CounterpartyFactory(tenant=tenant, debt_due_date=TODAY)
    CounterpartyFactory(tenant=tenant, name="Archived", debt_balance_uzs="900", is_active=False, debt_due_date=TODAY)
    CounterpartyFactory(tenant=TenantFactory(), name="Foreign", debt_balance_uzs="9999", debt_due_date=TODAY)
    return rows


@pytest.mark.parametrize(
    "due,expected",
    [
        ("overdue", ["overdue"]),
        ("today", ["today", "usd", "mixed"]),
        ("soon", ["soon", "soon_edge"]),
        ("future", ["future"]),
        ("undated", ["undated"]),
    ],
)
def test_due_filter_is_tashkent_business_day_debt_only_and_applies_before_pagination(
    owner, tenant, debt_rows, due, expected
):
    client = client_for(owner, tenant)
    # Neither UTC date nor a temporarily activated different timezone may move the business day.
    with patch("django.utils.timezone.now", return_value=NOW), timezone.override("America/Los_Angeles"):
        response = client.get(PATH, {"due_status": due, "page": 1, "page_size": 1})
        assert response.status_code == 200, response.data
        assert response.data["count"] == len(expected)
        found = [response.data["results"][0]["id"]]
        for page in range(2, len(expected) + 1):
            found += [
                row["id"] for row in client.get(PATH, {"due_status": due, "page": page, "page_size": 1}).data["results"]
            ]
        assert set(found) == {debt_rows[key].pk for key in expected}
        assert response.data["summary"]["business_date"] == "2026-10-29"
        assert response.data["summary"]["debt_due_filter_version"] == 1
        assert response.data["summary"]["applied_due_status"] == due
        if due == "today" and os.environ.get("ILBI_WRITE_DEBT_FILTER_CONTRACTS") == "1":
            full = client.get(PATH, {"due_status": due, "page": 1})
            target = Path(__file__).resolve().parents[4] / "mobile-app/tests/contracts/debt-filters.json"
            target.write_text(
                json.dumps(
                    {
                        "source": (
                            "Actual isolated PostgreSQL/API; fixed Tashkent business day at UTC date boundary; "
                            "synthetic identities only"
                        ),
                        "today": full.json(),
                    },
                    indent=2,
                )
                + "\n"
            )


def test_summary_credits_in_both_currencies_stays_store_wide_and_search_combines(owner, tenant, debt_rows):
    with patch("django.utils.timezone.now", return_value=NOW):
        response = client_for(owner, tenant).get(PATH, {"page": 1, "due_status": "today", "search": "USD"})
    assert response.data["count"] == 1
    summary = response.data["summary"]
    assert summary["total_count"] == 10
    assert Decimal(summary["total_debt_uzs"]) == Decimal("66.50")
    assert Decimal(summary["total_debt_usd"]) == Decimal("2.50")
    assert Decimal(summary["total_credit_uzs"]) == Decimal("3.00")
    assert Decimal(summary["total_credit_usd"]) == Decimal("5.00")
    assert summary["credit_count"] == 2 and summary["debtors_count"] == 8 and summary["settled_count"] == 1


@pytest.mark.parametrize("path", [PATH, PATH + "export/"])
def test_invalid_due_filter_is_a_field_error_not_unfiltered_results(owner, tenant, path):
    response = client_for(owner, tenant).get(path, {"due_status": "not-a-real-filter", "page": 1})
    assert response.status_code == 400
    assert "due_status" in str(response.data)


def test_due_export_uses_exact_same_server_filter_and_has_no_side_effects(owner, tenant, debt_rows):
    with patch("django.utils.timezone.now", return_value=NOW):
        response = client_for(owner, tenant).get(PATH + "export/", {"due_status": "soon"})
    assert response.status_code == 200
    workbook = load_workbook(BytesIO(response.content), read_only=True)
    values = list(workbook["Qarzdorlik"].values)
    cells = {value for row in values for value in row if isinstance(value, str)}
    assert {"soon", "soon_edge"} <= cells
    assert not ({"overdue", "today", "future", "USD", "Mixed", "Credit", "Archived", "Foreign"} & cells)
    assert not DebtPayment.objects.exists()


def test_partial_collection_keeps_due_until_settled_and_original_replay_survives_filter_change(owner, tenant):
    cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs="10.25", debt_due_date=TODAY - timedelta(days=1))
    client = client_for(owner, tenant)
    payment_path = PATH + f"{cp.pk}/payments/"
    payload = {
        "amount": "3.25",
        "currency": "UZS",
        "payment_type": "card",
        "branch_id": tenant.pk,
        "note": "Partial due collection",
    }
    quote = client.get(payment_path + "quote/", payload)
    assert quote.status_code == 200
    body = {**payload, "expected_quote": quote.data["expected_quote"], "idempotency_key": "due-partial-original"}
    accepted = client.post(payment_path, body, format="json")
    assert accepted.status_code == 201
    with patch("django.utils.timezone.now", return_value=NOW):
        listed = client.get(PATH, {"page": 1, "due_status": "overdue"})
        assert listed.data["count"] == 1
        assert listed.data["results"][0]["debt_balance_uzs"] == "7.00"
        assert client.post(payment_path, body, format="json").data == accepted.data
        final_payload = {**payload, "amount": "7.00"}
        final_quote = client.get(payment_path + "quote/", final_payload)
        final = client.post(
            payment_path,
            {
                **final_payload,
                "expected_quote": final_quote.data["expected_quote"],
                "idempotency_key": "due-final-original",
            },
            format="json",
        )
        assert final.status_code == 201
        assert client.get(PATH, {"page": 1, "due_status": "overdue"}).data["count"] == 0
        settled = client.get(PATH, {"page": 1, "balance_status": "settled"}).data["results"]
        assert settled[0]["id"] == cp.pk
    assert DebtPayment.objects.filter(counterparty=cp).count() == 2


def test_restricted_staff_cannot_read_another_store_due_list(tenant, debt_rows):
    staff = StaffFactory()
    member = EmployeeFactory(user=staff, tenant=tenant, is_owner=False)
    member.permissions.add(Permission.objects.get(category="sales", codename="record_debt_payment"))
    client = client_for(staff, tenant)
    with patch("django.utils.timezone.now", return_value=NOW):
        assert client.get(PATH, {"page": 1, "due_status": "today"}).status_code == 200
    client.credentials(HTTP_X_TENANT_ID=str(TenantFactory().pk))
    assert client.get(PATH, {"page": 1, "due_status": "today"}).status_code == 403
