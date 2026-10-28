import hashlib
import uuid
from io import BytesIO
from unittest.mock import patch

import pytest
from django.core.cache import caches
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APIClient

from apps.support.models import Conversation, Message
from tests.factories import PlatformAdminFactory, StaffFactory, UserFactory

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def isolated_throttle(settings):
    settings.CACHES = {
        "default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"},
        "support": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "support-tests"},
    }
    caches["support"].clear()
    with patch("apps.support.tasks.notify_operators.delay"):
        yield


def guest(key="a"):
    client = APIClient()
    client.credentials(HTTP_X_SUPPORT_TOKEN=key * 64)
    return client


def start(client, root="guest", **changes):
    body = {
        "name": "Visitor",
        "subject": "How to start?",
        "language": "en",
        "text": "Please help",
        "consent": True,
        "client_id": str(uuid.uuid4()),
    }
    body.update(changes)
    return client.post(f"/api/v1/support/{root}/", body, format="json")


def test_guest_identity_private_and_no_token_in_response():
    client = guest()
    response = start(client)
    assert response.status_code == 201
    pk = response.data["id"]
    assert "guest_hash" not in response.data and "guest_token" not in response.data
    row = Conversation.objects.get(pk=pk)
    assert row.guest_hash == hashlib.sha256(("a" * 64).encode()).hexdigest()
    assert client.get(f"/api/v1/support/guest/{pk}/messages/").status_code == 200
    assert guest("b").get(f"/api/v1/support/guest/{pk}/messages/").status_code == 404
    assert guest("b").post(f"/api/v1/support/guest/{pk}/", {"action": "close"}).status_code == 404
    assert APIClient().get("/api/v1/support/guest/").status_code == 403
    assert response["Cache-Control"] == "no-store"


def test_guest_routes_work_with_stale_login_token():
    client = guest()
    client.credentials(HTTP_X_SUPPORT_TOKEN="a" * 64, HTTP_AUTHORIZATION="Bearer invalid")
    assert start(client).status_code == 201
    assert client.get("/api/v1/support/metadata/").status_code == 200


def test_create_retry_and_consent():
    client = guest()
    client_id = str(uuid.uuid4())
    first = start(client, client_id=client_id)
    again = start(client, client_id=client_id)
    assert first.data["id"] == again.data["id"]
    assert Conversation.objects.count() == 1 and Message.objects.count() == 1
    assert start(client, consent=False).status_code == 400
    assert start(client, language="de").status_code == 400


def test_create_conversation_with_image():
    client = guest()
    buffer = BytesIO()
    Image.new("RGB", (20, 20), "red").save(buffer, "PNG")
    uploaded = SimpleUploadedFile("initial.png", buffer.getvalue(), "image/png")
    body = {
        "name": "Visitor",
        "subject": "Initial bug report",
        "language": "uz",
        "text": "Screenshot attached",
        "consent": True,
        "client_id": str(uuid.uuid4()),
        "image": uploaded,
    }
    response = client.post("/api/v1/support/guest/", body, format="multipart")
    assert response.status_code == 201
    pk = response.data["id"]
    msg = Message.objects.filter(conversation_id=pk).first()
    assert msg is not None
    assert msg.has_image is True
    assert msg.image_data is not None


def test_authenticated_conversations_are_personal_not_tenant_shared(owner, tenant):
    client = APIClient()
    client.force_authenticate(owner)
    response = start(client, root="conversations")
    assert response.status_code == 201
    pk = response.data["id"]
    stranger = APIClient()
    stranger.force_authenticate(StaffFactory())
    assert stranger.get(f"/api/v1/support/conversations/{pk}/").status_code == 404
    assert stranger.get("/api/v1/support/inbox/").status_code == 403
    assert guest().get(f"/api/v1/support/guest/{pk}/").status_code == 404
    assert APIClient().get(f"/api/v1/support/conversations/{pk}/").status_code == 401


def test_tenant_header_is_authorized(owner, tenant):
    client = APIClient()
    client.force_authenticate(owner)
    client.credentials(HTTP_X_TENANT_ID=str(tenant.pk))
    assert start(client, root="conversations").data["tenant_id"] == tenant.pk
    client.credentials(HTTP_X_TENANT_ID="999999")
    assert start(client, root="conversations").status_code == 403


def test_operator_claim_reply_conflict_and_reopen(platform_admin):
    visitor = guest()
    pk = start(visitor).data["id"]
    admin = APIClient()
    admin.force_authenticate(platform_admin)
    root = f"/api/v1/support/inbox/{pk}/"
    body = {"text": "Welcome", "client_id": str(uuid.uuid4())}
    assert admin.post(root + "messages/", body).status_code == 409
    assert admin.post(root, {"action": "claim"}).status_code == 200
    other = APIClient()
    other.force_authenticate(PlatformAdminFactory())
    assert other.post(root, {"action": "claim"}).status_code == 409
    assert other.post(root + "messages/", body).status_code == 409
    assert admin.post(root + "messages/", body).status_code == 201
    assert admin.post(root + "messages/", body).status_code == 200
    assert Message.objects.filter(sender="operator").count() == 1
    assert visitor.post(f"/api/v1/support/guest/{pk}/", {"action": "claim"}).status_code == 400
    assert admin.post(root, {"action": "close"}).status_code == 200
    assert (
        visitor.post(
            f"/api/v1/support/guest/{pk}/messages/", {"text": "Again", "client_id": str(uuid.uuid4())}
        ).status_code
        == 400
    )
    assert visitor.post(f"/api/v1/support/guest/{pk}/", {"action": "reopen"}).status_code == 200
    row = Conversation.objects.get(pk=pk)
    assert row.status == "waiting" and row.operator_id is None


def test_unread_cursors_and_all_pages(platform_admin):
    client = guest()
    pk = start(client).data["id"]
    conversation = Conversation.objects.get(pk=pk)
    Message.objects.bulk_create([Message(conversation=conversation, sender="operator", text=str(i)) for i in range(65)])
    result = client.get("/api/v1/support/guest/")
    assert result.data["unread_total"] == 65
    batch = client.get(f"/api/v1/support/guest/{pk}/messages/").data
    assert len(batch["results"]) == 50 and batch["has_more"]
    earlier = client.get(f"/api/v1/support/guest/{pk}/messages/?before_id={batch['results'][0]['id']}").data
    assert len(earlier["results"]) == 16 and not earlier["has_more"]
    assert earlier["results"][-1]["id"] < batch["results"][0]["id"]
    assert client.get(f"/api/v1/support/guest/{pk}/messages/?after_id=bad").status_code == 400
    last = batch["results"][-1]["id"]
    client.post(f"/api/v1/support/guest/{pk}/", {"action": "read", "through_id": last})
    client.post(f"/api/v1/support/guest/{pk}/", {"action": "read", "through_id": 0})
    assert client.get("/api/v1/support/guest/").data["unread_total"] == 0
    conversation.refresh_from_db()
    assert conversation.visitor_read_id == last


def test_private_image_and_invalid_uploads():
    client = guest()
    pk = start(client).data["id"]
    buffer = BytesIO()
    Image.new("RGB", (20, 20), "blue").save(buffer, "PNG")
    result = client.post(
        f"/api/v1/support/guest/{pk}/messages/",
        {
            "client_id": str(uuid.uuid4()),
            "image": SimpleUploadedFile("screenshot.png", buffer.getvalue(), "image/png"),
        },
        format="multipart",
    )
    assert result.status_code == 201 and result.data["has_image"]
    image_url = f"/api/v1/support/guest/{pk}/messages/{result.data['id']}/image/"
    assert guest("b").get(image_url).status_code == 404
    image = client.get(image_url)
    assert image.status_code == 200 and image["Content-Type"] == "image/jpeg"
    assert image["Cache-Control"] == "no-store"
    assert (
        client.post(
            f"/api/v1/support/guest/{pk}/messages/",
            {
                "client_id": str(uuid.uuid4()),
                "image": SimpleUploadedFile("bad.png", b"not an image", "image/png"),
            },
            format="multipart",
        ).status_code
        == 400
    )
    assert (
        client.post(
            f"/api/v1/support/guest/{pk}/messages/",
            {
                "client_id": str(uuid.uuid4()),
                "image": SimpleUploadedFile("big.png", b"x" * (2 * 1024 * 1024 + 1)),
            },
            format="multipart",
        ).status_code
        == 400
    )


def test_guest_creation_rate_limit():
    client = guest()
    for _ in range(20):
        client.post("/api/v1/support/guest/", {}, format="json")
    assert start(client).status_code == 429


def test_notification_only_to_verified_private_configured_contact(settings, platform_admin):
    from apps.support.tasks import notify_operators
    from apps.tg_bot.models import TelegramContact

    settings.TELEGRAM_BOT_TOKEN = "123:synthetic-test-token"
    settings.SUPPORT_OPERATOR_PHONES = ["+998770212149"]
    row = Conversation.objects.create(
        guest_hash="a" * 64, name="Private name", subject="Private question", language="uz"
    )
    TelegramContact.objects.create(phone_number="+998770212149", chat_id="777", bot_id="old")
    with patch("apps.support.tasks.send_telegram_message", return_value=True) as send:
        notify_operators(str(row.pk))
        send.assert_not_called()
        TelegramContact.objects.update(bot_id="123")
        notify_operators(str(row.pk))
        send.assert_called_once()
        text = send.call_args.args[1]
        assert "Private name" not in text and "Private question" not in text
        assert "/support?conversation=" in text and row.guest_hash not in text


@pytest.mark.django_db(transaction=True)
def test_concurrent_operators_cannot_both_claim():
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections

    first = PlatformAdminFactory()
    second = PlatformAdminFactory()
    pk = start(guest()).data["id"]
    barrier = Barrier(2)

    def claim(user):
        close_old_connections()
        try:
            client = APIClient()
            client.force_authenticate(user)
            barrier.wait(timeout=10)
            return client.post(f"/api/v1/support/inbox/{pk}/", {"action": "claim"}).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(claim, [first, second]))
    assert sorted(results) == [200, 409]
    assert Message.objects.filter(conversation_id=pk, event="claim").count() == 1


def test_public_guides_exclude_private_manuals_and_images_are_real():
    from pathlib import Path

    from django.conf import settings

    client = APIClient()
    keys = {doc["key"] for doc in client.get("/api/v1/docs/").data["documents"]}
    assert "yordam_uz" in keys
    assert "platform_admin_qollanma" not in keys
    assert "owner_qollanma" not in keys
    assert client.get("/api/v1/docs/?doc=yordam_uz").status_code == 200
    assert client.get("/api/v1/docs/images/manifest.json").status_code == 404
    assert client.get("/api/v1/docs/images/missing.png").status_code == 404
    response = client.get("/api/v1/docs/images/catalog_create.png")
    assert response.status_code == 200 and response["Content-Type"] == "image/png"
    response.close()
    # Relative screenshot references must resolve both in Markdown and in the app.
    import re

    root = Path(settings.BASE_DIR).parent / "docs"
    for doc in (root / "qollanmalar").glob("*.md"):
        for reference in re.findall(r"!\[[^\]]*\]\((\.\./rasmlar/focused/[^)]+)\)", doc.read_text()):
            assert (doc.parent / reference).is_file(), (doc.name, reference)


def test_forwarded_prefix_cannot_bypass_guest_write_limit():
    client = guest()
    for index in range(20):
        client.post(
            "/api/v1/support/guest/", {}, format="json", HTTP_X_FORWARDED_FOR=f"198.51.100.{index}, 203.0.113.9"
        )
    response = client.post(
        "/api/v1/support/guest/", {}, format="json", HTTP_X_FORWARDED_FOR="different-prefix, 203.0.113.9"
    )
    assert response.status_code == 429


def test_unapplied_support_migration_returns_retryable_service_error():
    from django.db import ProgrammingError

    missing = ProgrammingError('relation "support_conversation" does not exist')
    driver_error = Exception("undefined table")
    driver_error.pgcode = "42P01"
    missing.__cause__ = driver_error
    with patch("api.v1.support.views.with_unread", side_effect=missing):
        response = guest().get("/api/v1/support/guest/")
    assert response.status_code == 503
    assert response.data["error"]["code"] == "support_not_ready"
    assert response["Retry-After"] == "30"
    assert response["Cache-Control"] == "no-store"


def test_unrelated_database_error_is_not_hidden_as_support_setup():
    from django.db import ProgrammingError

    with patch("api.v1.support.views.with_unread", side_effect=ProgrammingError("invalid column")):
        with pytest.raises(ProgrammingError, match="invalid column"):
            guest().get("/api/v1/support/guest/")


def test_telegram_reply_voice_and_sticker():
    client = guest()
    conv_res = start(client)
    assert conv_res.status_code == 201
    pk = conv_res.data["id"]

    # 1. Test Reply: post first message, then reply to it
    msg1_res = client.post(
        f"/api/v1/support/guest/{pk}/messages/",
        {"text": "First message", "client_id": str(uuid.uuid4())},
        format="json",
    )
    assert msg1_res.status_code == 201
    msg1_id = msg1_res.data["id"]

    msg2_res = client.post(
        f"/api/v1/support/guest/{pk}/messages/",
        {"text": "Replying to first message", "reply_to_id": msg1_id, "client_id": str(uuid.uuid4())},
        format="json",
    )
    assert msg2_res.status_code == 201
    assert msg2_res.data["reply_to"] is not None
    assert msg2_res.data["reply_to"]["id"] == msg1_id
    assert msg2_res.data["reply_to"]["text"] == "First message"

    # 2. Test Voice: send audio upload and download via voice endpoint
    fake_audio = SimpleUploadedFile("voice.webm", b"RIFFFAKEOPUSDATA", content_type="audio/webm")
    voice_res = client.post(
        f"/api/v1/support/guest/{pk}/messages/",
        {"voice": fake_audio, "voice_duration": 12, "client_id": str(uuid.uuid4())},
        format="multipart",
    )
    assert voice_res.status_code == 201
    assert voice_res.data["has_voice"] is True
    assert voice_res.data["voice_duration"] == 12
    voice_msg_id = voice_res.data["id"]

    # Stream voice
    stream_res = client.get(f"/api/v1/support/guest/{pk}/messages/{voice_msg_id}/voice/")
    assert stream_res.status_code == 200
    assert stream_res["Content-Type"] == "audio/webm"
    assert stream_res.content == b"RIFFFAKEOPUSDATA"

    # 3. Test Sticker: send sticker
    sticker_res = client.post(
        f"/api/v1/support/guest/{pk}/messages/",
        {"sticker": "rocket", "client_id": str(uuid.uuid4())},
        format="json",
    )
    assert sticker_res.status_code == 201
    assert sticker_res.data["sticker"] == "rocket"


@pytest.mark.django_db
def test_operator_customer_profile_get_and_patch():
    # 1. Start a conversation as guest
    g_client = guest()
    conv_res = start(g_client, name="Dilshod")
    conv_id = conv_res.data["id"]

    # 2. Operator accesses customer profile
    admin = PlatformAdminFactory()
    op_client = APIClient()
    op_client.force_authenticate(admin)

    res = op_client.get(f"/api/v1/support/inbox/{conv_id}/customer/")
    assert res.status_code == 200
    assert res.data["is_registered"] is False
    assert res.data["guest"]["name"] == "Dilshod"
    assert res.data["stats"]["total_conversations"] >= 1

    # Non-admin access should be forbidden (403)
    regular_client = APIClient()
    regular_user = UserFactory()
    regular_client.force_authenticate(regular_user)
    assert regular_client.get(f"/api/v1/support/inbox/{conv_id}/customer/").status_code == 403

    # 3. Attach a registered user to the conversation and test PATCH
    conv = Conversation.objects.get(pk=conv_id)
    customer = UserFactory(first_name="Alisher", last_name="Usmonov", email="alisher@example.com", role="owner")
    conv.user = customer
    conv.guest_hash = ""
    conv.save()

    res2 = op_client.get(f"/api/v1/support/inbox/{conv_id}/customer/")
    assert res2.status_code == 200
    assert res2.data["is_registered"] is True
    assert res2.data["user"]["first_name"] == "Alisher"
    assert res2.data["user"]["role"] == "owner"

    # Support edits contact metadata; login email/status require protected account flows.
    forbidden = op_client.patch(
        f"/api/v1/support/inbox/{conv_id}/customer/",
        {"first_name": "Must not apply", "email": "ali_new@example.com", "is_active": False},
        format="json",
    )
    assert forbidden.status_code == 400
    patch_res = op_client.patch(
        f"/api/v1/support/inbox/{conv_id}/customer/",
        {"first_name": "Ali", "contact_phone": "+998901234567"},
        format="json",
    )
    assert patch_res.status_code == 200
    assert patch_res.data["user"]["first_name"] == "Ali"
    assert patch_res.data["user"]["email"] == "alisher@example.com"
    assert patch_res.data["user"]["is_active"] is True

    customer.refresh_from_db()
    assert customer.first_name == "Ali"
    assert customer.is_active is True



def test_mobile_support_wire_contracts(owner, tenant, platform_admin):
    """Real mobile request shapes; notification delivery remains mocked by this module's fixture."""
    import json
    import os
    from pathlib import Path

    visitor = APIClient()
    visitor.force_authenticate(owner)
    visitor.credentials(HTTP_X_TENANT_ID=str(tenant.pk))
    identity = str(uuid.uuid4())
    first = start(visitor, root='conversations', client_id=identity, name='Mobile test customer', subject='Mobile support contract', language='uz')
    assert first.status_code == 201, first.data
    assert start(visitor, root='conversations', client_id=identity).data['id'] == first.data['id']
    pk = first.data['id']
    root = f'/api/v1/support/conversations/{pk}/'
    operator = APIClient()
    operator.force_authenticate(platform_admin)
    operator_root = f'/api/v1/support/inbox/{pk}/'
    assert operator.post(operator_root, {'action': 'claim'}, format='json').status_code == 200
    sent_id = str(uuid.uuid4())
    first_message = Message.objects.filter(conversation_id=pk, sender='visitor').get()
    answer = {'text': 'Synthetic operator answer', 'client_id': sent_id, 'reply_to_id': first_message.id}
    reply = operator.post(operator_root + 'messages/', answer, format='json')
    assert reply.status_code == 201, reply.data
    assert operator.post(operator_root + 'messages/', answer, format='json').data['id'] == reply.data['id']
    messages = visitor.get(root + 'messages/')
    assert messages.status_code == 200, messages.data
    polled = visitor.get(root + 'messages/', {'after_id': first_message.id})
    assert reply.data['id'] in [m['id'] for m in polled.data['results']]
    assert visitor.post(root, {'action': 'read', 'through_id': reply.data['id']}, format='json').status_code == 200
    detail = visitor.get(root)
    assert detail.data['unread_count'] == 0
    closed = visitor.post(root, {'action': 'close'}, format='json')
    assert closed.status_code == 200 and closed.data['status'] == 'closed'
    assert visitor.post(root + 'messages/', {'text': 'Blocked', 'client_id': str(uuid.uuid4())}, format='json').status_code == 400
    reopened = visitor.post(root, {'action': 'reopen'}, format='json')
    assert reopened.status_code == 200 and reopened.data['status'] == 'waiting'
    stranger = APIClient()
    stranger.force_authenticate(UserFactory())
    assert stranger.get(root + 'messages/').status_code == 404
    guest_client = guest('c')
    guest_created = start(guest_client, name='Synthetic guest')
    guest_pk = guest_created.data['id']
    assert guest('d').get(f'/api/v1/support/guest/{guest_pk}/messages/').status_code == 404
    for index in range(55):
        Message.objects.create(conversation_id=pk, sender='operator', author=platform_admin, text=f'History {index}')
    latest = visitor.get(root + 'messages/')
    assert latest.data['has_more'] is True and len(latest.data['results']) == 50
    before = visitor.get(root + 'messages/', {'before_id': latest.data['results'][0]['id']})
    ids = [m['id'] for m in before.data['results'] + latest.data['results']]
    assert len(set(ids)) == Message.objects.filter(conversation_id=pk).count()
    data = {
        'source': 'Actual Django APIClient serializers, isolated PostgreSQL; synthetic support users; notification delivery mocked',
        'metadata': guest_client.get('/api/v1/support/metadata/').json(),
        'conversation': detail.json(), 'created': first.json(), 'guest': guest_created.json(),
        'messages': messages.json(), 'after': polled.json(), 'closed': closed.json(), 'reopened': reopened.json(),
    }
    target = Path(__file__).resolve().parents[4] / 'mobile-app/tests/contracts/support.json'
    if os.environ.get('ILBI_WRITE_MOBILE_SUPPORT_CONTRACTS') == '1':
        target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    else:
        saved = json.loads(target.read_text())
        def shape(value):
            if isinstance(value, dict):
                return {key: shape(item) for key, item in value.items()}
            if isinstance(value, list):
                return [shape(value[0])] if value else []
            return type(value).__name__
        for key in ('metadata', 'conversation', 'created', 'guest', 'messages', 'after', 'closed', 'reopened'):
            assert shape(saved[key]) == shape(data[key]), f'Support contract changed: {key}'
