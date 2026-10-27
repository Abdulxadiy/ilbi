import { assertAuthScope, captureAuthScope, clearTokens, getAccessToken, getAuthGeneration, request, setTokens, setApiBaseUrl, getApiBaseUrl, onSessionCleared, setActiveTenantId, refreshAccessToken } from '../src/api/client';
jest.mock('../src/api/storage', () => ({ secureStorage: { setItem: jest.fn(async () => {}), removeItem: jest.fn(async () => {}), getItem: jest.fn(async () => null) } }));
const reply = (data: unknown, status = 200) => ({ status, ok: status < 400, headers: { get: () => 'application/json' }, json: async () => data }) as unknown as Response;
const refresh = 'header.' + btoa(JSON.stringify({ exp: 9999999999 })) + '.signature';
describe('Session refresh and stale responses', () => {
  afterEach(async () => { jest.restoreAllMocks(); await clearTokens(); });
  test('a queued financial callback cannot adopt a new account with the same store id', async () => {
    const token = (user: number) => 'header.' + btoa(JSON.stringify({ user_id: user, exp: 9999999999 })) + '.signature';
    await setTokens(token(1), refresh); await setActiveTenantId('7');
    const original = captureAuthScope(1, 7); expect(() => assertAuthScope(original)).not.toThrow();
    await setTokens(token(2), refresh); await setActiveTenantId('7');
    expect(() => assertAuthScope(original)).toThrow('Sessiya yoki do‘kon');
    expect(() => assertAuthScope(captureAuthScope(1, 7))).toThrow('Sessiya yoki do‘kon');
    expect(() => assertAuthScope(captureAuthScope(2, 8))).toThrow('Sessiya yoki do‘kon');
    expect(() => assertAuthScope(captureAuthScope(2, 7))).not.toThrow();
  });
  test('public support metadata and guest requests exclude an existing account and tenant', async () => {
    await setTokens('existing-private-access', refresh); await setActiveTenantId('7');
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(reply({ results: [] }));
    await request('/support/metadata/', { skipTenant: true });
    await request('/support/guest/', { skipTenant: true, headers: { 'X-Support-Token': 'a'.repeat(64) } });
    for (const [, options] of fetchSpy.mock.calls) { expect(new Headers(options?.headers).get('Authorization')).toBeNull(); expect(new Headers(options?.headers).get('X-Tenant-ID')).toBeNull(); }
    expect(new Headers(fetchSpy.mock.calls[1][1]?.headers).get('X-Support-Token')).toBe('a'.repeat(64));
    expect(getAccessToken()).toBe('existing-private-access');
  });
  test('a private support header bound to the old server is rejected before any new-origin request', async () => {
    const original = getApiBaseUrl(), fetchSpy = jest.spyOn(globalThis, 'fetch');
    await setApiBaseUrl('https://support-other.invalid/api/v1');
    await expect(request('/support/guest/', { skipTenant: true, expectedServerScope: original, headers: { 'X-Support-Token': 'a'.repeat(64) } })).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(fetchSpy).not.toHaveBeenCalled();
    await setApiBaseUrl(original);
  });
  test('guest support rejection does not refresh or clear a separate signed-in session', async () => {
    await setTokens('account-access', refresh);
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(reply({ detail: 'Guest key rejected' }, 401));
    await expect(request('/support/guest/', { skipTenant: true, headers: { 'X-Support-Token': 'a'.repeat(64) } })).rejects.toMatchObject({ status: 401 });
    expect(fetchSpy).toHaveBeenCalledTimes(1); expect(getAccessToken()).toBe('account-access');
  });
  test('refresh can retry its own request without invalidating the session', async () => {
    await setTokens('expired-access', refresh);
    const generation = getAuthGeneration();
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(reply({}, 401)).mockResolvedValueOnce(reply({ access: 'new-access' })).mockResolvedValueOnce(reply({ id: 7 }));
    expect(await request('/sales/')).toEqual({ id: 7 });
    expect(getAuthGeneration()).toBe(generation);
    expect(getAccessToken()).toBe('new-access');
    expect(new Headers(fetchSpy.mock.calls[2][1]?.headers).get('Authorization')).toBe('Bearer new-access');
  });
  test('an old 401 response cannot log out a newly signed-in account', async () => {
    await setTokens('account-a', refresh);
    let respond!: (response: Response) => void;
    jest.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise(resolve => { respond = resolve; }));
    const result = request('/sales/');
    const rejected = expect(result).rejects.toThrow('Sessiya o‘zgargan');
    await setTokens('account-b', refresh);
    respond(reply({}, 401));
    await rejected;
    expect(getAccessToken()).toBe('account-b');
  });
  test('a failed POST remains a failure rather than a manufactured receipt', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(reply({ detail: 'Insufficient stock' }, 400));
    await expect(request('/sales/', { method: 'POST', body: { items: [] } })).rejects.toThrow('Insufficient stock');
  });
  test('binary responses preserve the actual file bytes', async () => {
    const binary = new Blob(['%PDF-synthetic'], { type: 'application/pdf' });
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ...reply(null), blob: async () => binary } as unknown as Response);
    expect(await request('/export/', { responseType: 'blob' })).toBe(binary);
  });
  test('explicit text response is not coerced into JSON', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ...reply(null), text: async () => '{literal}' } as unknown as Response);
    expect(await request('/document/', { responseType: 'text' })).toBe('{literal}');
  });
  test('changing server removes the old authorization before the next request', async () => {
    const original = getApiBaseUrl();
    await setTokens('origin-a-access', refresh);
    await setApiBaseUrl('https://other.invalid/api/v1');
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(reply({ id: 1 }));
    await request('/probe/');
    expect(new Headers(fetchSpy.mock.calls[0][1]?.headers).get('Authorization')).toBeNull();
    expect(getAccessToken()).toBeNull();
    await setApiBaseUrl(original);
  });
  test('an invalid endpoint does not change or clear a valid session', async () => {
    await setTokens('current-access', refresh);
    await expect(setApiBaseUrl('https://user:password@other.invalid/api/v1')).rejects.toThrow();
    expect(getAccessToken()).toBe('current-access');
  });
  test('a rejected refresh retains HTTP status and notifies the session UI', async () => {
    await setTokens('current-access', refresh);
    const listener = jest.fn(), stop = onSessionCleared(listener);
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(reply({ detail: 'Revoked' }, 401));
    await expect(refreshAccessToken()).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledTimes(1); stop();
  });
  test('a stalled request has a deadline and an uncertain outcome rather than success', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation((_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(Error('aborted')))));
    await expect(request('/sales/', { method: 'POST', body: {}, timeoutMs: 10 })).rejects.toMatchObject({ code: 'TIMEOUT', status: 0 });
  });
  test('rate limit data is retained for retry UX', async () => {
    const response = reply({ detail: 'Wait', retry_after_seconds: 30 }, 429);
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ...response, headers: new Headers({ 'content-type': 'application/json', 'Retry-After': '30' }) } as Response);
    await expect(request('/auth/admin-login/', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 429, retryAfterMs: 30000 });
  });
});
