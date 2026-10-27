import { registerPushToken, revokePushInstallation, retryPushRevocations, pushInstallationState, defaultPushCategories } from '../src/features/notifications/pushRegistration';
import { parsePushTarget } from '../src/features/notifications/pushTarget';
import { request } from '../src/api/client';
const mockRecords = new Map<string, string>();
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('../src/api/environment', () => ({ getApiBaseUrl: () => 'https://ilbi.uz/api/v1', normalizeApiBaseUrl: (value: string) => value }));
jest.mock('../src/api/client', () => ({ request: jest.fn(), assertAuthScope: jest.fn() }));
jest.mock('../src/api/storage', () => ({ secureStorage: { getItem: async (key: string) => mockRecords.get(key) || null, setItem: async (key: string, value: string) => { mockRecords.set(key, value); } } }));
const scope = {} as any;
describe('Push installation lifecycle', () => {
  beforeEach(() => { mockRecords.clear(); jest.clearAllMocks(); jest.mocked(request).mockImplementation(async (_path, options) => ({ registered: true, installation_id: options?.body.installation_id, delivery_enabled: false })); });
  afterEach(() => { jest.restoreAllMocks(); });
  test('registration binds only the current authenticated request and stores no native token', async () => {
    await registerPushToken(7, 'synthetic-native-token', defaultPushCategories, scope);
    const [path, options] = jest.mocked(request).mock.calls[0];
    expect(path).toBe('/auth/push/installations/');
    expect(options?.body).toMatchObject({ application_id: 'uz.ilbi.mobile', platform: 'android', token: 'synthetic-native-token' });
    expect(options?.body).not.toHaveProperty('user_id');
    expect(await pushInstallationState()).toMatchObject({ enabledForUser: 7, registrationIntent: true, pendingRevoke: false });
    expect([...mockRecords.values()].join('')).not.toContain('synthetic-native-token');
  });
  test('offline logout persists revocation and retries without JWT/cookies', async () => {
    await registerPushToken(7, 'synthetic-native-token', defaultPushCategories, scope);
    const fetcher = jest.spyOn(globalThis, 'fetch').mockRejectedValueOnce(Error('offline')).mockResolvedValue({ ok: true } as Response);
    await revokePushInstallation();
    expect(await pushInstallationState()).toMatchObject({ enabledForUser: null, pendingRevoke: true });
    await retryPushRevocations();
    expect(await pushInstallationState()).toMatchObject({ enabledForUser: null, pendingRevoke: false, registrationIntent: false });
    expect(fetcher.mock.calls[1][0]).toBe('https://ilbi.uz/api/v1/auth/push/revoke/');
    const options = fetcher.mock.calls[1][1]!;
    expect(options.credentials).toBe('omit');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
  });
  test('logout drains a late registration before revoking and cannot re-enable that account', async () => {
    let finish!: () => void;
    jest.mocked(request).mockImplementationOnce((_path, options) => new Promise(resolve => { finish = () => resolve({ registered: true, installation_id: options?.body.installation_id, delivery_enabled: false }); }));
    const fetcher = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);
    const registration = registerPushToken(7, 'synthetic-native-token', defaultPushCategories, scope);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(request).toHaveBeenCalledTimes(1);
    const logout = revokePushInstallation();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fetcher).not.toHaveBeenCalled();
    finish(); await registration; await logout;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await pushInstallationState()).toMatchObject({ enabledForUser: null, pendingRevoke: false, registrationIntent: false });
  });
  test('push target metadata rejects malformed ids and arbitrary URLs', () => {
    expect(parsePushTarget({ kind: 'ilbi_inbox', notification_id: '3', recipient_id: '7', tenant_id: '1' })).toEqual({ notificationId: 3, recipientId: 7, tenantId: 1 });
    expect(parsePushTarget({ kind: 'ilbi_inbox', notification_id: 'https://evil.invalid', recipient_id: '7', tenant_id: '1' })).toBeNull();
    expect(parsePushTarget({ kind: 'ilbi_inbox', notification_id: '3', recipient_id: '../7', tenant_id: '1' })).toBeNull();
    expect(parsePushTarget({ kind: 'unknown', notification_id: '3', recipient_id: '7', tenant_id: '1' })).toBeNull();
  });
});
