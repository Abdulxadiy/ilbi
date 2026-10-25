import { resourceChanged } from './invalidation';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { secureStorage } from './storage';
import { isDesignPreview, previewRequest } from '../dev/preview';
import { commitApiBaseUrl, getApiBaseUrl, getServerScope, normalizeApiBaseUrl } from './environment';
import { ApiError, errorMessage } from './errors';
export { getApiBaseUrl } from './environment';
export { ApiError } from './errors';

type StoredSession = { origin: string; access: string | null; refresh: string | null; tenantId: string | null };
let accessToken: string | null = null, refreshToken: string | null = null, activeTenantId: string | null = null;
let authGeneration = 0;
let writes: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();
const sessionKey = (origin = getServerScope()) => 'ilbi_session_' + [...origin].map(char => char.codePointAt(0)!.toString(16).padStart(6, '0')).join('');
const revokedKey = (origin = getServerScope()) => 'ilbi_session_revoked:' + origin;
const serializeWrite = <T,>(operation: () => Promise<T>): Promise<T> => {
  const pending = writes.catch(() => {}).then(operation); writes = pending; return pending;
};
const record = (): StoredSession => ({ origin: getServerScope(), access: accessToken, refresh: refreshToken, tenantId: activeTenantId });
export const getAuthGeneration = () => authGeneration;
export const invalidateAuth = () => { authGeneration += 1; };
export const onSessionCleared = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getAccessToken = () => accessToken;
export const getRefreshToken = () => refreshToken;
export const getActiveTenantId = () => activeTenantId;
export const captureAuthScope = () => ({ generation: authGeneration, server: getServerScope(), tenantId: activeTenantId });
export function assertAuthScope(scope: ReturnType<typeof captureAuthScope>) {
  if (scope.generation !== authGeneration || scope.server !== getServerScope() || scope.tenantId !== activeTenantId) throw new ApiError('Sessiya yoki do‘kon o‘zgardi. Amalni qayta boshlang.', 0, null, 0, 'SESSION_CHANGED');
}

export async function clearTokens() {
  const origin = getServerScope();
  accessToken = refreshToken = activeTenantId = null; invalidateAuth();
  for (const listener of listeners) listener();
  await serializeWrite(async () => {
    // A non-secret revocation marker prevents a failed keychain delete resurrecting a session.
    await AsyncStorage.setItem(revokedKey(origin), '1');
    await secureStorage.removeItem(sessionKey(origin));
  });
}
export async function setTokens(access: string | null, refresh: string | null, preserveSession = false) {
  if (!access && !refresh) return clearTokens();
  if (typeof access !== 'string' || !access || typeof refresh !== 'string' || !refresh) throw new ApiError('Server kirish ma’lumotlarini tasdiqlamadi.', 502);
  if (!preserveSession) invalidateAuth();
  const generation = authGeneration, origin = getServerScope();
  const next: StoredSession = { origin, access, refresh, tenantId: preserveSession ? activeTenantId : null };
  await serializeWrite(async () => {
    if (generation !== authGeneration || origin !== getServerScope()) throw new ApiError('Sessiya o‘zgargan.', 0, null, 0, 'SESSION_CHANGED');
    await secureStorage.setItem(sessionKey(origin), JSON.stringify(next));
    await AsyncStorage.removeItem(revokedKey(origin));
  });
  if (generation !== authGeneration) throw new ApiError('Sessiya o‘zgargan.', 0, null, 0, 'SESSION_CHANGED');
  accessToken = next.access; refreshToken = next.refresh; activeTenantId = next.tenantId;
}
export async function setActiveTenantId(tenantId: string | null) {
  if (tenantId === activeTenantId) return;
  invalidateAuth();
  const generation = authGeneration, next = { ...record(), tenantId };
  await serializeWrite(async () => {
    if (generation !== authGeneration) throw new ApiError('Sessiya o‘zgargan.', 0, null, 0, 'SESSION_CHANGED');
    if (next.access) await secureStorage.setItem(sessionKey(), JSON.stringify(next));
  });
  if (generation !== authGeneration) throw new ApiError('Sessiya o‘zgargan.', 0, null, 0, 'SESSION_CHANGED');
  activeTenantId = tenantId;
}
export async function initializeAuthFromStorage() {
  await writes.catch(() => {});
  const origin = getServerScope(), generation = authGeneration;
  if (await AsyncStorage.getItem(revokedKey(origin))) return { accessToken: null, refreshToken: null, activeTenantId: null };
  const raw = await secureStorage.getItem(sessionKey(origin));
  if (generation !== authGeneration) throw new ApiError('Sessiya o‘zgargan.', 0, null, 0, 'SESSION_CHANGED');
  if (raw) {
    const saved: StoredSession = JSON.parse(raw);
    if (saved.origin !== origin || typeof saved.access !== 'string' || typeof saved.refresh !== 'string') throw new ApiError('Saqlangan sessiya tasdiqlanmadi. Qayta kiring.');
    accessToken = saved.access; refreshToken = saved.refresh; activeTenantId = saved.tenantId;
  }
  // Legacy unscoped credentials are intentionally not assigned to an unknown server.
  return { accessToken, refreshToken, activeTenantId };
}
export async function setApiBaseUrl(value: string) {
  const normalized = normalizeApiBaseUrl(value);
  if (normalized === getApiBaseUrl()) return;
  await clearTokens();
  commitApiBaseUrl(normalized);
}
export function parseJwt(token: string | null): any {
  try {
    if (!token) return null;
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent([...atob(base64)].map(char => '%' + char.charCodeAt(0).toString(16).padStart(2, '0')).join('')));
  } catch { return null; }
}
export const isTokenExpired = (token: string | null) => !parseJwt(token)?.exp || parseJwt(token).exp * 1000 <= Date.now();

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: any;
  skipTenant?: boolean;
  responseType?: 'json' | 'blob' | 'text';
  timeoutMs?: number;
  _retry?: boolean;
}
async function transport(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  catch (error) {
    if (timedOut) throw new ApiError('Server javobi kutilmoqda. Natijani tekshiring, keyin qayta urinib ko‘ring.', 0, null, 0, 'TIMEOUT');
    if (options.signal?.aborted) throw error;
    throw new ApiError('Internet yoki server bilan aloqa uzildi. Amal natijasini tekshiring.', 0, null, 0, 'NETWORK');
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
let refreshOperation: { generation: number; promise: Promise<string> } | null = null;
export async function refreshAccessToken(): Promise<string> {
  const generation = authGeneration, currentRefresh = refreshToken;
  if (refreshOperation?.generation === generation) return refreshOperation.promise;
  if (!currentRefresh || isTokenExpired(currentRefresh)) {
    await clearTokens(); throw new ApiError('Sessiya muddati tugadi. Qayta kiring.', 401);
  }
  const operation = { generation, promise: (async () => {
    const response = await transport(getApiBaseUrl() + '/auth/token/refresh/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh: currentRefresh }) }, 15000);
    const data = await response.json().catch(() => null);
    if (generation !== authGeneration) throw new ApiError('Sessiya o‘zgargan.', 0, null, 0, 'SESSION_CHANGED');
    if (!response.ok) {
      if (response.status === 401) await clearTokens();
      throw new ApiError(errorMessage(data, 'Token yangilanmadi.'), response.status, data, Number(response.headers.get('Retry-After') || 0) * 1000);
    }
    await setTokens(data?.access, data?.refresh || currentRefresh, true);
    return data.access as string;
  })().finally(() => { if (refreshOperation === operation) refreshOperation = null; }) };
  refreshOperation = operation; return operation.promise;
}
export async function request<T = any>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  if (!endpoint.startsWith('/') || endpoint.startsWith('//')) throw new ApiError('API yo‘li noto‘g‘ri.');
  if (isDesignPreview) { const result = await previewRequest(endpoint, options); if (!['GET', 'HEAD', 'OPTIONS'].includes((options.method || 'GET').toUpperCase())) resourceChanged(endpoint); return result as T; }
  const generation = authGeneration;
  const assertCurrent = () => { if (generation !== authGeneration) throw new ApiError('Sessiya o‘zgargan. Amalni qayta boshlang.', 0, null, 0, 'SESSION_CHANGED'); };
  const { body: inputBody, skipTenant, responseType, timeoutMs = 20000, _retry, ...init } = options;
  const form = typeof FormData !== 'undefined' && inputBody instanceof FormData;
  const headers = new Headers(init.headers);
  if (!form && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (activeTenantId && !skipTenant && !endpoint.startsWith('/auth/') && !endpoint.startsWith('/tenants/my/') && !endpoint.startsWith('/platform/')) headers.set('X-Tenant-ID', activeTenantId);
  const publicAuth = /^\/(auth\/(admin-login|token|password-reset)|sales\/public\/|support\/(guest|metadata)\/)/.test(endpoint);
  if (accessToken && !publicAuth && !headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + accessToken);
  const body = inputBody && !form && typeof inputBody === 'object' ? JSON.stringify(inputBody) : inputBody;
  const url = getApiBaseUrl() + endpoint;
  let response = await transport(url, { ...init, headers, body }, timeoutMs); assertCurrent();
  if (response.status === 401 && !_retry && !publicAuth) {
    const access = await refreshAccessToken(); assertCurrent(); headers.set('Authorization', 'Bearer ' + access);
    response = await transport(url, { ...init, headers, body }, timeoutMs); assertCurrent();
    if (response.status === 401) await clearTokens();
  }
  if (response.status === 204) { if (!['GET', 'HEAD', 'OPTIONS'].includes((options.method || 'GET').toUpperCase())) resourceChanged(endpoint); return null as T; }
  if (response.ok && responseType === 'blob') { const value = await response.blob(); assertCurrent(); return value as T; }
  if (response.ok && responseType === 'text') { const value = await response.text(); assertCurrent(); return value as T; }
  const json = (response.headers.get('content-type') || '').includes('json');
  const data = json ? await response.json() : await response.text();
  if (response.status !== 401) assertCurrent();
  if (!response.ok) throw new ApiError(errorMessage(data), response.status, data, Number(response.headers.get('Retry-After') || data?.retry_after_seconds || 0) * 1000);
  if (!['GET', 'HEAD', 'OPTIONS'].includes((options.method || 'GET').toUpperCase())) resourceChanged(endpoint);
  return data as T;
}
