import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { SetupAccountScreen } from '../src/features/auth/SetupAccountScreen';
import { parseSetupChallenge, parseSetupInfo, setupToken } from '../src/features/auth/setupModel';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { assertAuthScope, request } from '../src/api/client';
import { ApiError } from '../src/api/errors';
const token = 'synthetic-invitation-abcdef123456789';
let mockParams: Record<string, unknown> = {};
const mockAdopt = jest.fn();
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, router: { replace: jest.fn() } }));
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ adoptSetupChallenge: mockAdopt }) }));
jest.mock('../src/api/client', () => ({ request: jest.fn(), assertAuthScope: jest.fn(), captureAuthScope: jest.fn(() => ({ server: 'https://ilbi.uz/api/v1' })) }));
const info = (overrides: object = {}) => ({ valid: true, purpose: 'new_employee', phase: 'password_required', has_username: false, username: '', phone_hint: '+99890***1234', email_hint: 'wo***@example.invalid', tenant_name: 'Contract store', position: 'Kassir', ...overrides });
const challenge = { login_ticket: 'synthetic-ticket', phone_hint: '+99890***1234', telegram_linked: false, otp_sent: false };
const renderScreen = () => render(<ThemeProvider><SetupAccountScreen /></ThemeProvider>);
async function openWithToken() { mockParams = { token }; return renderScreen(); }
beforeEach(() => {
  jest.clearAllMocks(); mockParams = {};
  jest.mocked(assertAuthScope).mockImplementation(() => {});
  mockAdopt.mockImplementation(() => {});
  jest.mocked(request).mockImplementation(async path => path.includes('/verify/') ? info() : challenge);
});
describe('Native invitation/reset links', () => {
  test('accepts the configured native scheme, exact public HTTPS route and plain token without forwarding destinations', () => {
    expect(setupToken(token)).toBe(token);
    expect(setupToken('https://ilbi.uz/setup-account?token=' + token + '&redirect=https://evil.example')).toBe(token);
    expect(setupToken('ilbi://setup-account?token=' + token)).toBe(token);
    expect(setupToken('ilbi:///reset-password?token=' + token)).toBe(token);
  });
  test.each([
    'https://ilbi.uz.evil.example/setup-account?token=', 'http://ilbi.uz/setup-account?token=',
    'https://ilbi.uz:9000/setup-account?token=', 'https://user@ilbi.uz/setup-account?token=',
    'https://evil.example/setup-account?token=', 'ilbi://other-page?token=', 'https://ilbi.uz/downloads?token=',
  ])('rejects untrusted or unrelated pasted URL %s', prefix => expect(() => setupToken(prefix + token)).toThrow());
  test('rejects duplicate tokens and malformed server metadata/challenges', () => {
    expect(() => setupToken(`https://ilbi.uz/setup-account?token=${token}&token=other`)).toThrow();
    expect(() => parseSetupInfo(info({ phase: 'invented' }))).toThrow();
    expect(() => parseSetupInfo(info({ valid: false }))).toThrow();
    expect(() => parseSetupChallenge({ ...challenge, access: 'unverified' })).toThrow();
    expect(() => parseSetupChallenge({ login_ticket: 'https://evil.example' })).toThrow();
  });
  test('paste alone does not submit, inspect is public/local-server-only and secret link is masked', async () => {
    const screen = await renderScreen();
    await fireEvent.changeText(screen.getByLabelText('Taklif yoki tiklash havolasi'), 'https://ilbi.uz/setup-account?token=' + token);
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Taklif yoki tiklash havolasi').props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getByText('Havolani tekshirish'));
    expect(request).toHaveBeenCalledWith('/auth/password-reset/verify/?token=' + token, expect.objectContaining({ skipTenant: true, expectedServerScope: 'https://ilbi.uz/api/v1' }));
    expect(await screen.findByText('Jamoaga xush kelibsiz · Contract store · Kassir')).toBeTruthy();
  });
  test('incoming link is inspected once without consuming a token or sending OTP/password', async () => {
    const screen = await openWithToken(); await screen.findByLabelText('Yangi parol');
    expect(jest.mocked(request).mock.calls).toHaveLength(1);
    expect(mockAdopt).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText('Yangi parol'), 'Typing-is-not-submitting');
    expect(jest.mocked(request).mock.calls).toHaveLength(1);
  });
  test('password mismatch and missing username are red and never reach confirm', async () => {
    const screen = await openWithToken();
    await fireEvent.press(await screen.findByText('Parolni saqlash va davom etish'));
    expect(screen.getByLabelText('Yangi foydalanuvchi nomi').props['aria-invalid']).toBe(true);
    expect(screen.getByLabelText('Yangi parol').props['aria-invalid']).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Yangi parol'), 'Long-password-123');
    await fireEvent.press(screen.getByText('Parolni saqlash va davom etish'));
    expect(screen.getByLabelText('Yangi parolni takrorlang').props['aria-invalid']).toBe(true);
    expect(jest.mocked(request).mock.calls.some(([path]) => path.includes('/confirm/'))).toBe(false);
  });
  test('first-time confirmation adopts only the server ticket and continues existing Telegram/OTP login', async () => {
    const screen = await openWithToken(); await screen.findByLabelText('Yangi parol');
    await fireEvent.changeText(screen.getByLabelText('Yangi foydalanuvchi nomi'), 'worker');
    await fireEvent.changeText(screen.getByLabelText('Yangi parol'), 'Long-password-123');
    await fireEvent.changeText(screen.getByLabelText('Yangi parolni takrorlang'), 'Long-password-123');
    await fireEvent.press(screen.getByText('Parolni saqlash va davom etish'));
    expect(request).toHaveBeenCalledWith('/auth/password-reset/confirm/', expect.objectContaining({ method: 'POST', body: { token, new_password: 'Long-password-123', username: 'worker' } }));
    expect(mockAdopt).toHaveBeenCalledWith({ login_ticket: 'synthetic-ticket', phone_hint: '+99890***1234' });
    expect(router.replace).toHaveBeenCalledWith('/login');
    expect(screen.getByLabelText('Yangi parol').props.value).toBe('');
    expect(screen.getByLabelText('Taklif yoki tiklash havolasi').props.value).toBe('');
  });
  test('pending 2FA resumes without another password change', async () => {
    jest.mocked(request).mockImplementation(async path => path.includes('/verify/') ? info({ phase: 'pending_2fa', has_username: true, username: 'worker' }) : challenge);
    const screen = await openWithToken();
    await fireEvent.press(await screen.findByText('Telegram tasdiqlashni davom ettirish'));
    expect(screen.queryByLabelText('Yangi parol')).toBeNull();
    expect(request).toHaveBeenCalledWith('/auth/password-reset/resume/', expect.objectContaining({ method: 'POST', body: { token } }));
    expect(jest.mocked(request).mock.calls.some(([path]) => path.includes('/confirm/'))).toBe(false);
  });
  test('reset password of an existing account never submits a replacement username', async () => {
    jest.mocked(request).mockImplementation(async path => path.includes('/verify/') ? info({ purpose: 'reset_password', has_username: true, username: 'existing' }) : challenge);
    const screen = await openWithToken(); await screen.findByLabelText('Yangi parol');
    expect(screen.queryByLabelText('Yangi foydalanuvchi nomi')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Yangi parol'), 'Reset-password-123');
    await fireEvent.changeText(screen.getByLabelText('Yangi parolni takrorlang'), 'Reset-password-123');
    await fireEvent.press(screen.getByText('Parolni saqlash va davom etish'));
    expect(jest.mocked(request).mock.calls.find(([path]) => path.includes('/confirm/'))?.[1]?.body).toEqual({ token, new_password: 'Reset-password-123' });
  });
  test('expired/revoked links never expose password fields or create tickets', async () => {
    jest.mocked(request).mockResolvedValue({ valid: false });
    const screen = await openWithToken();
    expect(await screen.findByText(/Ushbu havola eskirgan, bekor qilingan/)).toBeTruthy();
    expect(screen.getByLabelText('Taklif yoki tiklash havolasi').props['aria-invalid']).toBe(true);
    expect(screen.queryByLabelText('Yangi parol')).toBeNull();
    expect(mockAdopt).not.toHaveBeenCalled();
  });
  test('a lost confirm response clears secrets and requires read-only recheck then resume', async () => {
    let confirmed = false;
    jest.mocked(request).mockImplementation(async path => {
      if (path.includes('/confirm/')) { confirmed = true; throw new ApiError('Javob yo‘q.', 0, null, 0, 'TIMEOUT'); }
      if (path.includes('/verify/')) return info(confirmed ? { phase: 'pending_2fa', has_username: true } : {});
      return challenge;
    });
    const screen = await openWithToken(); await screen.findByLabelText('Yangi parol');
    await fireEvent.changeText(screen.getByLabelText('Yangi foydalanuvchi nomi'), 'worker');
    await fireEvent.changeText(screen.getByLabelText('Yangi parol'), 'Long-password-123');
    await fireEvent.changeText(screen.getByLabelText('Yangi parolni takrorlang'), 'Long-password-123');
    await fireEvent.press(screen.getByText('Parolni saqlash va davom etish'));
    expect(screen.getByLabelText('Yangi parol').props.value).toBe('');
    expect(screen.queryByText('Parolni saqlash va davom etish')).toBeNull();
    await fireEvent.press(screen.getByText('Havolani qayta tekshirish'));
    await fireEvent.press(await screen.findByText('Telegram tasdiqlashni davom ettirish'));
    expect(jest.mocked(request).mock.calls.filter(([path]) => path.includes('/confirm/'))).toHaveLength(1);
    expect(mockAdopt).toHaveBeenCalledTimes(1);
  });
  test('late verification from an old link cannot populate the replacement account screen', async () => {
    let finish!: (value: any) => void;
    jest.mocked(request).mockImplementation(path => path.endsWith(token) ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(info({ tenant_name: 'Second' })));
    const screen = await openWithToken(); await waitFor(() => expect(finish).toBeDefined());
    mockParams = { token: 'different-invitation-abcdef123456789' };
    await screen.rerender(<ThemeProvider><SetupAccountScreen /></ThemeProvider>);
    await screen.findByText('Jamoaga xush kelibsiz · Second · Kassir');
    await act(async () => finish(info({ tenant_name: 'Old' })));
    expect(screen.queryByText('Jamoaga xush kelibsiz · Old · Kassir')).toBeNull();
  });
  test('session changes while verification is pending cannot adopt a ticket', async () => {
    const screen = await openWithToken(); await screen.findByLabelText('Yangi parol');
    jest.mocked(assertAuthScope).mockImplementation(() => { throw new ApiError('Sessiya o‘zgardi.', 0, null, 0, 'SESSION_CHANGED'); });
    await fireEvent.changeText(screen.getByLabelText('Yangi foydalanuvchi nomi'), 'worker');
    await fireEvent.changeText(screen.getByLabelText('Yangi parol'), 'Long-password-123');
    await fireEvent.changeText(screen.getByLabelText('Yangi parolni takrorlang'), 'Long-password-123');
    await fireEvent.press(screen.getByText('Parolni saqlash va davom etish'));
    expect(mockAdopt).not.toHaveBeenCalled();
    expect(jest.mocked(request).mock.calls.some(([path]) => path.includes('/confirm/'))).toBe(false);
  });
});
