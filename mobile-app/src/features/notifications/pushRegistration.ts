import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { assertAuthScope, request } from '../../api/client';
import { getApiBaseUrl, normalizeApiBaseUrl } from '../../api/environment';
import { secureStorage } from '../../api/storage';

export type PushCategories = Record<'b2b' | 'debts' | 'stock' | 'reports' | 'system', boolean>;
export const defaultPushCategories: PushCategories = { b2b: true, debts: true, stock: true, reports: true, system: true };
type Identity = { id: string; secret: string; enabledForUser: number | null; registrationIntent: boolean; pendingRevoke: boolean; categories: PushCategories };
const key = (server: string) => 'ilbi_push_identity_' + [...server].map(c => c.codePointAt(0)!.toString(16)).join('_');
const indexKey = 'ilbi_push_pending_servers_v1';
let storageWrites: Promise<unknown> = Promise.resolve();
const operations = new Map<string, Promise<unknown>>();
const serialStorage = <T,>(task: () => Promise<T>) => { const next = storageWrites.catch(() => {}).then(task); storageWrites = next; return next; };
const serialize = <T,>(server: string, task: () => Promise<T>) => { const next = (operations.get(server) || Promise.resolve()).catch(() => {}).then(task); operations.set(server, next); return next; };

async function read(server: string): Promise<Identity | null> {
  const raw = await secureStorage.getItem(key(server));
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (!/^[a-f0-9-]{36}$/.test(value.id) || !/^[a-f0-9]{64}$/.test(value.secret)) throw Error('Qurilma identity’sini xavfsiz ombordan o‘qib bo‘lmadi.');
  return value;
}
async function change(server: string, update: (value: Identity | null) => Identity) {
  return serialStorage(async () => { const result = update(await read(server)); await secureStorage.setItem(key(server), JSON.stringify(result)); return result; });
}
async function pendingServer(server: string, pending: boolean) {
  return serialStorage(async () => {
    const servers = JSON.parse(await secureStorage.getItem(indexKey) || '[]') as string[];
    const next = servers.filter(value => value !== server);
    if (pending) next.push(server);
    await secureStorage.setItem(indexKey, JSON.stringify(next.slice(-8)));
  });
}
async function identity(server: string) {
  return change(server, previous => previous || { id: Crypto.randomUUID(), secret: Crypto.randomUUID().replaceAll('-', '') + Crypto.randomUUID().replaceAll('-', ''), enabledForUser: null, registrationIntent: false, pendingRevoke: false, categories: { ...defaultPushCategories } });
}
async function revoke(server: string) {
  const value = await read(server);
  if (!value?.pendingRevoke) return;
  // No JWT/cookies: the installation secret only authorizes deactivation.
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
  let response: Response;
  try { response = await fetch(normalizeApiBaseUrl(server) + '/auth/push/revoke/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', redirect: 'error', body: JSON.stringify({ installation_id: value.id, revoke_secret: value.secret }), signal: controller.signal }); }
  finally { clearTimeout(timer); }
  if (!response.ok) throw Error('Telefon bildirishnomalarini serverda o‘chirish kutilmoqda.');
  await change(server, current => ({ ...current!, pendingRevoke: false, registrationIntent: false, enabledForUser: null }));
  await pendingServer(server, false);
}

export async function pushInstallationState(server = getApiBaseUrl()) { return read(server); }

export async function registerPushToken(userId: number, token: string, categories: PushCategories, scope: Parameters<typeof assertAuthScope>[0], server = getApiBaseUrl()) {
  return serialize(server, async () => {
    assertAuthScope(scope);
    await identity(server);
    await revoke(server);
    assertAuthScope(scope);
    // Persist intent first so logout can revoke even if the registration reply is lost.
    const value = await change(server, current => ({ ...current!, registrationIntent: true }));
    const response = await request('/auth/push/installations/', { method: 'POST', skipTenant: true, expectedServerScope: server, body: { installation_id: value.id, revoke_secret: value.secret, token, platform: 'android', application_id: 'uz.ilbi.mobile', categories } });
    assertAuthScope(scope);
    if (response?.registered !== true || response.installation_id !== value.id || typeof response.delivery_enabled !== 'boolean') throw Error('Server qurilma ro‘yxatini tasdiqlamadi.');
    await change(server, current => ({ ...current!, enabledForUser: current!.pendingRevoke ? null : userId, categories }));
    return response.delivery_enabled;
  });
}

/** Always permits local logout; durable cleanup survives a cleared/expired JWT. */
export async function revokePushInstallation(server = getApiBaseUrl()) {
  if (Platform.OS !== 'android') return true;
  try {
    const previous = await read(server);
    if (!previous || !previous.registrationIntent && !previous.pendingRevoke) return true;
    await change(server, current => ({ ...current!, enabledForUser: null, pendingRevoke: true }));
    await pendingServer(server, true);
    const operation = serialize(server, () => revoke(server)).catch(() => {});
    // An in-flight registration is drained before revocation, but cannot hold
    // secure local logout indefinitely. Pending intent is already durable.
    await new Promise<void>(resolve => { const timer = setTimeout(resolve, 1200); void operation.finally(() => { clearTimeout(timer); resolve(); }); });
    return !(await read(server))?.pendingRevoke;
  } catch { return false; /* Local logout remains available; payloads contain no private content. */ }
}

export async function retryPushRevocations() {
  if (Platform.OS !== 'android') return;
  const servers = JSON.parse(await secureStorage.getItem(indexKey) || '[]') as string[];
  await Promise.allSettled(servers.slice(0, 8).map(server => serialize(server, () => revoke(server))));
}
