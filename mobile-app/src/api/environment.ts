import { Platform } from 'react-native';

export const isDesignPreview = __DEV__ && process.env.EXPO_PUBLIC_DESIGN_PREVIEW === '1';
export function normalizeApiBaseUrl(value: string): string {
  if (Platform.OS === 'web' && value === '/api/v1') return value;
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error('To‘liq http/https API manzilini kiriting.');
  if (!__DEV__ && url.protocol !== 'https:') throw Error('Himoyalangan https server manzili kerak.');
  if (!/\/api\/v1\/?$/.test(url.pathname)) throw Error('API manzili /api/v1 bilan tugashi kerak.');
  return url.toString().replace(/\/+$/, '');
}
let apiBaseUrl = normalizeApiBaseUrl(process.env.EXPO_PUBLIC_API_URL || (Platform.OS === 'web' ? '/api/v1' : 'https://ilbi.uz/api/v1'));
export const getApiBaseUrl = () => apiBaseUrl;
/** Only the session client may commit a validated origin after credential removal. */
const serverListeners = new Set<() => void>();
export function subscribeServerScope(listener: () => void) { serverListeners.add(listener); return () => { serverListeners.delete(listener); }; }
export function commitApiBaseUrl(value: string) { apiBaseUrl = normalizeApiBaseUrl(value); for (const listener of serverListeners) listener(); }
export const getServerScope = () => isDesignPreview ? 'design-preview-v2' : apiBaseUrl;
export const scopedKey = (kind: string, userId?: number, tenantId?: number) => {
  if (!userId || !tenantId) throw Error('Foydalanuvchi va do‘kon tanlanishi kerak.');
  return 'ilbi:' + encodeURIComponent(getServerScope()) + ':' + userId + ':' + tenantId + ':' + kind;
};
