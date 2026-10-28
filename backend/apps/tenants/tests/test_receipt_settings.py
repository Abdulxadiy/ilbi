from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from apps.core.models import AuditAction, AuditLog
from apps.permissions.models import Permission
from tests.factories import EmployeeFactory, StaffFactory, TenantFactory

pytestmark = pytest.mark.django_db
URL = "/api/v1/tenants/current/"


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def grant(employee):
    employee.permissions.add(Permission.objects.get(category="tenants", codename="manage_settings"))


def test_permission_can_be_delegated_and_revoked(tenant):
    staff = StaffFactory()
    employee = EmployeeFactory(tenant=tenant, user=staff)
    client = client_for(staff)
    payload = {"tax_regime": "general", "is_vat_payer": True, "vat_rate": "6.00", "price_includes_vat": False}
    assert client.patch(URL, payload, format="json").status_code == 403
    grant(employee)
    result = client.patch(URL, payload, format="json")
    assert result.status_code == 200
    assert result.data["vat_rate"] == "6.00"
    assert "owner_details" not in result.data
    assert "owner_details" not in client.get(URL).data
    assert AuditLog.objects.filter(tenant=tenant, actor=staff, action=AuditAction.TENANT_UPDATE).exists()
    employee.permissions.clear()
    assert client.patch(URL, {"vat_rate": "12"}, format="json").status_code in (403, 404)


def test_settings_are_scoped_to_active_membership(tenant):
    staff = StaffFactory()
    employee = EmployeeFactory(tenant=tenant, user=staff)
    grant(employee)
    other = TenantFactory()
    client = client_for(staff)
    assert (
        client.patch(URL, {"receipt_footer": "Local"}, format="json", HTTP_X_TENANT_ID=str(other.pk)).status_code == 403
    )
    result = client.patch(f"{URL}?tenant_id={other.pk}", {"receipt_footer": "Local"}, format="json")
    assert result.status_code == 200
    other.refresh_from_db()
    assert other.receipt_footer != "Local"
    assert client.patch(URL, {"owner": staff.pk}, format="json").status_code == 400
    employee.is_active = False
    employee.save(update_fields=["is_active"])
    assert client.patch(URL, {"vat_rate": "12"}, format="json").status_code in (403, 404)


@pytest.mark.parametrize(
    "payload",
    [
        {"vat_rate": "-1"},
        {"vat_rate": "100.01"},
        {"profit_tax_rate": "NaN"},
        {"turnover_tax_rate": "-0.01"},
        {"receipt_paper_width": "90mm"},
        {"tax_regime": "turnover", "is_vat_payer": True},
        {"tax_regime": "turnover", "profit_tax_enabled": True},
        {"is_vat_payer": True},
        {"tax_regime": "other"},
    ],
)
def test_invalid_tax_configuration_is_rejected(tenant, owner, payload):
    assert client_for(owner).patch(URL, payload, format="json").status_code == 400


def test_profit_tax_and_vat_can_coexist(tenant, owner):
    response = client_for(owner).patch(
        URL,
        {
            "tax_regime": "general",
            "is_vat_payer": True,
            "vat_rate": "12",
            "profit_tax_enabled": True,
            "profit_tax_rate": "15",
        },
        format="json",
    )
    assert response.status_code == 200
    assert response.data["profit_tax_enabled"] is True
    assert response.data["receipt_settings"]["profit_tax_rate"] == "15.00"


def test_settings_permission_authorizes_operational_settings_actions(tenant):
    staff = StaffFactory()
    employee = EmployeeFactory(tenant=tenant, user=staff)
    grant(employee)
    with patch(
        "apps.inventory.tasks.send_low_stock_report_for_tenant_task", return_value={"success": True, "count": 0}
    ):
        assert client_for(staff).post(f"{URL}send-low-stock-report-now/").status_code == 200
