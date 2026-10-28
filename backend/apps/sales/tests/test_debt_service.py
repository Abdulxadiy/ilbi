from tests.factories import EmployeeFactory
import pytest
from decimal import Decimal
from unittest.mock import patch

from apps.sales.models import Counterparty, DebtPayment, Notification
from apps.sales.services import DebtService, DebtServiceError
from apps.tg_bot.models import TelegramContact
from tests.factories import CounterpartyFactory, OwnerFactory, StaffFactory, PlatformAdminFactory

pytestmark = pytest.mark.django_db


class TestDebtServiceRecordPayment:
    def test_record_payment_uzs_success(self, tenant, owner):
        cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs=Decimal("150000.00"))
        payment = DebtService.record_payment(
            counterparty=cp,
            amount=Decimal("50000.00"),
            currency="UZS",
            recorded_by=owner,
        )
        assert payment.amount == Decimal("50000.00")
        assert payment.currency == "UZS"
        assert payment.is_correction is False
        cp.refresh_from_db()
        assert cp.debt_balance_uzs == Decimal("100000.00")

    def test_record_payment_usd_success(self, tenant, owner):
        cp = CounterpartyFactory(tenant=tenant, debt_balance_usd=Decimal("500.00"))
        payment = DebtService.record_payment(
            counterparty=cp,
            amount=Decimal("200.00"),
            currency="USD",
            recorded_by=owner,
        )
        assert payment.amount == Decimal("200.00")
        assert payment.currency == "USD"
        cp.refresh_from_db()
        assert cp.debt_balance_usd == Decimal("300.00")

    def test_record_payment_with_branch(self, tenant, owner):
        from tests.factories import TenantFactory
        branch2 = TenantFactory(owner=owner, name="Filial 2")
        EmployeeFactory(user=owner, tenant=branch2, is_owner=True)
        cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs=Decimal("200000.00"))
        payment = DebtService.record_payment(
            counterparty=cp,
            amount=Decimal("70000.00"),
            currency="UZS",
            recorded_by=owner,
            branch=branch2,
        )
        assert payment.branch == branch2
        assert payment.tenant == branch2
        cp.refresh_from_db()
        assert cp.debt_balance_uzs == Decimal("130000.00")

    def test_staff_cannot_record_payment(self, tenant, staff):
        cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs=Decimal("50000.00"))
        with pytest.raises(DebtServiceError, match="ruxsat berilmagan"):
            DebtService.record_payment(
                counterparty=cp,
                amount=Decimal("10000.00"),
                currency="UZS",
                recorded_by=staff,
            )

    def test_platform_admin_can_record_payment(self, tenant, platform_admin):
        cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs=Decimal("50000.00"))
        payment = DebtService.record_payment(
            counterparty=cp,
            amount=Decimal("10000.00"),
            currency="UZS",
            recorded_by=platform_admin,
        )
        assert payment.amount == Decimal("10000.00")

    def test_zero_amount_is_rejected(self, tenant, owner):
        cp = CounterpartyFactory(tenant=tenant)
        with pytest.raises(DebtServiceError, match="0 bo'lishi mumkin emas"):
            DebtService.record_payment(
                counterparty=cp,
                amount=Decimal("0.00"),
                currency="UZS",
                recorded_by=owner,
            )

    def test_negative_amount_without_correction_is_rejected(self, tenant, owner):
        cp = CounterpartyFactory(tenant=tenant)
        with pytest.raises(DebtServiceError, match="musbat bo'lishi kerak"):
            DebtService.record_payment(
                counterparty=cp,
                amount=Decimal("-10000.00"),
                currency="UZS",
                recorded_by=owner,
                is_correction=False,
            )

    def test_correction_requires_mandatory_note(self, tenant, owner):
        cp = CounterpartyFactory(tenant=tenant)
        with pytest.raises(DebtServiceError, match="izoh yozish majburiy"):
            DebtService.record_payment(
                counterparty=cp,
                amount=Decimal("-10000.00"),
                currency="UZS",
                recorded_by=owner,
                is_correction=True,
                note="   ",
            )

    def test_correction_with_note_succeeds(self, tenant, owner):
        cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs=Decimal("100000.00"))
        # Negative payment in correction increases debt (e.g. earlier payment was wrongly recorded)
        payment = DebtService.record_payment(
            counterparty=cp,
            amount=Decimal("-20000.00"),
            currency="UZS",
            recorded_by=owner,
            is_correction=True,
            note="Oldingi adashib kiritilgan to'lov bekor qilindi",
        )
        assert payment.is_correction is True
        cp.refresh_from_db()
        assert cp.debt_balance_uzs == Decimal("120000.00")

    def test_overpayment_creates_credit_negative_balance(self, tenant, owner):
        cp = CounterpartyFactory(tenant=tenant, debt_balance_uzs=Decimal("50000.00"))
        DebtService.record_payment(
            counterparty=cp,
            amount=Decimal("80000.00"),
            currency="UZS",
            recorded_by=owner,
        )
        cp.refresh_from_db()
        # Negative balance means customer has store credit ("haqq")
        assert cp.debt_balance_uzs == Decimal("-30000.00")


class TestDebtThresholdNotifications:
    def test_crossing_uzs_threshold_creates_notification(self, tenant):
        cp = CounterpartyFactory(
            tenant=tenant,
            debt_balance_uzs=Decimal("12000000.00"),  # > 10 mln
            last_notified_debt_step_uzs=0,
        )
        DebtService.check_threshold_and_notify(cp)
        cp.refresh_from_db()

        assert cp.last_notified_debt_step_uzs == 1
        notifs = Notification.objects.filter(
            tenant=tenant,
            type=Notification.TYPE_DEBT_WARNING,
        )
        assert notifs.count() == 1
        assert "UZS" in notifs.first().title

    def test_crossing_next_uzs_threshold_creates_second_notification(self, tenant):
        cp = CounterpartyFactory(
            tenant=tenant,
            debt_balance_uzs=Decimal("25000000.00"),  # > 20 mln
            last_notified_debt_step_uzs=1,
        )
        DebtService.check_threshold_and_notify(cp)
        cp.refresh_from_db()

        assert cp.last_notified_debt_step_uzs == 2
        notifs = Notification.objects.filter(tenant=tenant, type=Notification.TYPE_DEBT_WARNING)
        assert notifs.count() == 1

    def test_debt_drop_decrements_step_for_future_alert(self, tenant):
        cp = CounterpartyFactory(
            tenant=tenant,
            debt_balance_uzs=Decimal("5000000.00"),  # dropped below 10 mln
            last_notified_debt_step_uzs=1,
        )
        DebtService.check_threshold_and_notify(cp)
        cp.refresh_from_db()
        assert cp.last_notified_debt_step_uzs == 0

    def test_crossing_usd_threshold_creates_notification(self, tenant):
        cp = CounterpartyFactory(
            tenant=tenant,
            debt_balance_usd=Decimal("1500.00"),  # > 1000 USD
            last_notified_debt_step_usd=0,
        )
        DebtService.check_threshold_and_notify(cp)
        cp.refresh_from_db()

        assert cp.last_notified_debt_step_usd == 1
        notifs = Notification.objects.filter(
            tenant=tenant,
            type=Notification.TYPE_DEBT_WARNING,
        )
        assert notifs.count() == 1
        assert "USD" in notifs.first().title

    @patch("apps.sales.tasks.send_async_telegram_message_task.delay")
    def test_crossing_uzs_threshold_sends_telegram_to_owner(self, mock_delay, tenant, owner, django_capture_on_commit_callbacks):
        TelegramContact.objects.create(
            phone_number=owner.phone_number,
            chat_id="chat_owner_123",
        )
        cp = CounterpartyFactory(
            tenant=tenant,
            name="Alijon",
            debt_balance_uzs=Decimal("12000000.00"),  # > 10 mln
            last_notified_debt_step_uzs=0,
        )
        with django_capture_on_commit_callbacks(execute=True):
            DebtService.check_threshold_and_notify(cp)
        mock_delay.assert_called_once()
        args, kwargs = mock_delay.call_args
        assert args[0] == "chat_owner_123"
        assert "QARZ CHEGARASI OGOHLANTIRISHI" in args[1]
        assert "Alijon" in args[1]
        assert "12,000,000.00 UZS" in args[1]

    @patch("apps.sales.tasks.send_async_telegram_message_task.delay")
    def test_crossing_usd_threshold_sends_telegram_to_owner(self, mock_delay, tenant, owner, django_capture_on_commit_callbacks):
        TelegramContact.objects.create(
            phone_number=owner.phone_number,
            chat_id="chat_owner_123",
        )
        cp = CounterpartyFactory(
            tenant=tenant,
            name="Valijon",
            debt_balance_usd=Decimal("1500.00"),  # > 1000 USD
            last_notified_debt_step_usd=0,
        )
        with django_capture_on_commit_callbacks(execute=True):
            DebtService.check_threshold_and_notify(cp)
        mock_delay.assert_called_once()
        args, kwargs = mock_delay.call_args
        assert args[0] == "chat_owner_123"
        assert "Valijon" in args[1]
        assert "$1,500.00" in args[1]

    @patch("apps.sales.tasks.send_async_telegram_message_task.delay")
    def test_notify_on_debt_disabled_does_not_send_telegram(self, mock_delay, tenant, owner):
        tenant.notify_on_debt = False
        tenant.save()
        TelegramContact.objects.create(
            phone_number=owner.phone_number,
            chat_id="chat_owner_123",
        )
        cp = CounterpartyFactory(
            tenant=tenant,
            debt_balance_uzs=Decimal("15000000.00"),
            last_notified_debt_step_uzs=0,
        )
        DebtService.check_threshold_and_notify(cp)
        mock_delay.assert_not_called()
