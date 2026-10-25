import { secureStorage } from '../src/api/storage';
import { loadGuestIdentity, createSupportSession } from '../src/features/support/session';
import { request, assertAuthScope } from '../src/api/client';
import { startSupportPolling } from '../src/features/support/polling';
jest.mock('../src/api/storage', () => ({ secureStorage: { getItem: jest.fn(), setItem: jest.fn() } }));
jest.mock('../src/api/client', () => ({ request: jest.fn(), assertAuthScope: jest.fn(), captureAuthScope: () => ({}) }));
describe('Private support identity and serial polling', () => {
  beforeEach(() => jest.clearAllMocks());
  test('concurrent guest starts share one protected, origin-scoped identity', async () => {
    jest.mocked(secureStorage.getItem).mockResolvedValue(null); jest.mocked(secureStorage.setItem).mockResolvedValue();
    const [a, b] = await Promise.all([loadGuestIdentity('https://guest-a.invalid/api/v1'), loadGuestIdentity('https://guest-a.invalid/api/v1')]);
    const c = await loadGuestIdentity('https://guest-b.invalid/api/v1');
    expect(a).toEqual(b); expect(a.token).toMatch(/^[a-f\d]{64}$/); expect(a.token).not.toBe(c.token);
    expect(secureStorage.setItem).toHaveBeenCalledTimes(2);
    expect(jest.mocked(secureStorage.setItem).mock.calls.every(([key]) => /^[\w.-]+$/.test(key))).toBe(true);
  });
  test('a keychain failure cannot publish an unpersisted guest identity', async () => {
    jest.mocked(secureStorage.getItem).mockResolvedValue(null); jest.mocked(secureStorage.setItem).mockRejectedValueOnce(Error('Keychain unavailable'));
    await expect(loadGuestIdentity('https://failure.invalid/api/v1')).rejects.toThrow('Keychain unavailable');
    jest.mocked(secureStorage.setItem).mockResolvedValue();
    expect((await loadGuestIdentity('https://failure.invalid/api/v1')).token).toMatch(/^[a-f\d]{64}$/);
  });
  test('authenticated support never reuses the guest header and lists across account stores without a stale tenant', async () => {
    jest.mocked(request).mockResolvedValue({ results: [] });
    const session = createSupportSession({ userId: 8, tenantId: 2, guest: { id: '00000000-0000-4000-8000-000000000001', token: 'a'.repeat(64) } });
    await session.call();
    const [path, options] = jest.mocked(request).mock.calls[0];
    expect(path).toBe('/support/conversations/'); expect(options?.skipTenant).toBe(true);
    expect(new Headers(options?.headers).get('X-Support-Token')).toBeNull(); expect(assertAuthScope).toHaveBeenCalled();
  });
  test('guest credentials stay in headers and never enter a route or visible scope key', async () => {
    const token = 'b'.repeat(64), session = createSupportSession({ userId: null, guest: { id: '00000000-0000-4000-8000-000000000002', token } });
    await session.call('?page=1');
    const [path, options] = jest.mocked(request).mock.calls[0];
    expect(path).toBe('/support/guest/?page=1'); expect(path).not.toContain(token); expect(session.key).not.toContain(token);
    expect(new Headers(options?.headers).get('X-Support-Token')).toBe(token);
  });
  test('slow reads do not overlap and stop prevents later polling', async () => {
    jest.useFakeTimers(); let finish!: () => void;
    const task = jest.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const polling = startSupportPolling(task);
    await jest.advanceTimersByTimeAsync(20000); expect(task).toHaveBeenCalledTimes(1);
    finish(); await jest.advanceTimersByTimeAsync(5000); expect(task).toHaveBeenCalledTimes(2);
    polling.stop(); finish(); await jest.advanceTimersByTimeAsync(60000); expect(task).toHaveBeenCalledTimes(2); jest.useRealTimers();
  });
  test('a server Retry-After survives manual retries and inactive routes make no reads', async () => {
    jest.useFakeTimers(); const task = jest.fn<Promise<void>, []>().mockRejectedValueOnce({ retryAfterMs: 30000 }).mockResolvedValue();
    const polling = startSupportPolling(task); await jest.advanceTimersByTimeAsync(0);
    polling.retry(); await jest.advanceTimersByTimeAsync(29999); expect(task).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1); expect(task).toHaveBeenCalledTimes(2); polling.stop();
    const inactive = startSupportPolling(task, { active: () => false }); await jest.advanceTimersByTimeAsync(20000); expect(task).toHaveBeenCalledTimes(2); inactive.stop(); jest.useRealTimers();
  });
});
