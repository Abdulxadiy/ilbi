import * as Crypto from 'expo-crypto';
import { assertAuthScope, captureAuthScope, request, type RequestOptions } from '../../api/client';
import { getServerScope } from '../../api/environment';
import { secureStorage } from '../../api/storage';
import { isUuid } from './model';
export type GuestIdentity = { token: string; id: string };
const guestLoads = new Map<string, Promise<GuestIdentity>>();
const guestKey = (origin: string) => 'ilbi_support_guest_' + Array.from(origin, letter => letter.charCodeAt(0).toString(16).padStart(4, '0')).join('');
/** Publish a guest key only after protected storage acknowledges it; never put it into URLs/logs. */
export function loadGuestIdentity(origin = getServerScope()): Promise<GuestIdentity> {
  const key = guestKey(origin), existing = guestLoads.get(key);
  if (existing) return existing;
  const load = (async () => {
    const saved = await secureStorage.getItem(key);
    if (saved) { const data = JSON.parse(saved); if (!/^[a-f0-9]{64}$/.test(data.token || '') || !isUuid(data.id)) throw Error('Mehmon yordam seansi tasdiqlanmadi.'); return data as GuestIdentity; }
    const bytes = await Crypto.getRandomBytesAsync(32);
    const data = { token: Array.from(bytes, value => value.toString(16).padStart(2, '0')).join(''), id: Crypto.randomUUID() };
    await secureStorage.setItem(key, JSON.stringify(data)); return data;
  })().catch(error => { guestLoads.delete(key); throw error; });
  guestLoads.set(key, load); return load;
}
export interface SupportSession {
  key: string; root: string; userId: number | null; operator: boolean; tenantId: number | null;
  options: { skipTenant: true; headers: Record<string, string> };
  call<T = any>(path?: string, options?: RequestOptions): Promise<T>;
}
export function createSupportSession({ userId, tenantId = null, guest, operator = false }: { userId: number | null; tenantId?: number | null; guest?: GuestIdentity; operator?: boolean }): SupportSession {
  if (!userId && !guest) throw Error('Yordam seansi tayyor emas.');
  const root = '/support/' + (userId ? operator ? 'inbox' : 'conversations' : 'guest') + '/';
  const options = { skipTenant: true as const, headers: guest && !userId ? { 'X-Support-Token': guest.token } : {} as Record<string, string> };
  return { key: [getServerScope(), userId || 'guest:' + guest!.id, tenantId, operator].join('|'), root, userId, tenantId, operator, options,
    async call<T>(path = '', extra: RequestOptions = {}) {
      const scope = captureAuthScope();
      const headers = new Headers(options.headers); new Headers(extra.headers).forEach((value, key) => headers.set(key, value));
      const result = await request<T>(root + path, { ...extra, skipTenant: true, headers }); assertAuthScope(scope); return result;
    },
  };
}
