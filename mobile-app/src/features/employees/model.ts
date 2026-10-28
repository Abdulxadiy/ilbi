import type { UserProfile, UserTenant } from '../auth/AuthContext';
import { ownerOnly } from '../auth/permissions';
import { formError } from '../../api/validation';

export type PermissionChoice = { id: number; category: string; codename: string; name: string; code: string };
export type EmployeeAction = 'edit' | 'block' | 'invite' | 'archive' | 'restore';
export type Employee = {
  id: number; user: number; tenant: number; phone_number: string; contact_phone: string;
  first_name: string; last_name: string; username: string; email: string; position: string;
  is_active: boolean; is_owner: boolean; account_active: boolean; password_set: boolean;
  hired_at: string; fired_at: string | null; archived_at: string | null; permission_ids: number[];
  actions: Record<EmployeeAction, boolean>;
};
export type EmployeeDraft = { first_name: string; last_name: string; phone_number: string; contact_phone: string; email: string; position: string; permission_ids: number[] };
export type TeamOperation = 'fire' | 'block' | 'unblock' | 'archive' | 'restore' | 'invite';
const id = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const text = (value: unknown) => typeof value === 'string' ? value : '';
const actions: EmployeeAction[] = ['edit', 'block', 'invite', 'archive', 'restore'];
export function teamManager(user: UserProfile | null, tenant: UserTenant | null) {
  return Boolean(user?.terms_accepted && (user.role === 'platform_admin' || user.role === 'owner' && tenant && user.tenants.some(row => row.id === tenant.id && row.is_owner)));
}
export function employeeBase(tenantId: number) {
  if (!id(tenantId)) throw Error('Avval haqiqiy do‘konni tanlang.');
  return `/tenants/${tenantId}/employees/`;
}
export function parsePermissionChoices(value: unknown): PermissionChoice[] {
  if (!Array.isArray(value)) throw Error('Ruxsatlar ro‘yxati tasdiqlanmadi.');
  const rows = value.map(row => {
    if (!row || !id(row.id) || typeof row.category !== 'string' || typeof row.codename !== 'string' || !/^[a-z][a-z0-9_]*$/.test(row.category) || !/^[a-z][a-z0-9_]*$/.test(row.codename) || typeof row.name !== 'string') throw Error('Ruxsat ma’lumotlari tasdiqlanmadi.');
    return { id: row.id, category: row.category, codename: row.codename, name: row.name, code: row.category + '.' + row.codename };
  });
  if (new Set(rows.map(row => row.id)).size !== rows.length || new Set(rows.map(row => row.code)).size !== rows.length) throw Error('Ruxsatlar takrorlangan. Ro‘yxatni yangilang.');
  return rows.filter(row => !ownerOnly.has(row.code));
}
/** Copy directory fields only; never forward opaque account/password data into UI state. */
export function parseEmployee(value: any, tenantId: number): Employee {
  if (!value || !id(value.id) || !id(value.user) || value.tenant !== tenantId ||
      ['is_active', 'is_owner', 'account_active', 'password_set'].some(key => typeof value[key] !== 'boolean') ||
      !Array.isArray(value.permission_ids) || value.permission_ids.some((key: unknown) => !id(key))) throw Error('Xodim yoki do‘kon ma’lumotlari tasdiqlanmadi.');
  return {
    id: value.id, user: value.user, tenant: value.tenant, phone_number: text(value.phone_number), contact_phone: text(value.contact_phone),
    first_name: text(value.first_name), last_name: text(value.last_name), username: text(value.username), email: text(value.email), position: text(value.position),
    is_active: value.is_active, is_owner: value.is_owner, account_active: value.account_active, password_set: value.password_set,
    hired_at: text(value.hired_at), fired_at: value.fired_at == null ? null : text(value.fired_at), archived_at: value.archived_at == null ? null : text(value.archived_at),
    permission_ids: [...new Set<number>(value.permission_ids)],
    actions: Object.fromEntries(actions.map(key => [key, value.actions?.[key] === true])) as Employee['actions'],
  };
}
export const employeeName = (row: Employee) => [row.first_name, row.last_name].filter(Boolean).join(' ') || row.username || row.phone_number || `Xodim #${row.id}`;
export const employeeDraft = (row?: Employee): EmployeeDraft => ({ first_name: row?.first_name || '', last_name: row?.last_name || '', phone_number: row?.phone_number || '', contact_phone: row?.contact_phone || '', email: row?.email || '', position: row?.position || '', permission_ids: row?.permission_ids.slice() || [] });
const sameIds = (a: number[], b: number[]) => a.length === b.length && a.every(value => b.includes(value));
export function employeeBody(draft: EmployeeDraft, choices: PermissionChoice[] | null, editing: Employee | null) {
  const fields: Record<string, string> = {};
  if (!editing && !/^\+?[0-9][0-9\s()-]{5,19}$/.test(draft.phone_number.trim())) fields.phone_number = 'Telefon raqamini to‘g‘ri kiriting.';
  if (draft.contact_phone.trim() && !/^\+?[0-9][0-9\s()-]{5,19}$/.test(draft.contact_phone.trim())) fields.contact_phone = 'Aloqa raqamini to‘g‘ri kiriting.';
  if (draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) fields.email = 'Email manzilini to‘g‘ri kiriting.';
  for (const key of ['first_name', 'last_name', 'position'] as const) if (draft[key].trim().length > (key === 'position' ? 100 : 50)) fields[key] = 'Matn juda uzun.';
  const permissionsChanged = !editing || !sameIds(draft.permission_ids, editing.permission_ids);
  if (permissionsChanged && (!choices || draft.permission_ids.some(key => !choices.some(choice => choice.id === key)))) fields.permission_ids = 'Ruxsatlar ro‘yxatini yangilang yoki tanilmagan ruxsatlarni olib tashlang.';
  if (Object.keys(fields).length) throw formError(fields);
  return {
    first_name: draft.first_name.trim(), last_name: draft.last_name.trim(), email: draft.email.trim(), position: draft.position.trim(),
    ...(editing ? { contact_phone: draft.contact_phone.trim() } : { phone_number: draft.phone_number.trim() }),
    ...(permissionsChanged ? { permission_ids: [...new Set(draft.permission_ids)] } : {}),
  };
}
export function canTeamOperate(row: Employee, kind: TeamOperation, actorId: number) {
  if (row.user === actorId) return false;
  if (kind === 'fire') return row.actions.archive && row.is_active && !row.is_owner && !row.archived_at;
  if (kind === 'block' || kind === 'unblock') return row.actions.block && row.account_active === (kind === 'block');
  return row.actions[kind];
}
export function teamOperation(base: string, row: Employee, kind: TeamOperation, reason: string) {
  if (kind !== 'fire' && kind !== 'invite' && (!reason.trim() || reason.trim().length > 500)) throw formError({ reason: 'Sababni kiriting (500 belgigacha).' });
  if (kind === 'fire') return { path: base + 'fire/', method: 'POST' as const, body: { target_user_id: row.user } };
  if (kind === 'invite') return { path: `${base}${row.id}/resend-invite/`, method: 'POST' as const, body: {} };
  if (kind === 'archive') return { path: `${base}${row.id}/`, method: 'DELETE' as const, body: { reason: reason.trim() } };
  if (kind === 'restore') return { path: `${base}${row.id}/restore/`, method: 'POST' as const, body: { reason: reason.trim() } };
  return { path: `${base}${row.id}/account-status/`, method: 'POST' as const, body: { blocked: kind === 'block', reason: reason.trim() } };
}
/** Hire/fire return the thin serializer, not the richer directory row. */
export function employeeAcknowledgement(value: any, tenantId: number, expected?: Employee) {
  if (!value || !id(value.id) || !id(value.user) || value.tenant !== tenantId || typeof value.is_active !== 'boolean' || expected && (value.id !== expected.id || value.user !== expected.user)) throw Error('Server xodim amalini tasdiqlamadi. Takrorlashdan oldin ro‘yxatni yangilang.');
  return value as { id: number; user: number; tenant: number; is_active: boolean; onboarding_invitation?: { sent: boolean; reason: string } };
}
