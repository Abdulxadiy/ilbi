from types import SimpleNamespace

import pytest
from django.core import mail

from apps.accounts.services.password_reset_service import send_password_reset_email


@pytest.mark.parametrize("purpose", ["new_owner", "new_employee", "transfer_owner", "reset_password"])
def test_transactional_email_has_ilbi_copy_and_embedded_logo(purpose, settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    settings.DEFAULT_FROM_EMAIL = "ILBI <noreply@example.com>"
    settings.FRONTEND_URL = "https://ilbi.example"
    user = SimpleNamespace(id=1, email="recipient@example.com")
    assert send_password_reset_email(user, "synthetic-setup-token", purpose, {"tenant_name": "Demo do‘kon"})
    message = mail.outbox[-1]
    assert message.from_email == "ILBI <noreply@example.com>"
    assert "ILBI" in message.subject
    html = message.alternatives[0].content
    text = message.subject + message.body + html
    assert "inventra" not in text.lower()
    assert " PRO" not in text
    assert 'src="cid:ilbi-logo"' in html
    assert 'alt="ilbi.uz"' in html
    assert "https://ilbi.example/setup-account?token=synthetic-setup-token" in message.body
    logo = next(a for a in message.attachments if a.get("Content-ID") == "<ilbi-logo>")
    assert logo.get_content_type() == "image/png"
    assert logo.get_payload(decode=True).startswith(b"\x89PNG\r\n\x1a\n")


def test_otp_notification_uses_ilbi_without_product_badge(monkeypatch):
    from api.v1.accounts.views import misc
    sent = []
    monkeypatch.setattr(misc.otp_services, "generate_code", lambda: "123456")
    monkeypatch.setattr(misc.otp_services, "store_code", lambda *args: None)
    monkeypatch.setattr(misc, "send_telegram_message", lambda chat, text: sent.append((chat, text)) or True)
    assert misc.send_otp_or_error("+998000000001", SimpleNamespace(chat_id="100001")) is None
    assert sent[0][0] == "100001"
    assert "ILBI" in sent[0][1]
    assert "inventra" not in sent[0][1].lower() and "PRO" not in sent[0][1]
