import { assertAuthScope, captureAuthScope, request } from '../../api/client';
import { getServerScope } from '../../api/environment';
import { confirmFinancialIdentity, getFinancialIntent, PendingOperationError, rejectFinancialIdentity, withFinancialIdentity, type FinancialIntent } from '../../api/financialIdentity';
import { formError } from '../../api/validation';
import { hasPermission } from '../auth/permissions';
import type { UserProfile, UserTenant } from '../auth/AuthContext';
import { acceptedAdjustment, adjustmentPayload, parseAdjustmentQuote, type AdjustmentPayload } from './adjustmentModel';

export type AcceptedAdjustment = { operation: string; key: string; result: ReturnType<typeof acceptedAdjustment>; userId: number; tenantId: number; scope: ReturnType<typeof captureAuthScope> };
export function adjustmentCustomer(operation: string) {
  const match = /^debt-adjustment:([1-9]\d*):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.exec(operation);
  const customer = Number(match?.[1]);
  if (!Number.isSafeInteger(customer) || customer < 1) throw Error('Tuzatish oynasining asl raqami tasdiqlanmadi.');
  return customer;
}
function permitted(user: UserProfile, tenant: UserTenant, branch: number) {
  const target = user.tenants.find(row => row.id === branch);
  if (user.role !== 'owner' || !hasPermission(user, tenant, 'sales.correct_debt_payment') || !target || !hasPermission(user, target, 'sales.correct_debt_payment')) throw Error('Tuzatish uchun tanlangan do‘konlarda egasi vakolati talab qilinadi.');
}
const context = (customerId: number, user: UserProfile, tenant: UserTenant, payload: AdjustmentPayload) => ({ actorId: user.id, tenantId: tenant.id, customerId, branchId: payload.branch_id });
const samePayload = (one: AdjustmentPayload, two: AdjustmentPayload) => one.kind === two.kind && one.amount === two.amount && one.currency === two.currency && one.payment_type === two.payment_type && one.branch_id === two.branch_id && one.note === two.note && one.expected_quote === two.expected_quote;
function storedPayload(record: FinancialIntent, operation: string, user: UserProfile, tenant: UserTenant) {
  if (record.version !== 1 || record.operation !== operation || record.server !== getServerScope() || record.userId !== user.id || record.tenantId !== tenant.id || typeof record.key !== 'string' || !record.key || record.key.length > 64 || !['pending', 'confirmed', 'rejected'].includes(record.status)) throw Error('Tuzatish jurnali boshqa manbaga tegishli yoki buzilgan. Asl yozuv saqlanadi.');
  const payload = adjustmentPayload(record.payload);
  const fingerprint = '{' + Object.keys(payload).sort().map(key => JSON.stringify(key) + ':' + JSON.stringify(payload[key as keyof AdjustmentPayload])).join(',') + '}';
  if (!payload.expected_quote || record.fingerprint !== fingerprint) throw Error('Tuzatish jurnali mazmuni tasdiqlanmadi. Asl yozuv saqlanadi.');
  return payload;
}

export async function fetchAdjustmentQuote(customerId: number, raw: AdjustmentPayload, user: UserProfile, tenant: UserTenant) {
  const payload = adjustmentPayload(raw); permitted(user, tenant, payload.branch_id);
  if (!Number.isSafeInteger(customerId) || customerId < 1) throw Error('Mijoz identifikatori noto‘g‘ri.');
  const scope = captureAuthScope(user.id, tenant.id); assertAuthScope(scope);
  let value: unknown;
  try { value = await request(`/sales/counterparties/${customerId}/payments/adjustment-quote/`, { method: 'POST', body: { kind: payload.kind, amount: payload.amount, currency: payload.currency, payment_type: payload.payment_type, branch_id: payload.branch_id, note: payload.note } }); }
  catch (failure: any) {
    assertAuthScope(scope);
    if ([404, 405].includes(failure.status)) throw Error('Mijoz haqqi va qarz tuzatish hisobi uchun serverni yangilash kerak.');
    throw failure;
  }
  assertAuthScope(scope);
  return parseAdjustmentQuote(value, context(customerId, user, tenant, payload), payload);
}
export async function acknowledgeAdjustment(record: AcceptedAdjustment) {
  assertAuthScope(record.scope);
  await confirmFinancialIdentity(record.operation, record.userId, record.tenantId, record.key, record.result);
  assertAuthScope(record.scope); return record.result;
}
export async function submitAdjustment(operation: string, raw: AdjustmentPayload, user: UserProfile, tenant: UserTenant, onAccepted?: (record: AcceptedAdjustment) => void, onRecorded?: (pending: boolean, payload: AdjustmentPayload) => void) {
  const customerId = adjustmentCustomer(operation), input = adjustmentPayload(raw);
  permitted(user, tenant, input.branch_id);
  const scope = captureAuthScope(user.id, tenant.id); assertAuthScope(scope);
  const previous = await getFinancialIntent(operation, user.id, tenant.id); assertAuthScope(scope);
  if (previous) storedPayload(previous, operation, user, tenant);
  let payload = input;
  if (previous && previous.status !== 'rejected') {
    const saved = storedPayload(previous, operation, user, tenant);
    if (!samePayload(saved, input)) throw new PendingOperationError(previous);
    payload = saved;
  } else {
    if (!input.expected_quote) throw Error('Avval tuzatishni hisoblang va ko‘rsatilgan natijani tasdiqlang.');
    const quote = await fetchAdjustmentQuote(customerId, input, user, tenant); assertAuthScope(scope);
    if (quote.expected_quote !== input.expected_quote) throw formError({ amount: 'Mijoz balansi o‘zgardi. Tuzatish hisobini yangilang.' });
  }
  const body = previous?.status === 'confirmed' ? { ...payload, idempotency_key: previous.key } : await withFinancialIdentity(operation, payload, user.id, tenant.id);
  assertAuthScope(scope); onRecorded?.(true, payload);
  let value = previous?.status === 'confirmed' ? previous.result : null;
  if (!value) {
    try { value = await request(`/sales/counterparties/${customerId}/payments/adjust/`, { method: 'POST', body }); assertAuthScope(scope); }
    catch (failure: any) {
      // A pre-existing uncertain attempt may already have committed. Keep its
      // original journal even if a later replay is denied/stale; never guess.
      if (previous?.status !== 'pending' && [400, 403, 404, 422].includes(failure.status)) {
        assertAuthScope(scope);
        await rejectFinancialIdentity(operation, user.id, tenant.id, body.idempotency_key, failure.message);
        onRecorded?.(false, payload);
      }
      throw failure;
    }
  }
  const result = acceptedAdjustment(value, context(customerId, user, tenant, payload), payload, body.idempotency_key);
  const accepted = { operation, key: body.idempotency_key, result, userId: user.id, tenantId: tenant.id, scope };
  onAccepted?.(accepted);
  return acknowledgeAdjustment(accepted);
}
export async function reconcileAdjustmentIntent(intent: FinancialIntent, user: UserProfile, tenant: UserTenant) {
  if (intent.server !== getServerScope() || intent.userId !== user.id || intent.tenantId !== tenant.id) throw Error('Tuzatish boshqa hisob, server yoki do‘konga tegishli.');
  const customerId = adjustmentCustomer(intent.operation);
  const scope = captureAuthScope(user.id, tenant.id); assertAuthScope(scope);
  const saved = await getFinancialIntent(intent.operation, user.id, tenant.id); assertAuthScope(scope);
  if (!saved || saved.key !== intent.key || saved.fingerprint !== intent.fingerprint || saved.status === 'rejected') throw Error('Tuzatishning asl jurnali tasdiqlanmadi.');
  const payload = storedPayload(saved, intent.operation, user, tenant);
  permitted(user, tenant, payload.branch_id);
  const value = saved.status === 'confirmed' ? saved.result : await request(`/sales/counterparties/${customerId}/payments/adjust/`, { method: 'POST', body: { ...payload, idempotency_key: saved.key } });
  assertAuthScope(scope);
  const result = acceptedAdjustment(value, context(customerId, user, tenant, payload), payload, saved.key);
  return acknowledgeAdjustment({ operation: saved.operation, key: saved.key, result, userId: user.id, tenantId: tenant.id, scope });
}
