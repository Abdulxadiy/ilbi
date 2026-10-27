"""Actual API boundaries using synthetic secrets; never real deployment material."""
import hashlib
import json
from pathlib import Path
from unittest.mock import patch

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import F
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalog.services import ProductServiceError
from apps.core.audit_privacy import REDACTED, safe_audit_data
from apps.core.models import AuditAction, AuditLog
from apps.core.services.audit_service import AuditService
from apps.support.models import Conversation
from tests.factories import EmployeeFactory, ProductFactory, StaffFactory, TenantFactory

pytestmark = pytest.mark.django_db
SYNTHETIC_PASSWORD = 'synthetic-only-private-password-2026'
SYNTHETIC_HASH = 'pbkdf2_sha256$123$synthetic-salt$synthetic-password-digest'
SYNTHETIC_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.syntheticSignature'


def api(user=None, tenant=None):
    client = APIClient()
    if user:
        client.force_authenticate(user)
    if tenant:
        client.credentials(HTTP_X_TENANT_ID=str(tenant.pk))
    return client


def support_thread(user=None, tenant=None):
    return Conversation.objects.create(user=user, tenant=tenant, guest_hash='' if user else hashlib.sha256(b'synthetic-private-guest-key').hexdigest(), name='Synthetic contact', language='uz', subject='Synthetic support')


def support_path(conversation):
    return f'/api/v1/support/inbox/{conversation.pk}/customer/'


def test_guest_support_profile_omits_verifier_and_keeps_server_side_group_count(platform_admin):
    conversation = support_thread()
    Conversation.objects.create(guest_hash=conversation.guest_hash, name='Other private thread', language='uz', subject='Synthetic other')
    response = api(platform_admin).get(support_path(conversation))
    assert response.status_code == 200
    assert response.data['guest'] == {'name': 'Synthetic contact', 'language': 'uz'}
    assert response.data['stats']['total_conversations'] == 2
    encoded = json.dumps(response.data, default=str)
    assert conversation.guest_hash not in encoded and 'guest_hash' not in encoded
    assert api(StaffFactory()).get(support_path(conversation)).status_code == 403


@pytest.mark.parametrize('field,value', [
    ('role', 'platform_admin'), ('is_active', False), ('email', 'takeover@synthetic.invalid'),
    ('phone_number', '+998901111111'), ('username', 'synthetic-takeover'), ('password', SYNTHETIC_PASSWORD),
    ('new_password', SYNTHETIC_PASSWORD), ('token_version', 999), ('is_staff', True),
    ('permission_ids', []), ('tenant_is_active', False),
])
def test_support_contact_patch_rejects_sensitive_fields_atomically(field, value, owner, tenant, platform_admin):
    target = StaffFactory(first_name='Before', email='original@synthetic.invalid')
    EmployeeFactory(user=target, tenant=tenant)
    conversation = support_thread(target, tenant)
    before = (target.role, target.is_active, target.email, target.phone_number, target.username, target.password, target.token_version)
    response = api(platform_admin).patch(support_path(conversation), {'first_name': 'Must not apply', field: value}, format='json')
    assert response.status_code == 400, response.data
    assert field in response.data['error']['details']
    target.refresh_from_db(); tenant.refresh_from_db()
    assert (target.role, target.is_active, target.email, target.phone_number, target.username, target.password, target.token_version) == before
    assert target.first_name == 'Before' and tenant.is_active
    assert SYNTHETIC_PASSWORD not in json.dumps(response.data, default=str)


@pytest.mark.parametrize('field,value', [('role', 'owner'), ('is_active', False), ('email', 'self@synthetic.invalid')])
def test_support_cannot_mutate_operators_own_security_identity(field, value, platform_admin):
    conversation = support_thread(platform_admin)
    before = (platform_admin.role, platform_admin.is_active, platform_admin.email, platform_admin.token_version)
    response = api(platform_admin).patch(support_path(conversation), {field: value}, format='json')
    assert response.status_code == 400
    platform_admin.refresh_from_db()
    assert (platform_admin.role, platform_admin.is_active, platform_admin.email, platform_admin.token_version) == before


def test_allowed_support_contact_patch_is_audited_without_rewriting_security(owner, tenant, platform_admin):
    conversation = support_thread(owner, tenant)
    before = (owner.role, owner.is_active, owner.email, owner.password, owner.token_version, tenant.is_active)
    response = api(platform_admin).patch(support_path(conversation), {'first_name': 'Updated', 'last_name': 'Contact', 'contact_phone': '+998901234567', 'tenant_name': 'Updated store', 'tenant_address': 'Synthetic address'}, format='json')
    assert response.status_code == 200, response.data
    owner.refresh_from_db(); tenant.refresh_from_db()
    assert (owner.role, owner.is_active, owner.email, owner.password, owner.token_version, tenant.is_active) == before
    assert owner.first_name == 'Updated' and tenant.name == 'Updated store'
    event = AuditLog.objects.get(target_model='User', target_id=str(owner.pk))
    assert event.actor == platform_admin and event.changes['operation'] == 'support_contact_update'
    assert event.changes['fields'] == ['contact_phone', 'first_name', 'last_name', 'tenant_address', 'tenant_name']


def test_contact_save_cannot_restore_an_outdated_role_or_security_version(owner, tenant, platform_admin):
    target = StaffFactory(first_name='Before'); EmployeeFactory(user=target, tenant=tenant)
    conversation = support_thread(target, tenant); original = User.save
    def interleaved_save(user, *args, **kwargs):
        if user.pk == target.pk and 'first_name' in (kwargs.get('update_fields') or []):
            User.objects.filter(pk=target.pk).update(is_active=False, token_version=F('token_version') + 1)
        return original(user, *args, **kwargs)
    previous_version = target.token_version
    with patch.object(User, 'save', interleaved_save):
        response = api(platform_admin).patch(support_path(conversation), {'first_name': 'After'}, format='json')
    assert response.status_code == 200
    target.refresh_from_db(); assert not target.is_active and target.token_version == previous_version + 1
    assert target.first_name == 'After'


def test_profile_tenant_team_and_support_serializers_never_return_stored_password(owner, tenant, platform_admin):
    owner.set_password(SYNTHETIC_PASSWORD); owner.save(update_fields=['password'])
    conversation = support_thread(owner, tenant)
    endpoints = ['/api/v1/auth/me/', '/api/v1/auth/profile/', '/api/v1/tenants/my/', f'/api/v1/tenants/{tenant.pk}/', f'/api/v1/tenants/{tenant.pk}/employees/']
    for path in endpoints:
        response = api(owner, tenant).get(path); assert response.status_code == 200, (path, response.data)
        encoded = json.dumps(response.data, default=str)
        assert SYNTHETIC_PASSWORD not in encoded and owner.password not in encoded
        assert 'password_hash' not in encoded
    response = api(platform_admin).get(support_path(conversation)); assert response.status_code == 200
    assert SYNTHETIC_PASSWORD not in json.dumps(response.data, default=str) and owner.password not in json.dumps(response.data, default=str)


def sensitive_changes():
    return {
        'login': {'admin_password': SYNTHETIC_PASSWORD, 'access_token': SYNTHETIC_JWT, 'refresh': 'synthetic-refresh-secret'},
        'snapshot': {'nested': [{'guest_hash': 'f' * 64, 'firebase_private_key': 'synthetic-private-key', 'bot_token': 'synthetic-bot-token'}], 'opaque_text': SYNTHETIC_HASH},
        'artifact_sha256': 'a' * 64, 'certificate_fingerprint': 'b' * 64, 'idempotency_key': 'c' * 64,
        'receipt_number': 'SYNTHETIC-42', 'amount': '1250.25', 'password_set': True, 'token_version': 7,
    }


def test_new_audit_writes_and_bulk_writes_redact_recursively_without_mutating_caller(owner, tenant):
    original = sensitive_changes()
    row = AuditService.log(actor=owner, tenant=tenant, action=AuditAction.ACCOUNT_IDENTITY_UPDATE, changes=original,
        description='Encoded: ' + SYNTHETIC_HASH, user_agent='Authorization: Bearer synthetic-user-agent-secret')
    assert original['login']['admin_password'] == SYNTHETIC_PASSWORD
    row.refresh_from_db(); assert row.changes['login']['admin_password'] == REDACTED
    assert row.changes['snapshot']['nested'][0]['firebase_private_key'] == REDACTED
    assert row.changes['artifact_sha256'] == 'a' * 64 and row.changes['idempotency_key'] == 'c' * 64
    assert row.changes['certificate_fingerprint'] == 'b' * 64 and row.changes['password_set'] is True and row.changes['token_version'] == 7
    encoded = json.dumps([row.changes, row.description, row.user_agent])
    for secret in [SYNTHETIC_PASSWORD, SYNTHETIC_HASH, SYNTHETIC_JWT, 'synthetic-refresh-secret', 'synthetic-user-agent-secret', 'synthetic-bot-token']:
        assert secret not in encoded
    bulk = AuditLog(tenant=tenant, actor=owner, action=AuditAction.ACCOUNT_IDENTITY_UPDATE, changes=sensitive_changes())
    AuditLog.objects.bulk_create([bulk]); bulk.refresh_from_db()
    assert bulk.changes['login']['access_token'] == REDACTED
    assert safe_audit_data(row.changes) == row.changes


def test_bulk_upsert_cannot_rewrite_the_append_only_audit_ledger(owner, tenant):
    row = AuditLog.objects.create(tenant=tenant, actor=owner, action=AuditAction.ACCOUNT_IDENTITY_UPDATE, description='Original event')
    replacement = AuditLog(pk=row.pk, tenant=tenant, actor=owner, action=row.action, description='Rewritten event')
    with pytest.raises(ValidationError, match='immutable'):
        AuditLog.objects.bulk_create([replacement], update_conflicts=True, update_fields=['description'], unique_fields=['id'])
    row.refresh_from_db(); assert row.description == 'Original event'


def test_historical_audit_api_and_history_redact_existing_records_without_rewriting_ledger(owner, tenant):
    legacy = AuditLog(tenant=tenant, actor=owner, action=AuditAction.ACCOUNT_IDENTITY_UPDATE, target_model='User', target_id=str(owner.pk), changes=sensitive_changes(), description='Legacy ' + SYNTHETIC_HASH, user_agent='Authorization: Bearer synthetic-old-secret')
    # Simulate a pre-fix stored record without going through the current write boundary.
    models.QuerySet(model=AuditLog, using='default').bulk_create([legacy])
    client = api(owner, tenant)
    for path in ['/api/v1/audit/logs/', '/api/v1/audit/history/', f'/api/v1/audit/history/audit/{legacy.pk}/']:
        response = client.get(path); assert response.status_code == 200, response.data
        encoded = json.dumps(response.data, default=str)
        for secret in [SYNTHETIC_PASSWORD, SYNTHETIC_HASH, SYNTHETIC_JWT, 'synthetic-private-key', 'synthetic-old-secret', 'f' * 64]:
            assert secret not in encoded
    detail = client.get(f'/api/v1/audit/history/audit/{legacy.pk}/').data['details']
    assert detail['changes']['artifact_sha256'] == 'a' * 64
    assert detail['snapshot']['nested'][0]['guest_hash'] == REDACTED
    legacy.refresh_from_db(); assert legacy.changes['login']['admin_password'] == SYNTHETIC_PASSWORD
    foreign = TenantFactory(); EmployeeFactory(user=foreign.owner, tenant=foreign, is_owner=True)
    assert api(foreign.owner, foreign).get(f'/api/v1/audit/history/audit/{legacy.pk}/').status_code == 404


@pytest.mark.parametrize('marker', ['key', 'field', 'label'])
def test_audit_change_row_metadata_hides_credentials_in_new_and_legacy_records(marker, owner, tenant):
    original = {
        'rows': [
            {marker: 'password', 'old': SYNTHETIC_PASSWORD, 'new': 'synthetic-new-password', 'value': {'nested': SYNTHETIC_PASSWORD}},
            {marker: 'guest_hash', 'value': 'f' * 64},
            {marker: 'certificate_fingerprint', 'value': 'b' * 64},
            {marker: 'idempotency_key', 'value': 'c' * 64},
            {marker: 'business-id-42', 'value': 'retained business metadata'},
        ],
    }
    saved = AuditService.log(actor=owner, tenant=tenant, action=AuditAction.ACCOUNT_IDENTITY_UPDATE, changes=original)
    saved.refresh_from_db()
    rows = saved.changes['rows']
    assert rows[0] == {marker: 'password', 'old': REDACTED, 'new': REDACTED, 'value': REDACTED}
    assert rows[1] == {marker: 'guest_hash', 'value': REDACTED}
    assert rows[2:] == original['rows'][2:]
    assert original['rows'][0]['old'] == SYNTHETIC_PASSWORD

    legacy = AuditLog(tenant=tenant, actor=owner, action=AuditAction.ACCOUNT_IDENTITY_UPDATE, changes=original)
    models.QuerySet(model=AuditLog, using='default').bulk_create([legacy])
    client = api(owner, tenant)
    for path in ['/api/v1/audit/logs/', f'/api/v1/audit/history/audit/{legacy.pk}/']:
        response = client.get(path)
        assert response.status_code == 200
        encoded = json.dumps(response.data, default=str)
        for secret in [SYNTHETIC_PASSWORD, 'synthetic-new-password', 'f' * 64]:
            assert secret not in encoded
        assert 'b' * 64 in encoded and 'c' * 64 in encoded and 'retained business metadata' in encoded
    legacy.refresh_from_db()
    assert legacy.changes == original


def test_public_document_read_and_admin_write_errors_do_not_echo_internal_exception(tmp_path, platform_admin, caplog):
    folder = tmp_path / 'qollanmalar'; folder.mkdir(); document = folder / 'yordam_uz.md'; document.write_text('Synthetic public help', encoding='utf-8')
    secret_error = OSError('synthetic-internal-path /private/settings password=synthetic-file-secret')
    with patch('api.v1.accounts.views.docs_views._get_docs_root', return_value=tmp_path), patch.object(Path, 'read_text', side_effect=secret_error):
        read = api().get('/api/v1/docs/?doc=yordam_uz')
    assert read.status_code == 500
    with patch('api.v1.accounts.views.docs_views._get_docs_root', return_value=tmp_path), patch.object(Path, 'write_text', side_effect=secret_error):
        write = api(platform_admin).put('/api/v1/docs/', {'doc': 'yordam_uz', 'content': 'Synthetic replacement'}, format='json')
    assert write.status_code == 500
    encoded = json.dumps([read.data, write.data], default=str) + caplog.text
    assert 'synthetic-file-secret' not in encoded and '/private/settings' not in encoded
    assert document.read_text() == 'Synthetic public help'


def test_gallery_unexpected_error_is_safe_but_business_validation_remains_actionable(owner, tenant, caplog):
    product = ProductFactory(tenant=tenant)
    endpoint = f'/api/v1/catalog/products/{product.pk}/images/'
    with patch('api.v1.catalog.views.product_views.ProductService.add_image', side_effect=RuntimeError('Authorization: Bearer synthetic-storage-secret /private/storage')):
        failed = api(owner, tenant).post(endpoint, {'image': SimpleUploadedFile('synthetic.png', b'synthetic-image', content_type='image/png')}, format='multipart')
    assert failed.status_code == 400 and failed.data['error']['code'] == 'image_error'
    assert 'synthetic-storage-secret' not in json.dumps(failed.data) + caplog.text and '/private/storage' not in json.dumps(failed.data) + caplog.text
    with patch('api.v1.catalog.views.product_views.ProductService.add_image', side_effect=ProductServiceError('Bitta mahsulotga maksimal 3 tagacha rasm yuklash mumkin.')):
        business = api(owner, tenant).post(endpoint, {'image': SimpleUploadedFile('synthetic.png', b'synthetic-image', content_type='image/png')}, format='multipart')
    assert business.status_code == 400 and 'maksimal 3' in business.data['error']['message']
