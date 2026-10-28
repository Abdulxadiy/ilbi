import test from 'node:test';
import assert from 'node:assert/strict';
import { captureRequestValidation, validationFields } from '../src/utils/formValidation.js';

test('standard backend validation envelope returns field messages, not generic metadata', () => {
  assert.deepEqual(validationFields({ error: { code: 'validation_error', message: 'Invalid', details: { email: ['Already used.'], non_field_errors: ['Try later.'] } }, email: ['Already used.'] }), { email: 'Already used.' });
});

test('nested serializer errors retain exact array indices for safe field matching', () => {
  assert.deepEqual(validationFields({ variants: [{ price_partner: ['Must be positive.', 'Check the amount.'] }, { barcode: ['Duplicate.'] }] }), { 'variants.0.price_partner': 'Must be positive. Check the amount.', 'variants.1.barcode': 'Duplicate.' });
});

test('canonical business code/message fields survive envelope metadata exclusion', () => {
  assert.deepEqual(validationFields({ error: { code: 'validation_error', message: 'Invalid', details: { code: ['Duplicate article code.'], message: ['Too long.'], variants: [{ code: ['Variant code already used.'] }] } } }), { code: 'Duplicate article code.', message: 'Too long.', 'variants.0.code': 'Variant code already used.' });
});

test('plain serializer code fields remain fields while response metadata is excluded', () => {
  assert.deepEqual(validationFields({ code: ['Duplicate.'], message: ['Too long.'] }), { code: 'Duplicate.', message: 'Too long.' });
  assert.deepEqual(validationFields({ code: 'permission_denied', message: 'Forbidden' }), {});
});

test('general network, permission and non-field errors do not invent rejected inputs', () => {
  for (const input of [null, 'Offline', { detail: 'Forbidden' }, { error: { code: 'business_logic_error', message: 'Not enough stock', details: null } }, { non_field_errors: ['Denied'] }]) assert.deepEqual(validationFields(input), {});
});

test('nested field presentation hides credential metadata and hash strings while preserving password guidance and business fields', () => {
  const result = validationFields({ error: { code: 'validation_error', message: 'Invalid', details: {
    new_password: ['Yangi parol kamida 8 belgidan iborat bo‘lsin.'], old_password: ['pbkdf2_sha256$1000000$salt$synthetic'],
    guest_hash: ['a'.repeat(64)], profile: { access_token: ['private-token'] },
    variants: [{ code: ['Artikul takrorlangan.'], password_hash: ['b'.repeat(64)] }], message: ['Qiymatni tekshiring.'],
  } } });
  assert.equal(result.new_password, 'Yangi parol kamida 8 belgidan iborat bo‘lsin.');
  assert.equal(result.old_password, '[yashirilgan]');
  assert.equal(result['variants.0.code'], 'Artikul takrorlangan.');
  assert.equal(result.message, 'Qiymatni tekshiring.');
  assert(!JSON.stringify(result).includes('private-token')); assert(!JSON.stringify(result).includes('synthetic'));
  assert(!Object.keys(result).some(key => /guest_hash|password_hash|access_token/.test(key)));
});

test('alternate field error payloads are supported without interpreting HTML', () => {
  assert.deepEqual(validationFields({ field_errors: { name: ['<img src=x onerror=alert(1)>'] } }), { name: '<img src=x onerror=alert(1)>' });
  assert.deepEqual(validationFields({ errors: { phone_number: ['Incomplete.'] } }), { phone_number: 'Incomplete.' });
});

test('the API helper remains safe outside a browser and does not associate reads with forms', () => {
  assert.equal(captureRequestValidation('POST', { email: 'test@example.com' }), null);
  assert.equal(captureRequestValidation('GET'), null);
});
