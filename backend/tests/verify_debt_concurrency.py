"""Verify reminder races using synthetic rows in the dedicated workspace QA database."""
# ruff: noqa: E402

import django
django.setup()

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event
from time import sleep
from uuid import uuid4
from django.db import close_old_connections, connections, transaction
from django.utils import timezone
from django.conf import settings
from apps.sales.models import Counterparty, Notification
from apps.tenants.models import Tenant
from apps.sales.services import DebtService
from apps.sales.services.debt_reminder_service import notify_due_debts
from tests.factories import CounterpartyFactory, TenantFactory, UserFactory

if settings.DATABASES['default']['NAME'] != 'ilbi_workspace_qa':
    raise RuntimeError('Concurrency checks require the disposable ilbi_workspace_qa database.')

UserFactory.reset_sequence(int(uuid4().hex[:8], 16) % 10000000, force=True)
shop = TenantFactory(name='Debt concurrency QA ' + uuid4().hex[:12])
CounterpartyFactory(tenant=shop, debt_due_date=timezone.localdate(), debt_balance_uzs=100)
barrier = Barrier(4)
def check(_):
    close_old_connections()
    try:
        barrier.wait()
        return notify_due_debts(tenant_id=shop.pk)
    finally:
        connections.close_all()
with ThreadPoolExecutor(max_workers=4) as pool:
    assert sum(pool.map(check, range(4))) == 1
assert Notification.objects.filter(tenant=shop, type='debt_due_reminder').count() == 1

cp = CounterpartyFactory(tenant=shop, debt_due_date=timezone.localdate(), debt_balance_uzs=100)
locked, checking = Event(), Event()
def payment():
    close_old_connections()
    try:
        with transaction.atomic():
            Tenant.objects.select_for_update().get(pk=shop.pk)
            locked.set()
            assert checking.wait(5)
            sleep(.3)
            customer = Counterparty.objects.select_for_update().get(pk=cp.pk)
            customer.debt_balance_uzs = 0
            DebtService.check_threshold_and_notify(customer)
        return True
    finally:
        connections.close_all()
def reminder():
    close_old_connections()
    try:
        assert locked.wait(5)
        checking.set()
        return notify_due_debts(tenant_id=shop.pk)
    finally:
        connections.close_all()
with ThreadPoolExecutor(max_workers=2) as pool:
    paid, reminded = pool.submit(payment), pool.submit(reminder)
    assert paid.result(timeout=10)
    assert reminded.result(timeout=10) == 0
cp.refresh_from_db()
assert cp.debt_due_date is None
assert not Notification.objects.filter(tenant=shop, link=f'/debts?workspace_id={cp.pk}').exists()
print('PASS: 4 simultaneous checks create 1 reminder; concurrent full payment finishes without deadlock or stale reminder')
