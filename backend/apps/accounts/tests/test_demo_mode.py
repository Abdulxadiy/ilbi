"""Local demo login must stay limited to tagged accounts and development settings."""

import os
import subprocess
import sys
from io import StringIO
from pathlib import Path
from unittest.mock import patch

import pytest
from apps.accounts.models import Employee, User
from apps.accounts.services import login_throttle
from apps.accounts.services.demo_access_service import DemoAccessService
from apps.catalog.models import Product, ProductVariant
from apps.inventory.models import Stock, StockMovement
from apps.sales.models import Counterparty, Sale
from apps.tenants.models import Tenant
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db.models import Count, F, Sum
from rest_framework.test import APIClient
from tests.factories import EmployeeFactory, TenantFactory, UserFactory

pytestmark = pytest.mark.django_db
PASSWORD = "SyntheticTestPassword2026!"  # noqa: S105
LOGIN_URL = "/api/v1/auth/admin-login/"


@pytest.fixture(autouse=True)
def demo_settings(settings):
    settings.DEBUG = True
    settings.LOCAL_DEMO_LOGIN_ENABLED = True
    with patch.object(login_throttle, "is_locked", return_value=(False, 0)), \
         patch.object(login_throttle, "register_failure"), \
         patch.object(login_throttle, "register_success"):
        yield


@pytest.fixture
def demo_user():
    user = UserFactory(username="demo_t1_staff001", phone_number="+998000001001", role="staff", password=PASSWORD)
    user.groups.add(Group.objects.create(name=DemoAccessService.GROUP_NAME))
    EmployeeFactory(user=user, tenant=TenantFactory(), is_owner=False)
    return user


def login(user, password=PASSWORD):
    return APIClient().post(LOGIN_URL, {"username": user.username, "password": password})


def test_demo_password_login_never_calls_telegram(demo_user):
    with patch("api.v1.accounts.views.admin_login.get_telegram_contact_or_error") as telegram:
        response = login(demo_user)
    assert response.status_code == 200
    assert response.data["demo_login"] is True
    assert response.data["access"] and response.data["refresh"]
    telegram.assert_not_called()


@pytest.mark.parametrize("disabled", ["DEBUG", "LOCAL_DEMO_LOGIN_ENABLED"])
def test_both_switches_required(settings, demo_user, disabled):
    setattr(settings, disabled, False)
    assert not DemoAccessService.enabled_for(demo_user)
    with patch("api.v1.accounts.views.admin_login.send_otp_or_error", return_value=None), \
         patch("api.v1.accounts.views.admin_login.get_telegram_contact_or_error", return_value=(object(), None)):
        response = login(demo_user)
    assert response.status_code == 401
    assert "access" not in response.data
    assert "login_ticket" not in response.data


@pytest.mark.parametrize("mutation", ["untagged", "real_phone", "regular_username"])
def test_demo_switch_does_not_bypass_regular_accounts(demo_user, mutation):
    if mutation == "untagged":
        demo_user.groups.clear()
    elif mutation == "real_phone":
        demo_user.phone_number = "+998901234567"
        demo_user.save(update_fields=["phone_number"])
    else:
        demo_user.username = "regular_account"
        demo_user.save(update_fields=["username"])
    assert not DemoAccessService.enabled_for(demo_user)
    with patch("api.v1.accounts.views.admin_login.send_otp_or_error", return_value=None), \
         patch("api.v1.accounts.views.admin_login.get_telegram_contact_or_error", return_value=(object(), None)):
        response = login(demo_user)
    assert response.status_code == 200
    assert "access" not in response.data


def test_wrong_password_still_rejected(demo_user):
    assert login(demo_user, "wrong").status_code == 401


def test_inactive_demo_user_cannot_login(demo_user):
    demo_user.is_active = False
    demo_user.save(update_fields=["is_active"])
    assert login(demo_user).status_code == 429


def test_fired_demo_employee_cannot_login(demo_user):
    demo_user.employments.update(is_active=False)
    assert login(demo_user).status_code == 403


def test_demo_does_not_allow_cross_tenant_access(demo_user):
    response = login(demo_user)
    foreign_tenant = TenantFactory()
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
    response = client.get("/api/v1/catalog/products/", HTTP_X_TENANT_ID=str(foreign_tenant.id))
    assert response.status_code == 403


def test_production_refuses_demo_flag_at_startup():
    env = {**os.environ, "DJANGO_DEBUG": "False", "LOCAL_DEMO_LOGIN_ENABLED": "True"}
    result = subprocess.run(  # noqa: S603
        [sys.executable, "-c", "import config.settings"],
        cwd=Path(__file__).resolve().parents[3], env=env, capture_output=True, text=True, check=False,
    )
    assert result.returncode != 0
    assert "LOCAL_DEMO_LOGIN_ENABLED requires DJANGO_DEBUG=True" in result.stderr


def test_seed_dataset_has_isolated_stocks_and_consistent_sales(monkeypatch):
    monkeypatch.setenv("ILBI_DEMO_PASSWORD", PASSWORD)
    call_command("seed_demo_platform", products_per_tenant=12, employees_per_tenant=3,
                 sales_per_tenant=6, stdout=StringIO())
    assert Tenant.objects.count() == 4
    assert User.objects.count() == 16
    assert Employee.objects.filter(is_owner=False).count() == 12
    assert Employee.objects.filter(is_owner=True).count() == 4
    assert Product.objects.count() == ProductVariant.objects.count() == Stock.objects.count() == 48
    assert Sale.objects.count() == 24
    assert not Stock.objects.exclude(tenant_id=F("product_variant__tenant_id")).exists()
    assert not Stock.objects.values("product_variant_id").annotate(n=Count("id")).filter(n__gt=1).exists()
    for stock in Stock.objects.all():
        movement_totals = {
            row["direction"]: row["quantity"]
            for row in StockMovement.objects.filter(product_variant=stock.product_variant)
            .values("direction").annotate(quantity=Sum("quantity"))
        }
        assert stock.quantity == movement_totals.get("in", 0) - movement_totals.get("out", 0)
    for counterparty in Counterparty.objects.filter(debt_balance_uzs__gt=0):
        debt = Sale.objects.filter(counterparty=counterparty, payment_type="debt").aggregate(total=Sum("total_amount"))
        assert counterparty.debt_balance_uzs == debt["total"]
    owner = User.objects.get(username="demo_owner")
    assert owner.owned_tenants.count() == 2
    assert login(owner).status_code == 200
    assert not Tenant.objects.exclude(daily_report_target="none", notify_on_debt=False).exists()
    assert User.objects.filter(groups__name=DemoAccessService.GROUP_NAME).count() == 16


def test_seed_refuses_populated_database_without_writes(monkeypatch, demo_user):
    monkeypatch.setenv("ILBI_DEMO_PASSWORD", PASSWORD)
    before = User.objects.count()
    with pytest.raises(CommandError, match="bo‘sh bazada"):
        call_command("seed_demo_platform", stdout=StringIO())
    assert User.objects.count() == before


def test_seed_refuses_non_debug_database(settings, monkeypatch):
    settings.DEBUG = False
    monkeypatch.setenv("ILBI_DEMO_PASSWORD", PASSWORD)
    with pytest.raises(CommandError, match="DEBUG"):
        call_command("seed_demo_platform", stdout=StringIO())
    assert not User.objects.exists()


def test_seed_rolls_back_everything_on_failure(monkeypatch):
    monkeypatch.setenv("ILBI_DEMO_PASSWORD", PASSWORD)
    with patch("apps.accounts.management.commands.seed_demo_platform.call_command", side_effect=RuntimeError("failed")):
        with pytest.raises(RuntimeError, match="failed"):
            call_command("seed_demo_platform", stdout=StringIO())
    assert not User.objects.exists()
    assert not Tenant.objects.exists()
