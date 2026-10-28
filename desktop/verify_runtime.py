"""Exercise real offline/restart/reconnect against TWO disposable PostgreSQL DBs.

Uses only the isolated test PostgreSQL (default 127.0.0.1:5433). Never loads the
deployment database. Requires `uv sync --group desktop` in backend first.
"""

import json
import os
import secrets
import socket
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from uuid import uuid4

import psycopg2
import requests
from cryptography.fernet import Fernet

ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / "backend/.venv/bin/python"
if os.name == "nt":
    PYTHON = ROOT / "backend/.venv/Scripts/python.exe"


def port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def main():
    token = uuid4().hex[:10]
    cloud_db, local_db = "ilbi_sync_cloud_qa_" + token, "ilbi_sync_local_qa_" + token
    admin = psycopg2.connect(
        host="127.0.0.1",
        port=5433,
        user="ilbi_test",
        password="ilbi_test",
        dbname="postgres",
    )
    admin.autocommit = True
    temporary = Path(tempfile.mkdtemp(prefix="ilbi-offline-qa-"))
    processes = []
    environment = {
        **os.environ,
        "PYTHONPATH": str(temporary) + os.pathsep + str(ROOT / "backend"),
        "ILBI_DESKTOP_DATA": str(temporary / "data"),
        "ILBI_DESKTOP_SECRET": secrets.token_hex(48),
        "ILBI_DESKTOP_VAULT_KEY": Fernet.generate_key().decode(),
        "ILBI_DESKTOP_BRIDGE_KEY": secrets.token_hex(32),
        "ILBI_DESKTOP_DB_PASSWORD": "ilbi_test",
        "ILBI_DESKTOP_DB_PORT": "5433",
    }
    (temporary / "data").mkdir()
    cloud_port, local_port = port(), port()
    cloud_origin, local_origin = (
        f"http://127.0.0.1:{cloud_port}",
        f"http://127.0.0.1:{local_port}",
    )
    local_headers = {"X-ILBI-Desktop-Key": environment["ILBI_DESKTOP_BRIDGE_KEY"]}
    logs = []

    def run(*arguments, settings="qa_cloud"):
        return subprocess.run(
            [
                str(PYTHON),
                str(ROOT / "backend/manage.py"),
                *arguments,
                "--settings=" + settings,
            ],
            cwd=ROOT / "backend",
            env=environment,
            check=True,
            capture_output=True,
            text=True,
        )

    def start(settings, server_port):
        log = (temporary / (settings + ".log")).open("a")
        logs.append(log)
        process = subprocess.Popen(
            [str(PYTHON), str(temporary / "serve.py"), settings, str(server_port)],
            cwd=ROOT / "backend",
            env=environment,
            stdout=log,
            stderr=log,
        )
        processes.append(process)
        for _ in range(160):
            if process.poll() is not None:
                raise RuntimeError(f"{settings} stopped; see {log.name}")
            try:
                response = requests.get(
                    f"http://127.0.0.1:{server_port}/desktop/status/"
                    if settings == "qa_local"
                    else f"http://127.0.0.1:{server_port}/api/v1/sync/changes/",
                    headers=local_headers,
                    timeout=1,
                )
                if response.status_code < 500:
                    return process
            except requests.RequestException:
                pass
            time.sleep(0.1)
        raise RuntimeError("QA runtime did not start")

    def stop(process):
        process.terminate()
        try:
            process.wait(8)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()

    def call(path, body=None, method=None, headers=None):
        response = requests.request(
            method or ("POST" if body is not None else "GET"),
            local_origin + path,
            json=body,
            headers={**local_headers, **(headers or {})},
            timeout=100,
        )
        assert response.ok, (path, response.status_code, response.text[:2000])
        return response.json() if response.content else None

    try:
        with admin.cursor() as cursor:
            for name in (cloud_db, local_db):
                cursor.execute(f'CREATE DATABASE "{name}"')
        (temporary / "qa_cloud.py").write_text(
            "from config.settings_test import *\nDEBUG=True\nDATABASES['default']['NAME']="
            + repr(cloud_db)
            + "\nMEDIA_ROOT=Path("
            + repr(str(temporary / "cloud-media"))
            + ")\n"
        )
        (temporary / "qa_local.py").write_text(
            "from config.settings_desktop import *\nDEBUG=True\n"
            # Replace the pinned origin in disposable test settings only. The shipped
            # entry point always loads config.settings_desktop and has no override.
            "from apps.desktop_sync import server_policy\n"
            + "DESKTOP_SERVER=server_policy.OFFICIAL_SERVER="
            + repr(cloud_origin)
            + "\n"
            + "FRONTEND_URL=DESKTOP_SERVER\n"
            + "DATABASES['default'].update(NAME="
            + repr(local_db)
            + ",USER='ilbi_test')\n"
        )
        (temporary / "serve.py").write_text(
            "import os,sys\nos.environ['DJANGO_SETTINGS_MODULE']=sys.argv[1]\n"
            "import django\ndjango.setup()\nfrom django.conf import settings\n"
            "from django.core.wsgi import get_wsgi_application\nfrom waitress import serve\n"
            "if getattr(settings,'DESKTOP_MODE',False):\n from apps.desktop_sync.worker import start_worker\n start_worker()\n"
            "serve(get_wsgi_application(),host='127.0.0.1',port=int(sys.argv[2]),threads=8)\n"
        )
        run("migrate", "--noinput")
        run("migrate", "--noinput", settings="qa_local")
        seed_code = """
import json
from tests.factories import OwnerFactory, StaffFactory, TenantFactory, EmployeeFactory, ProductVariantFactory
from apps.permissions.models import Permission
from apps.inventory.services import StockService
from rest_framework_simplejwt.tokens import RefreshToken
from decimal import Decimal
owner=OwnerFactory(username="offline-qa-owner")
tenant=TenantFactory(owner=owner)
EmployeeFactory(user=owner,tenant=tenant,is_owner=True,hired_by=owner)
variant=ProductVariantFactory(product__category__tenant=tenant)
StockService.intake(tenant=tenant,product_variant=variant,quantity=Decimal("100"),cost_price=Decimal("8000"),created_by=owner)
token=RefreshToken.for_user(owner);token["token_version"]=owner.token_version
seed={"tenant_id":tenant.pk,"owner_id":owner.pk,"variant_id":variant.pk,"product_id":variant.product_id,"access":str(token.access_token),"refresh":str(token)}
seed["cashiers"]=[]
for index in range(2):
 staff=StaffFactory(username="offline-qa-cashier-"+str(index))
 employee=EmployeeFactory(user=staff,tenant=tenant,hired_by=owner)
 employee.permissions.set(Permission.objects.filter(category="sales",codename__in=["add_sale","view_sale"]))
 token=RefreshToken.for_user(staff);token["token_version"]=staff.token_version
 seed["cashiers"].append({"username":staff.username,"access":str(token.access_token),"refresh":str(token)})
open(SEED_PATH,"w").write(json.dumps(seed))
""".replace("SEED_PATH", repr(str(temporary / "seed.json")))
        run("shell", "-c", seed_code)
        seed = json.loads((temporary / "seed.json").read_text())
        cloud_process = start("qa_cloud", cloud_port)
        local_process = start("qa_local", local_port)
        local = call(
            "/desktop/enroll/",
            {
                "tenant_id": seed["tenant_id"],
                "pin": "offline-test-pass",
                "refresh": seed["refresh"],
            },
            headers={"Authorization": "Bearer " + seed["access"]},
        )
        auth = {
            "Authorization": "Bearer " + local["access"],
            "X-Tenant-ID": str(seed["tenant_id"]),
        }
        assert call("/api/v1/auth/me/", headers=auth)["id"] == seed["owner_id"]
        registers = [auth]
        for cashier in seed["cashiers"]:
            registered = call(
                "/desktop/actor/",
                {"pin": "offline-cashier-pass", "refresh": cashier["refresh"]},
                headers={"Authorization": "Bearer " + cashier["access"]},
            )
            registers.append(
                {
                    "Authorization": "Bearer " + registered["access"],
                    "X-Tenant-ID": str(seed["tenant_id"]),
                }
            )
        stop(cloud_process)
        from datetime import UTC, datetime, timedelta

        reminder = call(
            "/api/v1/workspace/reminders/",
            {
                "title": "Offline tezkor eslatma",
                "due_at": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
            },
            headers=auth,
        )
        call(
            f"/api/v1/workspace/reminders/{reminder['id']}/",
            {"completed": True},
            method="PATCH",
            headers=auth,
        )
        call(
            f"/api/v1/workspace/reminders/{reminder['id']}/",
            method="DELETE",
            headers=auth,
        )
        assert "results" in call("/api/v1/workspace/search/?q=Offline", headers=auth)
        cp = call(
            "/api/v1/sales/counterparties/",
            {"name": "Offline QA mijoz", "phone_number": "+998901234567"},
            headers=auth,
        )
        cp_id = cp["id"]
        sale = call(
            "/api/v1/sales/",
            {
                "items": [
                    {
                        "product_variant_id": seed["variant_id"],
                        "quantity": "2",
                        "unit_price": "12000",
                    }
                ],
                "payment_type": "debt",
                "counterparty_id": cp_id,
                "idempotency_key": uuid4().hex,
            },
            headers=auth,
        )
        assert sale[0]["receipt_number"].startswith("O")
        call(
            f"/api/v1/sales/counterparties/{cp_id}/payments/",
            {
                "amount": "6000",
                "currency": "UZS",
                "payment_type": "cash",
                "idempotency_key": uuid4().hex,
            },
            headers=auth,
        )
        call(
            "/api/v1/cashbox/expenses/",
            {"amount": "1000", "currency": "UZS", "category": "QA xarajat"},
            headers=auth,
        )
        call(
            "/api/v1/cashbox/income/",
            {"amount": "500", "currency": "UZS", "source": "QA kirim"},
            headers=auth,
        )

        def register_sale(credentials):
            return call(
                "/api/v1/sales/",
                {
                    "items": [
                        {
                            "product_variant_id": seed["variant_id"],
                            "quantity": "1",
                            "unit_price": "12000",
                        }
                    ],
                    "payment_type": "cash",
                    "idempotency_key": uuid4().hex,
                },
                headers=credentials,
            )

        with ThreadPoolExecutor(max_workers=3) as pool:
            assert len(list(pool.map(register_sale, registers))) == 3
        from PIL import Image

        image = BytesIO()
        Image.new("RGB", (10, 10), "#336699").save(image, format="PNG")
        upload = requests.post(
            local_origin + f"/api/v1/catalog/products/{seed['product_id']}/images/",
            files={"image": ("offline-qa.png", image.getvalue(), "image/png")},
            headers={**local_headers, **auth},
            timeout=30,
        )
        assert upload.status_code == 201, upload.text[:2000]
        call(
            "/api/v1/cashbox/shift/close/",
            {"actual_cash_uzs": "41500", "actual_cash_usd": "0"},
            headers=auth,
        )
        call(
            f"/api/v1/catalog/products/{seed['product_id']}/",
            {"name": "Offline QA yangilangan"},
            method="PATCH",
            headers=auth,
        )
        time.sleep(1)
        queue = call("/desktop/queue/", headers=auth)
        assert len(queue["operations"]) == 14, queue
        promoted = next(
            row["id"]
            for row in queue["operations"]
            if row["title"].startswith("Katalog o‘zgarishi — Offline QA")
        )
        call("/desktop/priority/", {"id": promoted}, headers=auth)
        queue = call("/desktop/queue/", headers=auth)
        assert queue["operations"][0]["id"] == promoted, queue
        stop(local_process)
        local_process = start("qa_local", local_port)
        unlocked = call(
            "/desktop/unlock/",
            {"username": "offline-qa-owner", "pin": "offline-test-pass"},
        )
        auth["Authorization"] = "Bearer " + unlocked["access"]
        assert len(call("/desktop/queue/", headers=auth)["operations"]) == 14
        local_cp = call(f"/api/v1/sales/counterparties/{cp_id}/", headers=auth)
        assert local_cp["debt_balance_uzs"] == "18000.00", local_cp
        cloud_process = start("qa_cloud", cloud_port)
        for _ in range(180):
            queue = call("/desktop/queue/", headers=auth)
            if not queue["operations"] and queue.get("last_sync"):
                break
            if any(row["status"] == "error" for row in queue["operations"]):
                raise AssertionError(queue)
            time.sleep(0.5)
        else:
            raise AssertionError(queue)
        # An already open form/receipt can continue using its original local ID.
        assert (
            call(f"/api/v1/sales/counterparties/{cp_id}/", headers=auth)[
                "debt_balance_uzs"
            ]
            == "18000.00"
        )
        forbidden = requests.patch(
            local_origin + f"/api/v1/tenants/{seed['tenant_id']}/",
            json={"description": "must not change"},
            headers={**local_headers, **registers[1]},
            timeout=20,
        )
        assert forbidden.status_code == 403, forbidden.text[:2000]
        # A prolonged outage can expire the lease. Owner reauthentication must
        # restore access without deleting the replica or resetting cashier PINs.
        run(
            "shell",
            "-c",
            "from apps.desktop_sync.models import SyncDevice; "
            "from django.utils import timezone; from datetime import timedelta; "
            "SyncDevice.objects.update(lease_until=timezone.now()-timedelta(days=1))",
        )
        run(
            "shell",
            "-c",
            "from apps.desktop_sync.local import get_state,set_state; "
            "from django.utils import timezone; from datetime import timedelta; "
            "device=get_state('device'); "
            "device['lease_until']=(timezone.now()-timedelta(days=1)).isoformat(); "
            "set_state('device',device)",
            settings="qa_local",
        )
        expired = requests.post(
            local_origin + "/desktop/unlock/",
            json={"username": "offline-qa-owner", "pin": "offline-test-pass"},
            headers=local_headers,
            timeout=10,
        )
        assert expired.status_code == 401, expired.text[:500]
        call(
            "/desktop/reconnect/",
            {"refresh": seed["refresh"]},
            headers={"Authorization": "Bearer " + seed["access"]},
        )
        call(
            "/desktop/unlock/",
            {"username": "offline-qa-owner", "pin": "offline-test-pass"},
        )
        verify_code = """
from apps.sales.models import Counterparty, Sale
from apps.inventory.models import Stock
from apps.cashbox.models import DailyCashReport
from apps.desktop_sync.models import SyncReceipt
from decimal import Decimal
assert Counterparty.objects.get(name="Offline QA mijoz").debt_balance_uzs == Decimal("18000")
assert Sale.objects.count()==4
assert Sale.objects.filter(payment_type="debt").get().total_amount == Decimal("24000")
assert all(sale.receipt_number.startswith("O") for sale in Sale.objects.all())
assert Stock.objects.get().quantity == Decimal("95")
assert DailyCashReport.objects.get().expected_cash_uzs == Decimal("41500")
assert SyncReceipt.objects.count()==14
from apps.core.models import WorkspaceReminder
assert not WorkspaceReminder.objects.exists()
from apps.catalog.models import ProductImage
assert ProductImage.objects.count()==1
"""
        run("shell", "-c", verify_code)
        print(
            json.dumps(
                {
                    "passed": True,
                    "scenarios": [
                        "enrollment",
                        "offline sale",
                        "debt payment",
                        "cash income/expense",
                        "three concurrent registers",
                        "staff permissions",
                        "per-user live credentials",
                        "offline image upload",
                        "shift close",
                        "priority",
                        "process restart",
                        "offline unlock",
                        "automatic reconnect",
                        "two-way replica refresh",
                        "open-form ID aliases",
                        "expired lease recovery",
                        "offline fast workspace reminder create/complete/delete and search",
                    ],
                    "operations": 14,
                    "artifacts": str(temporary),
                }
            )
        )
    finally:
        for process in processes:
            if process.poll() is None:
                stop(process)
        for stream in logs:
            stream.close()
        with admin.cursor() as cursor:
            for name in (cloud_db, local_db):
                cursor.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        admin.close()


if __name__ == "__main__":
    main()
