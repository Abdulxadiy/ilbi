import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { refreshAccessToken, request, getAccessToken, getRefreshToken, setTokens, clearTokens, inventoryApi, catalogApi } from '../src/api/client.js';
import { getOrCreateRequestKey } from '../src/utils/requestKey.js';

class Storage {
  data = new Map();
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}
const token = (user = 1, expires = Date.now() / 1000 + 3600) => `test.${Buffer.from(JSON.stringify({ user_id: user, exp: expires })).toString('base64url')}.test`;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  globalThis.localStorage = new Storage();
  globalThis.sessionStorage = new Storage();
  globalThis.window = new EventTarget();
  globalThis.CustomEvent = class extends Event { constructor(name, options) { super(name); this.detail = options?.detail; } };
  globalThis.crypto ??= webcrypto;
});

test('desktop online writes and refresh stay in the cloud; enrolled offline tokens stay local', async () => {
  window.ilbiDesktop = { version: 'qa' };
  for (const offline of [false, true]) {
    const value = `test.${Buffer.from(JSON.stringify({ user_id: 1, exp: Date.now()/1000+3600, ...(offline ? {desktop_device:'qa'} : {}) })).toString('base64url')}.test`;
    setTokens(value, value);
    let writes = 0, refreshes = 0;
    globalThis.fetch = async (url, options) => {
      assert.equal(options.headers['X-ILBI-Cloud-Session'], offline ? undefined : 'true');
      if (url.endsWith('/auth/token/refresh/')) { refreshes++; return json({access:value}); }
      assert.equal(options.method, 'POST'); writes++; return json({id:71});
    };
    await request('/catalog/categories/', {method:'POST',body:{name:'Synthetic'}});
    await refreshAccessToken();
    assert.equal(writes, 1); assert.equal(refreshes, 1);
  }
});

test('Excel requests return binary data and keep structured server errors', async () => {
  setTokens(token(), token());
  globalThis.fetch = async () => new Response(new Uint8Array([80, 75, 3, 4]), {
    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  });
  const blob = await request('/inventory/stock/export/', { responseType: 'blob' });
  assert.ok(blob instanceof Blob);
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [80, 75, 3, 4]);
  globalThis.fetch = async () => json({ detail: 'Export denied' }, 403);
  await assert.rejects(request('/inventory/stock/export/', { responseType: 'blob' }), /Export denied/);
});

test('inventory filtering and export can load the entire stock list', async () => {
  setTokens(token(), token());
  const rows = Array.from({ length: 28 }, (_, index) => ({ id: index + 1 }));
  globalThis.fetch = async url => {
    assert.equal(url, '/api/v1/inventory/stock/');
    return json(rows);
  };
  assert.equal((await inventoryApi.getStock({})).length, 28);
});

test('expired access refreshes without losing the valid refresh token', async () => {
  const refresh = token();
  setTokens(token(1, 1), refresh);
  const access = token(1, Date.now() / 1000 + 7200);
  globalThis.fetch = async () => json({ access });
  assert.equal(await refreshAccessToken(), access);
  assert.equal(getAccessToken(), access);
  assert.equal(getRefreshToken(), refresh);
});

test('parallel callers share one refresh request', async () => {
  setTokens(token(1, 1), token());
  let count = 0;
  let complete;
  globalThis.fetch = () => { count += 1; return new Promise((resolve) => { complete = resolve; }); };
  const first = refreshAccessToken();
  const second = refreshAccessToken();
  assert.equal(count, 1);
  const access = token();
  complete(json({ access }));
  assert.deepEqual(await Promise.all([first, second]), [access, access]);
});

test('network failure preserves tokens for a later retry', async () => {
  const refresh = token();
  setTokens(token(1, 1), refresh);
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  await assert.rejects(refreshAccessToken(), /offline/);
  assert.equal(getRefreshToken(), refresh);
});

test('a rejected refresh logs out once', async () => {
  setTokens(token(1, 1), token());
  let count = 0;
  window.addEventListener('auth:logout', () => { count += 1; });
  globalThis.fetch = async () => json({ detail: 'revoked' }, 401);
  await assert.rejects(refreshAccessToken(), /revoked/);
  assert.equal(getRefreshToken(), null);
  assert.equal(count, 1);
});

test('an old refresh rejection cannot log out a newly logged in account', async () => {
  setTokens(token(1, 1), token(1));
  let complete;
  globalThis.fetch = () => new Promise((resolve) => { complete = resolve; });
  const pending = refreshAccessToken();
  const next = token(2);
  setTokens(next, next);
  complete(json({ detail: 'revoked' }, 401));
  await assert.rejects(pending);
  assert.equal(getRefreshToken(), next);
});

test('authenticated requests retry once, retaining the selected tenant', async () => {
  const expired = token(1, 1);
  const access = token();
  setTokens(expired, token());
  localStorage.setItem('ilbi_active_tenant:1', '12');
  let count = 0;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/token/refresh/')) return json({ access });
    count += 1;
    assert.equal(options.headers['X-Tenant-ID'], '12');
    if (count === 1) return json({ detail: 'expired' }, 401);
    assert.equal(options.headers.Authorization, `Bearer ${access}`);
    return json([{ id: 7 }]);
  };
  assert.deepEqual(await request('/sales/'), [{ id: 7 }]);
  assert.equal(count, 2);
});

test('public login requests omit expired authorization', async () => {
  setTokens(token(1, 1), token());
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.Authorization, undefined);
    return json({ login_ticket: 'ticket' });
  };
  assert.deepEqual(await request('/auth/admin-login/', { method: 'POST', body: {} }), { login_ticket: 'ticket' });
});

test('failed requests cannot retain echoed credentials in Error message, stack or nested data', async () => {
  const password = 'Synthetic entered password!42';
  globalThis.fetch = async (_url, options) => {
    assert.equal(JSON.parse(options.body).password, password);
    return json({ error: { code: 'validation_error', message: `Rejected ‹${password}›`, details: { password: [`Rejected ${password}`], amount: ['12345.67'] } }, token: 'private-response-token' }, 400);
  };
  await assert.rejects(request('/auth/admin-login/', { method: 'POST', body: { username: 'owner', password } }), error => {
    for (const text of [error.message, error.stack, JSON.stringify(error.data)]) {
      assert(!text.includes(password)); assert(!text.includes('private-response-token'));
    }
    assert.equal(error.data.error.details.amount[0], '12345.67');
    return true;
  });
});

test('request presentation protection leaves successful credentials and payload bytes untouched', async () => {
  const body = { username: 'owner', password: 'Synthetic entered password!42' };
  const response = { access: 'synthetic-access', refresh: 'synthetic-refresh', login_ticket: 'synthetic-ticket' };
  globalThis.fetch = async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), body);
    return json(response);
  };
  assert.deepEqual(await request('/auth/admin-login/', { method: 'POST', body }), response);
  assert.equal(body.password, 'Synthetic entered password!42');
});

test('a private response arriving after logout is discarded', async () => {
  setTokens(token(), token());
  let finish;
  globalThis.fetch = () => new Promise(resolve => { finish = resolve; });
  const pending = request('/support/conversations/');
  clearTokens();
  finish(json({ results: [{ text: 'old private history' }] }));
  await assert.rejects(pending, /Sessiya o‘zgargan/);
});

test('logging back into the same user cannot reuse an earlier private response', async () => {
  setTokens(token(), token());
  let finish;
  globalThis.fetch = () => new Promise(resolve => { finish = resolve; });
  const pending = request('/auth/me/');
  clearTokens();
  setTokens(token(), token());
  finish(json({ id: 1, role: 'platform_admin' }));
  await assert.rejects(pending, /Sessiya o‘zgargan/);
});

test('a new login does not join the previous session refresh', async () => {
  setTokens(token(1, 1), token(1));
  const completions = [];
  globalThis.fetch = () => new Promise(resolve => completions.push(resolve));
  const old = refreshAccessToken();
  clearTokens();
  setTokens(token(2, 1), token(2));
  const current = refreshAccessToken();
  assert.equal(completions.length, 2);
  completions[0](json({ access: token(1) }));
  await assert.rejects(old, /Sessiya o‘zgargan/);
  completions[1](json({ access: token(2) }));
  assert.equal(await current, getAccessToken());
});

test('a late retry rejection cannot clear the next session for the same account', async () => {
  const valid = token();
  setTokens(token(1, 1), valid);
  let finishRetry;
  let attempt = 0;
  globalThis.fetch = async url => {
    if (url.endsWith('/token/refresh/')) return json({ access: valid });
    if (++attempt === 1) return json({ detail: 'expired' }, 401);
    return new Promise(resolve => { finishRetry = resolve; });
  };
  const pending = request('/auth/me/');
  while (!finishRetry) await new Promise(resolve => setImmediate(resolve));
  clearTokens();
  setTokens(valid, valid);
  finishRetry(json({ detail: 'revoked old request' }, 401));
  await assert.rejects(pending, /Sessiya o‘zgargan/);
  assert.equal(getAccessToken(), valid);
});

test('tenant selection follows the current token rather than a stale profile cache', async () => {
  setTokens(token(2), token(2));
  localStorage.setItem('ilbi_user', JSON.stringify({ id: 1 }));
  localStorage.setItem('ilbi_active_tenant:1', '111');
  localStorage.setItem('ilbi_active_tenant:2', '222');
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers['X-Tenant-ID'], '222');
    return json([]);
  };
  await request('/sales/');
});

test('financial request key survives retries and regenerates when the payload changes', () => {
  const data = { amount: '100', payment_type: 'cash' };
  const key = getOrCreateRequestKey('tenant:1:checkout', data);
  assert.equal(getOrCreateRequestKey('tenant:1:checkout', { ...data }), key);
  assert.notEqual(getOrCreateRequestKey('tenant:1:checkout', { ...data, amount: '200' }), key);
  assert.notEqual(getOrCreateRequestKey('tenant:2:checkout', data), key);
});


test('support can omit an obsolete tenant selection while retaining account authentication', async () => {
  const access = token();
  setTokens(access, token());
  localStorage.setItem('ilbi_active_tenant:1', '999');
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers['X-Tenant-ID'], undefined);
    assert.equal(options.headers.Authorization, `Bearer ${access}`);
    return json({ results: [] });
  };
  assert.deepEqual(await request('/support/conversations/', { skipTenant: true }), { results: [] });
});


test('list requests retain server pagination, filters, cart ids and cancellation', async () => {
  setTokens(token(), token());
  const controller = new AbortController();
  const seen = [];
  globalThis.fetch = async (url, options) => {
    seen.push(new URL(url, 'http://localhost'));
    assert.equal(options.signal, controller.signal);
    return json({ results: [], count: 0 });
  };
  await catalogApi.getVariants({ page: 3, page_size: 20, search: 'Cola', category: 7 }, { signal: controller.signal });
  await inventoryApi.getStock({ page: 2, page_size: 25, sort: 'qty_desc', category: 7 }, { signal: controller.signal });
  await inventoryApi.getMovements({ page: 4, page_size: 25, date: 'today', type: 'kirim' }, { signal: controller.signal });
  await catalogApi.getVariants({ ids: '1,77' }, { signal: controller.signal });
  assert.equal(seen[0].searchParams.get('page'), '3');
  assert.equal(seen[0].searchParams.get('page_size'), '20');
  assert.equal(seen[0].searchParams.get('search'), 'Cola');
  assert.equal(seen[1].searchParams.get('sort'), 'qty_desc');
  assert.equal(seen[1].searchParams.get('page_size'), '25');
  assert.equal(seen[2].searchParams.get('page'), '4');
  assert.equal(seen[2].searchParams.get('date'), 'today');
  assert.equal(seen[2].searchParams.get('type'), 'kirim');
  assert.equal(seen[3].searchParams.get('ids'), '1,77');
});
