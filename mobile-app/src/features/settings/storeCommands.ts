import { assertAuthScope, captureAuthScope, request } from '../../api/client';
import { hasPermission } from '../auth/permissions';
import type { UserProfile, UserTenant } from '../auth/AuthContext';
import { conflictsWith, parseStoreSettings, sectionPatch, type StoreDraft, type StoreSection, type StoreSettings } from './storeModel';

export class StoreSettingsConflict extends Error {
  constructor() { super('Bu sozlamalar boshqa oynada o‘zgargan. Kiritgan matningiz saqlandi; qayta yuklashdan oldin o‘zgarishlarni ko‘rib chiqing.'); }
}
function permit(user: UserProfile, tenant: UserTenant) {
  if (!hasPermission(user, tenant, 'tenants.manage_settings')) throw Error('Do‘kon sozlamalari uchun vakolat berilmagan.');
}
export async function saveStoreSection(section: StoreSection, draft: StoreDraft, original: StoreSettings, user: UserProfile, tenant: UserTenant) {
  permit(user, tenant);
  if (original.id !== tenant.id) throw Error('Sozlamalar boshqa do‘konga tegishli.');
  const patch = sectionPatch(original, section, draft), scope = captureAuthScope();
  if (!Object.keys(patch).length) return original;
  if (!original.revision) throw Error('Xavfsiz sozlama saqlash uchun serverni yangilash kerak.');
  const latest = parseStoreSettings(await request('/tenants/current/')); assertAuthScope(scope);
  if (latest.id !== tenant.id || !latest.revision) throw Error('Faol do‘kon yoki sozlamalar talqini tasdiqlanmadi.');
  if (conflictsWith(original, latest, patch).length) throw new StoreSettingsConflict();
  // Read/patch race is guarded atomically by the backend's tenant row lock.
  const actualPatch = Object.fromEntries(Object.entries(patch).filter(([field, value]) => value !== latest.values[field]));
  if (!Object.keys(actualPatch).length) return latest;
  let raw;
  try { raw = await request('/tenants/current/', { method: 'PATCH', headers: { 'If-Match': '"' + latest.revision + '"' }, body: actualPatch }); }
  catch (failure: any) { if (failure.status === 412) throw new StoreSettingsConflict(); throw failure; }
  assertAuthScope(scope);
  const result = parseStoreSettings(raw);
  if (result.id !== tenant.id || !result.revision || Object.entries(actualPatch).some(([field, value]) => result.values[field] !== value)) throw Error('Server so‘ralgan sozlamalarni to‘liq tasdiqlamadi. Kiritilgan ma’lumot saqlandi; server holatini tekshiring.');
  return result;
}
export const storeActions = {
  telegram: { title: 'Telegram test xabarini yuborish', endpoint: 'test-telegram/' },
  daily: { title: 'Kunlik hisobotni hozir yuborish', endpoint: 'send-report-now/' },
  stock: { title: 'Kamaygan tovar hisobotini yuborish', endpoint: 'send-low-stock-report-now/' },
} as const;
export type StoreAction = keyof typeof storeActions;
/** Only an explicit confirmation calls this. Network uncertainty is never retried automatically. */
export async function sendStoreAction(action: StoreAction, user: UserProfile, tenant: UserTenant) {
  permit(user, tenant);
  const scope = captureAuthScope();
  const latest = parseStoreSettings(await request('/tenants/current/')); assertAuthScope(scope);
  if (latest.id !== tenant.id) throw Error('Faol do‘kon tasdiqlanmadi.');
  const result = await request('/tenants/current/' + storeActions[action].endpoint, { method: 'POST', body: {} }); assertAuthScope(scope);
  if (result?.success !== true || typeof result.detail !== 'string') throw Error('Server xabar yuborilganini tasdiqlamadi. Telegramni tekshiring; avtomatik qayta yuborilmadi.');
  return result.detail as string;
}
