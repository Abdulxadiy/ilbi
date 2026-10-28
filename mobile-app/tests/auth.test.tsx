import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthProvider, useAuth } from '../src/features/auth/AuthContext';
import { request, setTokens } from '../src/api/client';
import { ApiError } from '../src/api/errors';
let mockGeneration = 0, mockAccess: string | null = null, mockTenant: string | null = null;
let mockCleared: (() => void) | undefined;
jest.mock('../src/features/notifications/pushRegistration', () => ({ revokePushInstallation: jest.fn(async () => {}) }));
jest.mock('../src/api/client', () => ({
  request: jest.fn(), getAuthGeneration: () => mockGeneration,
  getAccessToken: () => mockAccess, getRefreshToken: () => null, parseJwt: () => null,
  initializeAuthFromStorage: jest.fn(async () => ({})),
  onSessionCleared: (listener: () => void) => { mockCleared = listener; return () => { mockCleared = undefined; }; },
  clearTokens: jest.fn(async () => { mockAccess = null; mockGeneration++; mockCleared?.(); }),
  setTokens: jest.fn(async (access: string) => { mockAccess = access; mockGeneration++; }),
  setActiveTenantId: jest.fn(async (value: string | null) => { if (value !== mockTenant) mockGeneration++; mockTenant = value; }),
  refreshAccessToken: jest.fn(),
}));
const member = { id: 10, name: 'Store', is_owner: false, permissions: ['sales.add_sale'] };
const profile = { id: 1, username: 'cashier', role: 'staff', first_name: '', last_name: '', phone_number: '', terms_accepted: true, tenants: [member] };
const wrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider>{children}</AuthProvider>;
const calls = () => jest.mocked(request).mock.calls.map(([path]) => path);
describe('Verified authentication state machine', () => {
  beforeEach(async () => { jest.clearAllMocks(); mockAccess = null; mockTenant = null; mockGeneration = 0; await AsyncStorage.clear(); });
  afterEach(() => jest.restoreAllMocks());
  test('account setup reuses Telegram proof and cannot authenticate from a link ticket alone', async () => {
    jest.mocked(request).mockImplementation(async path => path.includes('telegram-status') ? { telegram_linked: true } : path.includes('send-otp') ? { otp_sent: true } : path.includes('verify-otp') ? { access: 'a', refresh: 'r' } : profile);
    const hook = await renderHook(useAuth, { wrapper });
    await act(async () => hook.result.current.adoptSetupChallenge({ login_ticket: 'setup-ticket', phone_hint: '+99890***1234' }));
    expect(hook.result.current.isAuthenticated).toBe(false);
    expect(hook.result.current.loginStep).toBe('telegram');
    expect(setTokens).not.toHaveBeenCalled();
    await act(async () => { await hook.result.current.checkTelegram(); });
    expect(hook.result.current.loginStep).toBe('otp');
    await act(async () => { await hook.result.current.verifyOtp('123456'); });
    expect(hook.result.current.isAuthenticated).toBe(true);
    expect(request).toHaveBeenCalledWith('/auth/admin-login/verify-otp/', { method: 'POST', body: { login_ticket: 'setup-ticket', verification_code: '123456' } });
    expect(() => hook.result.current.adoptSetupChallenge({ login_ticket: 'another-ticket' })).toThrow('Avval joriy hisobdan chiqing.');
  });
  test('direct login commits complete validated membership without a thin tenant lookup', async () => {
    jest.mocked(request).mockImplementation(async path => path === '/auth/admin-login/' ? { access: 'a', refresh: 'r' } : profile);
    const hook = await renderHook(useAuth, { wrapper });
    await act(async () => { await hook.result.current.login('cashier', 'password'); });
    expect(hook.result.current.isAuthenticated).toBe(true);
    expect(hook.result.current.activeTenant?.permissions).toEqual(['sales.add_sale']);
    expect(calls()).not.toContain('/tenants/my/');
  });
  test('a failed profile does not publish a half-initialized authenticated user', async () => {
    jest.mocked(request).mockImplementation(async path => { if (path === '/auth/admin-login/') return { access: 'a', refresh: 'r' }; throw Error('Profile unavailable'); });
    const hook = await renderHook(useAuth, { wrapper });
    await act(async () => { await expect(hook.result.current.login('cashier', 'password')).rejects.toThrow('Profile unavailable'); });
    expect(hook.result.current.user).toBeNull();
    expect(hook.result.current.activeTenant).toBeNull();
    expect(hook.result.current.sessionError).toBe('Profile unavailable');
  });
  test('a profile arriving after logout cannot resurrect the old account', async () => {
    let respond!: (profile: any) => void;
    jest.mocked(request).mockImplementation(path => path === '/auth/admin-login/' ? Promise.resolve({ access: 'a', refresh: 'r' }) : new Promise(resolve => { respond = resolve; }));
    const hook = await renderHook(useAuth, { wrapper });
    let attempt!: Promise<unknown>;
    await act(async () => { attempt = hook.result.current.login('cashier', 'password').catch(error => error); await Promise.resolve(); });
    await act(async () => { await hook.result.current.logout(); respond(profile); await attempt; });
    expect(hook.result.current.user).toBeNull();
    expect(hook.result.current.isAuthenticated).toBe(false);
  });
  test('a linked account requests one initial OTP before claiming it was sent', async () => {
    jest.mocked(request).mockImplementation(async path => path === '/auth/admin-login/' ? { login_ticket: 'ticket', telegram_linked: true } : { otp_sent: true });
    const hook = await renderHook(useAuth, { wrapper });
    await act(async () => { await hook.result.current.login('cashier', 'password'); });
    expect(calls()).toEqual(['/auth/admin-login/', '/auth/admin-login/send-otp/']);
    expect(hook.result.current.loginStep).toBe('otp');
    await act(async () => { await expect(hook.result.current.sendOtp()).rejects.toMatchObject({ status: 429 }); });
  });
  test('an unlinked account waits for bot confirmation and sends only one code', async () => {
    jest.mocked(request).mockImplementation(async path => path === '/auth/admin-login/' ? { login_ticket: 'ticket', telegram_linked: false } : path.includes('telegram-status') ? { telegram_linked: true } : { otp_sent: true });
    const hook = await renderHook(useAuth, { wrapper });
    await act(async () => { await hook.result.current.login('cashier', 'password'); });
    expect(hook.result.current.loginStep).toBe('telegram');
    expect(calls()).toEqual(['/auth/admin-login/']);
    await act(async () => { await Promise.all([hook.result.current.checkTelegram(), hook.result.current.checkTelegram()]); });
    expect(calls().filter(path => path.includes('send-otp'))).toHaveLength(1);
    expect(hook.result.current.loginStep).toBe('otp');
  });
  test('incomplete OTP is rejected locally; expired ticket returns to credentials', async () => {
    jest.mocked(request).mockImplementation(async path => {
      if (path === '/auth/admin-login/') return { login_ticket: 'ticket', telegram_linked: true };
      if (path.includes('send-otp')) return { otp_sent: true };
      throw new ApiError('Ticket expired', 401, { error: 'invalid_or_expired_login_ticket' });
    });
    const hook = await renderHook(useAuth, { wrapper });
    await act(async () => { await hook.result.current.login('cashier', 'password'); });
    const count = calls().length;
    await act(async () => { await expect(hook.result.current.verifyOtp('1234')).rejects.toThrow('6 xonali'); });
    expect(calls()).toHaveLength(count);
    await act(async () => { await expect(hook.result.current.verifyOtp('123456')).rejects.toThrow('Ticket expired'); });
    expect(hook.result.current.loginStep).toBe('credentials');
  });

  test('a verification response after returning to login cannot create a session', async () => {
    let finish!: (value: any) => void;
    jest.mocked(request).mockImplementation(path => {
      if (path === '/auth/admin-login/') return Promise.resolve({ login_ticket: 'ticket', telegram_linked: true });
      if (path.includes('send-otp')) return Promise.resolve({ otp_sent: true });
      return new Promise(resolve => { finish = resolve; });
    });
    const hook = await renderHook(useAuth, { wrapper });
    await act(async () => { await hook.result.current.login('cashier', 'password'); });
    let attempt!: Promise<unknown>;
    await act(async () => { attempt = hook.result.current.verifyOtp('123456').catch(error => error); });
    await act(async () => { hook.result.current.resetLogin(); finish({ access: 'stale', refresh: 'stale' }); });
    expect(await attempt).toMatchObject({ code: 'SESSION_CHANGED' });
    expect(setTokens).not.toHaveBeenCalled();
    expect(hook.result.current.isAuthenticated).toBe(false);
  });

  test('duplicate OTP submissions share one request and only commit one authenticated session', async () => {
    let finish!: (value: any) => void;
    jest.mocked(request).mockImplementation(path => {
      if (path === '/auth/admin-login/') return Promise.resolve({ login_ticket: 'ticket', telegram_linked: true });
      if (path.includes('send-otp')) return Promise.resolve({ otp_sent: true });
      if (path.includes('verify-otp')) return new Promise(resolve => { finish = resolve; });
      return Promise.resolve(profile);
    });
    const hook = await renderHook(useAuth, { wrapper });
    await act(async () => { await hook.result.current.login('cashier', 'password'); });
    let attempts!: Promise<unknown>[];
    await act(async () => { attempts = [hook.result.current.verifyOtp('123456'), hook.result.current.verifyOtp('123456')]; });
    expect(calls().filter(path => path.includes('verify-otp'))).toHaveLength(1);
    await act(async () => { finish({ access: 'a', refresh: 'r' }); await Promise.all(attempts); });
    expect(setTokens).toHaveBeenCalledTimes(1);
    expect(hook.result.current.isAuthenticated).toBe(true);
  });

  test('a cancelled credential response cannot restore a session', async () => {
    let finish!: (value: any) => void;
    jest.mocked(request).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const hook = await renderHook(useAuth, { wrapper });
    let attempt!: Promise<unknown>;
    await act(async () => { attempt = hook.result.current.login('cashier', 'password').catch(error => error); });
    await act(async () => { hook.result.current.resetLogin(); finish({ access: 'stale', refresh: 'stale' }); });
    expect(await attempt).toMatchObject({ code: 'SESSION_CHANGED' });
    expect(setTokens).not.toHaveBeenCalled();
  });
});
