import test from 'node:test';
import assert from 'node:assert/strict';
import { HIDDEN_VALUE, redactRequestError, redactSensitiveData, safeApiErrorMessage, safeDisplayText } from '../src/utils/safePresentation.js';

test('credential verifiers, JWTs, bearer credentials and labelled passwords are redacted', () => {
  const values = ['pbkdf2_sha256$1000000$salt$syntheticHash', '$2b$12$' + 'A'.repeat(53), 'a'.repeat(64),
    'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoxfQ.signature', 'Bearer synthetic-access-token', 'password="synthetic secret value"',
    'postgres://user:syntheticPassword@localhost/db', 'https://ilbi.uz/recover?token=synthetic-token', '{"admin_password":"synthetic secret value"}'];
  for (const raw of values) {
    const safe = safeDisplayText(raw);
    assert.notEqual(safe, raw);
    assert(!safe.includes('syntheticPassword'));
    assert(!safe.includes('synthetic-token'));
  }
});
test('audit redaction is recursive and preserves business IDs, amounts and public security flags', () => {
  const raw = { sale_id: 42, total_amount: '12345.67', product_code: '12345678901234567', password_changed: true,
    nested: [{ guest_hash: 'a'.repeat(64), access_token: 'synthetic', old_password: 'plain-secret', name: 'Mijoz' }] };
  assert.deepEqual(redactSensitiveData(raw), { ...raw, nested: [{ guest_hash: HIDDEN_VALUE, access_token: HIDDEN_VALUE, old_password: HIDDEN_VALUE, name: 'Mijoz' }] });
  assert.equal(raw.nested[0].old_password, 'plain-secret');
  assert.equal(safeDisplayText('Chek #42 · 12 345.67 UZS · 2026-10-27'), 'Chek #42 · 12 345.67 UZS · 2026-10-27');
  assert.equal(safeDisplayText('Tasdiqlash belgisi: A123-B456'), 'Tasdiqlash belgisi: A123-B456');
  assert.deepEqual(redactSensitiveData({ artifact_sha256: 'c'.repeat(64), sale_id: 42 }), { artifact_sha256: 'c'.repeat(64), sale_id: 42 });
});
test('cyclic/deep audit input is bounded and never requires unsafe object stringification', () => {
  const raw = {}; raw.self = raw;
  assert.deepEqual(redactSensitiveData(raw), { self: HIDDEN_VALUE });
  assert.equal(safeDisplayText({ toString: () => { throw Error('unsafe'); } }, 'Safe'), 'Safe');
});
test('historical audit credential rows and token aliases are hidden without losing financial retry IDs', () => {
  const financialKey = 'b'.repeat(64);
  const raw = { changes: [{ field: 'password', old_value: 'old-private-value', new_value: 'new-private-value' }, { label: 'guest_hash', value: 'a'.repeat(64) }], access: 'private-access', refresh: 'private-refresh', idempotency_key: financialKey, request_key: financialKey, operation_id: financialKey };
  const safe = redactSensitiveData(raw);
  assert.deepEqual(safe.changes[0], { field: 'password', old_value: HIDDEN_VALUE, new_value: HIDDEN_VALUE });
  assert.equal(safe.changes[1].value, HIDDEN_VALUE);
  assert.equal(safe.access, HIDDEN_VALUE); assert.equal(safe.refresh, HIDDEN_VALUE);
  for (const key of ['idempotency_key', 'request_key', 'operation_id']) assert.equal(safe[key], financialKey);
  assert.equal(raw.changes[0].old_value, 'old-private-value');
});
test('API errors never serialize unknown response payloads or expose server debug detail', () => {
  const safe = safeApiErrorMessage({ password: 'plain-secret', access_token: 'synthetic' }, 400);
  assert(!safe.includes('plain-secret')); assert(!safe.includes('synthetic'));
  assert.equal(safeApiErrorMessage({ error: { code: 'validation_error', message: 'Maydonlarni tekshiring.' } }, 400), 'Maydonlarni tekshiring.');
  assert(!safeApiErrorMessage({ detail: 'Database secret=private-value' }, 500).includes('private-value'));
  assert.equal(safeApiErrorMessage({ detail: 'Qoldiq yetarli emas: 5 dona.' }, 400), 'Qoldiq yetarli emas: 5 dona.');
});
test('request-scoped errors redact unlabelled actual password/token echoes before Error message/data creation', () => {
  const body = { old_password: 'Entered old secret', new_password: 'Entered new secret', login_ticket: 'short-private-ticket', amount: '12345.67' };
  const raw = { error: { code: 'validation_error', message: 'Rejected ‹Entered old secret›', details: { new_password: ['Rejected Entered new secret'], nested: [{ message: 'short-private-ticket' }], amount: ['12345.67'] } } };
  const safe = redactRequestError(raw, JSON.stringify(body));
  const serialized = JSON.stringify(safe);
  for (const secret of [body.old_password, body.new_password, body.login_ticket]) assert(!serialized.includes(secret));
  assert.equal(safe.error.message, 'Rejected ‹[yashirilgan]›');
  assert.equal(safe.error.details.amount[0], '12345.67');
  assert.equal(raw.error.message, 'Rejected ‹Entered old secret›');
  assert.equal(body.new_password, 'Entered new secret');
  assert.deepEqual(redactRequestError({ error: { details: { new_password: ['Kamida 8 belgi kiriting.'] } } }, body).error.details.new_password, ['Kamida 8 belgi kiriting.']);
  assert.deepEqual(Object.keys(redactRequestError({ error: { code: 'validation_error', message: 'Invalid' } }, { password: 'code' }).error), ['code', 'message']);
});
test('HTTP failure metadata cannot expose successful-token-shaped aliases', () => {
  const safe = redactRequestError({ detail: 'Invalid credentials', access: 'private-access', refresh: 'private-refresh', token: 'private-token', amount: '12345.67' }, {});
  assert.deepEqual(safe, { detail: 'Invalid credentials', access: HIDDEN_VALUE, refresh: HIDDEN_VALUE, token: HIDDEN_VALUE, amount: '12345.67' });
});
