import { assertAuthScope, captureAuthScope, request } from '../../api/client';
import { confirmFinancialIdentity, getFinancialIntent, rejectFinancialIdentity, withFinancialIdentity, type FinancialIntent } from '../../api/financialIdentity';
import { getServerScope } from '../../api/environment';
import { formError } from '../../api/validation';
import { hasPermission } from '../auth/permissions';
import type { UserProfile, UserTenant } from '../auth/AuthContext';
import { quantityMilli } from '../../domain/quantity';
import { assertVoidResult, commandFromIntent, parseSavedSale, voidCommand, type VoidDraft, type VoidCommand } from './model';

export type AcceptedVoid = { command: VoidCommand; key: string; result: any; userId: number; tenantId: number; scope: ReturnType<typeof captureAuthScope> };
export async function requireVoidCapability() {
  let capability;
  try { capability = await request('/sales/capabilities/'); }
  catch (error: any) { if (error.status === 404 || error.status === 405) throw Error('Xavfsiz qaytarish uchun serverni yangilash kerak. Hech qanday bekor qilish yuborilmadi.'); throw error; }
  if (capability?.sale_void_idempotency !== 1) throw Error('Server xavfsiz qayta so‘rashni qo‘llamaydi. Hech qanday bekor qilish yuborilmadi.');
}
export async function acknowledgeVoid(record: AcceptedVoid) {
  assertAuthScope(record.scope);
  await confirmFinancialIdentity(record.command.operation, record.userId, record.tenantId, record.key, record.result);
  assertAuthScope(record.scope);
  return record.result;
}
export async function submitVoid(draft: VoidDraft, user: UserProfile, tenant: UserTenant, onAccepted?: (record: AcceptedVoid) => void, onRecorded?: (pending: boolean) => void) {
  if (!hasPermission(user, tenant, 'sales.view_sale') || !hasPermission(user, tenant, 'sales.void_sale')) throw Error('Savdoni qaytarish uchun vakolat berilmagan.');
  const command = voidCommand(draft), scope = captureAuthScope(user.id, tenant.id);
  await requireVoidCapability(); assertAuthScope(scope);
  const previous = await getFinancialIntent(command.operation, user.id, tenant.id); assertAuthScope(scope);
  // A pending original intent may already have changed stock; replay its exact key without treating its effects as a new request.
  if (!previous || previous.status === 'rejected') {
    const sale = parseSavedSale(await request('/sales/' + command.saleId + '/')); assertAuthScope(scope);
    if (sale.id !== command.saleId || sale.b2b_target_tenant || !['completed', 'partially_voided'].includes(sale.status)) throw Error('Ushbu savdo oddiy qaytarish uchun ochiq emas.');
    if (command.itemId) {
      const line = sale.items.find(item => item.id === command.itemId);
      if (!line) throw Error('Tovar qatori ushbu savdoga tegishli emas.');
      const available = quantityMilli(line.quantity) - quantityMilli(line.voided_quantity, true);
      if (quantityMilli(command.payload.quantity!) > available) throw formError({ quantity: 'Qaytarish miqdori serverdagi qolgan miqdordan oshmasin.' });
    }
  }
  const payload = await withFinancialIdentity(command.operation, command.payload, user.id, tenant.id); assertAuthScope(scope);
  onRecorded?.(true);
  if (previous?.status === 'confirmed' && previous.result) {
    const result = assertVoidResult(previous.result, command, payload.idempotency_key, user.id, tenant.id);
    const accepted = { command, key: payload.idempotency_key, result, userId: user.id, tenantId: tenant.id, scope };
    onAccepted?.(accepted);
    return acknowledgeVoid(accepted);
  }
  let response: any;
  try {
    response = await request(command.endpoint, { method: 'POST', body: payload }); assertAuthScope(scope);
  } catch (error: any) {
    if (previous?.status !== 'pending' && [400, 403, 404, 422].includes(error.status)) {
      try { assertAuthScope(scope); await rejectFinancialIdentity(command.operation, user.id, tenant.id, payload.idempotency_key, error.message); onRecorded?.(false); }
      catch { throw Error((error.message || 'Amal bajarilmadi.') + ' Mahalliy jurnalni tekshiring; asl yozuv saqlandi.'); }
    }
    throw error;
  }
  const result = assertVoidResult(response, command, payload.idempotency_key, user.id, tenant.id);
  const accepted: AcceptedVoid = { command, key: payload.idempotency_key, result, userId: user.id, tenantId: tenant.id, scope };
  onAccepted?.(accepted);
  return acknowledgeVoid(accepted);
}
export async function reconcileVoidIntent(intent: FinancialIntent, user: UserProfile, tenant: UserTenant) {
  if (intent.server !== getServerScope() || intent.userId !== user.id || intent.tenantId !== tenant.id) throw Error('Bekor qilish boshqa server, hisob yoki do‘konga tegishli.');
  if (!hasPermission(user, tenant, 'sales.view_sale') || !hasPermission(user, tenant, 'sales.void_sale')) throw Error('Bekor qilishni tekshirish uchun vakolat berilmagan.');
  const command = commandFromIntent(intent.operation, intent.payload);
  if (!command) throw Error('Bekor qilishning asl ma’lumotlari tasdiqlanmadi. Jurnal saqlandi.');
  const scope = captureAuthScope(user.id, tenant.id);
  const current = await getFinancialIntent(intent.operation, user.id, tenant.id); assertAuthScope(scope);
  if (!current || current.key !== intent.key || current.fingerprint !== intent.fingerprint) throw Error('Jurnaldagi amal o‘zgardi. Ro‘yxatni yangilang.');
  if (current.status === 'rejected') throw Error('Asl amal rad etilgan. Qayta yuborilmadi.');
  if (current.status === 'confirmed' && current.result?.id) return assertVoidResult(current.result, command, current.key, user.id, tenant.id);
  await requireVoidCapability(); assertAuthScope(scope);
  const response = await request(command.endpoint, { method: 'POST', body: { ...current.payload, idempotency_key: current.key } }); assertAuthScope(scope);
  const result = assertVoidResult(response, command, current.key, user.id, tenant.id);
  return acknowledgeVoid({ command, key: current.key, result, userId: user.id, tenantId: tenant.id, scope });
}
