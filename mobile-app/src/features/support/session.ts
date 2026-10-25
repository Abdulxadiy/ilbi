import * as Crypto from 'expo-crypto';
import { assertAuthScope, captureAuthScope, request, ApiError, type RequestOptions } from '../../api/client';
import { getServerScope } from '../../api/environment';
import { secureStorage } from '../../api/storage';
import { isUuid } from './model';
export type GuestIdentity = { token: string; id: string; origin: string };
const guestLoads = new Map<string, Promise<GuestIdentity>>();
const guestKey = (origin: string) => 'ilbi_support_guest_' + Array.from(origin, letter => letter.charCodeAt(0).toString(16).padStart(4, '0')).join('');
/** Publish a guest key only after protected storage acknowledges it; never put it into URLs/logs. */
export function loadGuestIdentity(origin = getServerScope()): Promise<GuestIdentity> {
  const key = guestKey(origin), existing = guestLoads.get(key);
  if (existing) return existing;
  const load = (async () => {
    const saved = await secureStorage.getItem(key);
    if (saved) { const data = JSON.parse(saved); if (!/^[a-f0-9]{64}$/.test(data.token || '') || !isUuid(data.id) || data.origin && data.origin !== origin) throw Error('Mehmon yordam seansi tasdiqlanmadi.'); const identity = { token: data.token, id: data.id, origin }; if (!data.origin) await secureStorage.setItem(key, JSON.stringify(identity)); return identity; }
    const bytes = await Crypto.getRandomBytesAsync(32);
    const data = { origin, token: Array.from(bytes, value => value.toString(16).padStart(2, '0')).join(''), id: Crypto.randomUUID() };
    await secureStorage.setItem(key, JSON.stringify(data)); return data;
  })().catch(error => { guestLoads.delete(key); throw error; });
  guestLoads.set(key, load); return load;
}
export interface SupportSession {
  key: string; root: string; userId: number | null; operator: boolean; tenantId: number | null;
  options: { skipTenant: true; expectedServerScope: string; headers: Record<string, string> };
  call<T = any>(path?: string, options?: RequestOptions): Promise<T>;
}
export function createSupportSession({ userId, tenantId = null, guest, operator = false, origin = getServerScope() }: { userId: number | null; tenantId?: number | null; guest?: GuestIdentity; operator?: boolean; origin?: string }): SupportSession {
  if (!userId && !guest) throw Error('Yordam seansi tayyor emas.');
  if (!userId && guest?.origin !== origin) throw new ApiError('Mehmon seansi boshqa serverga tegishli.', 0, null, 0, 'SESSION_CHANGED');
  const root = '/support/' + (userId ? operator ? 'inbox' : 'conversations' : 'guest') + '/';
  const options = { expectedServerScope: origin, skipTenant: true as const, headers: guest && !userId ? { 'X-Support-Token': guest.token } : {} as Record<string, string> };
  return { key: [origin, userId || 'guest:' + guest!.id, tenantId, operator].join('|'), root, userId, tenantId, operator, options,
    async call<T>(path = '', extra: RequestOptions = {}) {
      if (getServerScope() !== origin) throw new ApiError('Yordam serveri o‘zgargan.', 0, null, 0, 'SESSION_CHANGED');
      const scope = captureAuthScope();
      const headers = new Headers(options.headers); new Headers(extra.headers).forEach((value, key) => headers.set(key, value));
      const result = await request<T>(root + path, { ...extra, expectedServerScope: origin, skipTenant: true, headers }); assertAuthScope(scope); return result;
    },
  };
}
