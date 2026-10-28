import React from 'react';
import { render } from '@testing-library/react-native';
import { safeDisplayText, redactSensitiveData, safeErrorData, submittedSecretValues, GENERIC_ERROR, HIDDEN_VALUE } from '../src/security/presentation';
import { ApiError, errorMessage } from '../src/api/errors';
import { fieldErrors } from '../src/api/validation';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { Notice } from '../src/components/ui/Page';
import { ListState } from '../src/components/ui/ListState';
import { Input } from '../src/components/ui/Input';
import { Toast } from '../src/components/ui/Toast';

const verifier = 'ab'.repeat(32);
const passwordHash = 'pbkdf2_sha256$1000000$syntheticSalt$syntheticDigestOnly';
const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoxfQ.syntheticSignature';
describe('Credential-safe mobile presentation', () => {
  test.each([passwordHash, '$2b$12$syntheticNotARealPasswordHash', 'scrypt$synthetic$salt$digest', jwt, 'Bearer synthetic-opaque-token', 'password=ExampleOnlyPassword', 'refresh_token=synthetic-refresh', 'guest_hash=' + verifier, 'https://example.invalid/?token=synthetic-query', 'postgres://synthetic-user:synthetic-password@localhost/db'])('sensitive system text cannot expose %s', value => {
    const shown = safeDisplayText(value);
    expect(shown).not.toBe(value);
    expect(shown).not.toContain('ExampleOnlyPassword');
    expect(shown).not.toContain('synthetic-refresh');
    expect(shown).not.toContain('synthetic-query');
    expect(shown).not.toContain('synthetic-password');
    expect(shown).not.toContain(passwordHash); expect(shown).not.toContain(jwt); expect(shown).not.toContain(verifier);
  });
  test.each(['-----BEGIN PRIVATE KEY-----\nsynthetic-only\n-----END PRIVATE KEY-----', 'Traceback (most recent call last):\n  synthetic failure', '<!DOCTYPE html><html>Internal debug dump</html>', 'Synthetic failure\n    at load (/private/example.js:19:2)'])('private key and diagnostic dump use a safe message', value => {
    expect(safeDisplayText(value)).toBe(GENERIC_ERROR);
  });
  test('normal validation and business amounts remain useful', () => {
    for (const text of ['Joriy parol noto‘g‘ri.', 'Yangi parol kamida 8 ta belgidan iborat bo‘lsin.', 'Narx 12 500,50 UZS dan oshmasin.', 'Kod uzun.', 'Password must contain 8 characters.']) expect(safeDisplayText(text)).toBe(text);
  });
  test('submitted password echoes are removed even without recognizable key syntax', async () => {
    const password = 'Synthetic Password Echo!';
    const values = submittedSecretValues({ username: 'Keep this name', password, nested: { new_password: 'Another Example Password!' } });
    expect(values).toEqual([password, 'Another Example Password!']);
    const safe = safeErrorData({ error: { message: 'Rejected «' + password + '»', details: { new_password: ['Use at least8 characters.'], access: 'synthetic-token' } } }, values);
    expect(JSON.stringify(safe)).not.toContain(password); expect(JSON.stringify(safe)).not.toContain('synthetic-token');
    expect(safe.error.details.new_password).toEqual(['Use at least8 characters.']);
    const screen = await render(<ThemeProvider><Input label="Yangi parol" value={password} secureTextEntry error={'Rejected «' + password + '»'} /></ThemeProvider>);
    expect(screen.queryByText(new RegExp(password))).toBeNull();
    expect(screen.getByLabelText('Yangi parol').props.accessibilityHint).not.toContain(password);
  });
  test('raw arbitrary error response fields are not joined into a visible message', () => {
    expect(errorMessage({ access: 'short-access-value', password: 'short-password-value', guest_hash: verifier })).toBe('So‘rov bajarilmadi');
    expect(errorMessage({ error: { message: 'password=short-password-value' } })).not.toContain('short-password-value');
    expect(errorMessage({ email: ['Email noto‘g‘ri.'] })).toBe('Email noto‘g‘ri.');
    expect(new ApiError(passwordHash, 400).message).not.toContain(passwordHash);
  });
  test('field validation preserves password guidance and hides credential metadata', () => {
    const fields = fieldErrors(new ApiError('Invalid', 400, { error: { details: { new_password: ['Parol kamida 8 ta belgi.'], password_hash: passwordHash, guest_hash: verifier, code: ['Kod uzun.'], name: ['Token: ' + jwt] } } }));
    expect(fields.new_password).toBe('Parol kamida 8 ta belgi.'); expect(fields.code).toBe('Kod uzun.');
    expect(fields.password_hash).toBeUndefined(); expect(fields.guest_hash).toBeUndefined();
    expect(fields.name).not.toContain(jwt);
  });
  test('nested historical audit credentials are masked without changing financial data or public verification hashes', () => {
    const original = { amount: '12.50', code: 'ABC-19', idempotency_key: 'original-operation', request_key: verifier, sha256: verifier, fingerprint: 'ABCD-1234', nested: { old_password: 'old synthetic password', refresh: 'synthetic refresh', password: { old: passwordHash, new: 'new synthetic password' } }, fields: [{ key: 'guest_hash', label: 'Guest', value: verifier }, { key: 'quantity', value: '1.250' }] };
    const shown = redactSensitiveData(original);
    expect(shown.amount).toBe('12.50'); expect(shown.code).toBe('ABC-19'); expect(shown.idempotency_key).toBe('original-operation');
    expect(shown.sha256).toBe(verifier); expect(shown.fingerprint).toBe('ABCD-1234');
    expect(shown.request_key).toBe(verifier);
    expect(shown.nested.old_password).toBe(HIDDEN_VALUE); expect(shown.nested.password).toBe(HIDDEN_VALUE); expect(shown.nested.refresh).toBe(HIDDEN_VALUE);
    expect(shown.fields[0].value).toBe(HIDDEN_VALUE); expect(shown.fields[1].value).toBe('1.250');
    expect(original.nested.old_password).toBe('old synthetic password');
  });
  test('legacy credential marker rows redact before/after aliases and preserve business changes', () => {
    for (const marker of ['key', 'field', 'label']) {
      const shown = redactSensitiveData({ [marker]: 'password', value: 'synthetic secret', old_value: 'old synthetic secret', newValue: 'new synthetic secret', before: 'before synthetic secret', after: 'after synthetic secret' });
      for (const key of ['value', 'old_value', 'newValue', 'before', 'after']) expect(shown[key]).toBe(HIDDEN_VALUE);
    }
    expect(redactSensitiveData({ field: 'quantity', before: '1.250', after: '2.500' })).toEqual({ field: 'quantity', before: '1.250', after: '2.500' });
  });
  test('rendered alerts, native errors, input accessibility hints and toasts cannot repeat a verifier', async () => {
    const screen = await render(<ThemeProvider><Notice error>{'Guest verifier: ' + verifier}</Notice><ListState error={new Error('refresh_token=synthetic-refresh')} onRetry={() => {}} /><Input label="Password" error={passwordHash} value="" /><Toast message={'Bearer ' + jwt} onDismiss={() => {}} type="error" /></ThemeProvider>);
    expect(screen.queryByText(new RegExp(verifier))).toBeNull(); expect(screen.queryByText(new RegExp('synthetic-refresh'))).toBeNull();
    expect(screen.queryByText(passwordHash)).toBeNull(); expect(screen.queryByText(new RegExp(jwt))).toBeNull();
    expect(screen.getByLabelText('Password').props.accessibilityHint).not.toContain(passwordHash);
  });
});
