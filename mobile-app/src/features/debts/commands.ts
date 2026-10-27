import { request, assertAuthScope, captureAuthScope } from '../../api/client';
import { getServerScope } from '../../api/environment';
import { getFinancialIntent, withFinancialIdentity, confirmFinancialIdentity, rejectFinancialIdentity, PendingOperationError, type FinancialIntent } from '../../api/financialIdentity';
import { formError } from '../../api/validation';
import { parseMoneyMinor } from '../../domain/money';
import { hasPermission } from '../auth/permissions';
import type { UserProfile, UserTenant } from '../auth/AuthContext';
import { positiveId } from '../reports/model';
import { DEBT_QUOTE_PROTOCOL, fetchDebtQuote } from './quote';
export type DebtPayload = { amount: string; currency: 'UZS' | 'USD'; payment_type: 'cash' | 'card'; branch_id?: number; note?: string; expected_quote?: string };
export type AcceptedDebt = { operation: string; key: string; result: any; userId: number; tenantId: number; scope: ReturnType<typeof captureAuthScope> };
export function debtCustomer(operation: string) {
  const match = /^debt-([1-9]\d*)$/.exec(operation) || /^debt:([1-9]\d*):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.exec(operation);
  if (!match) throw Error('Qarz to‘lovi jurnali tasdiqlanmadi.');
  return positiveId(Number(match[1]));
}
export function debtPayload(value: any): DebtPayload {
  let minor: number;
  try { minor = parseMoneyMinor(value?.amount); if (minor <= 0) throw Error(); }
  catch { throw formError({ amount: 'To‘lov summasini to‘g‘ri kiriting.' }); }
  if (!['UZS', 'USD'].includes(value.currency) || !['cash', 'card'].includes(value.payment_type)) throw Error('To‘lov valyutasi yoki usuli tasdiqlanmadi.');
  if (value.branch_id != null) positiveId(value.branch_id);
  if (value.note != null && typeof value.note !== 'string') throw Error('To‘lov eslatmasi tasdiqlanmadi.');
  if (value.expected_quote != null && (typeof value.expected_quote !== 'string' || !/^[a-f0-9]{64}$/.test(value.expected_quote))) throw Error('To‘lov hisobini qayta tekshiring.');
  const cents = BigInt(minor);
  return { ...value, amount: `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}` };
}
export function acceptedDebt(value: any, customer: number, payload: DebtPayload, actor: number, tenant: number, key: string) {
  positiveId(value?.id);
  if (value.counterparty !== customer || value.currency !== payload.currency || value.payment_type !== payload.payment_type || value.recorded_by !== actor || (value.branch_id ?? value.branch) !== (payload.branch_id ?? tenant) || parseMoneyMinor(value.amount) !== parseMoneyMinor(payload.amount)) throw Error('Server to‘lov natijasini to‘liq tasdiqlamadi. Amallar jurnalidan tekshiring.');
  if (payload.expected_quote) {
    const receipt = value.payment_operation;
    if (receipt?.protocol !== DEBT_QUOTE_PROTOCOL || receipt.idempotency_key !== key || receipt.expected_quote !== payload.expected_quote || receipt.actor_id !== actor || receipt.tenant_id !== tenant || receipt.counterparty_id !== customer || receipt.branch_id !== (payload.branch_id ?? tenant)) throw Error('Server asl to‘lov kaliti va hisobini tasdiqlamadi. Jurnal saqlanadi.');
  }
  return value;
}
const permitted = (user: UserProfile, tenant: UserTenant) => { if (!hasPermission(user, tenant, 'sales.record_debt_payment')) throw Error('To‘lov uchun faol do‘konda vakolat berilmagan.'); };
export async function acknowledgeDebt(record: AcceptedDebt) {
  assertAuthScope(record.scope);
  await confirmFinancialIdentity(record.operation, record.userId, record.tenantId, record.key, record.result);
  assertAuthScope(record.scope);
  return record.result;
}
export async function submitDebt(operation: string, raw: DebtPayload, user: UserProfile, tenant: UserTenant, onAccepted?: (value: AcceptedDebt) => void, onRecorded?: (pending: boolean, payload?: DebtPayload) => void) {
  permitted(user, tenant);
  const customer = debtCustomer(operation), input = debtPayload(raw), scope = captureAuthScope(user.id, tenant.id);
  const previous = await getFinancialIntent(operation, user.id, tenant.id); assertAuthScope(scope);
  let payload: DebtPayload = input;
  if (previous && previous.status !== 'rejected') {
    const saved = debtPayload(previous.payload);
    if (saved.amount !== input.amount || saved.currency !== input.currency || saved.payment_type !== input.payment_type || (saved.branch_id ?? tenant.id) !== (input.branch_id ?? tenant.id) || (saved.note || '').trim() !== (input.note || '').trim() || input.expected_quote && input.expected_quote !== saved.expected_quote) throw new PendingOperationError(previous);
    // Replay the persisted body. Do not recalculate an already accepted conversion.
    payload = previous.payload as DebtPayload;
  } else {
    if (!input.expected_quote) throw Error('Avval to‘lov hisobini tekshirib, ko‘rsatilgan hisobni tasdiqlang.');
    // A new client must prove the server understands the guard; older APIs ignore unknown fields.
    const quote = await fetchDebtQuote(customer, input, user, tenant); assertAuthScope(scope);
    if (quote.expected_quote !== input.expected_quote) throw formError({ amount: 'Qarz qoldig‘i yoki kurs o‘zgardi. To‘lov hisobini qayta tekshiring.' });
  }
  const body = previous?.status === 'confirmed' ? { ...payload, idempotency_key: previous.key } : await withFinancialIdentity(operation, payload, user.id, tenant.id);
  assertAuthScope(scope); onRecorded?.(true, payload);
  let response = previous?.status === 'confirmed' ? previous.result : null;
  if (!response) {
    try { response = await request('/sales/counterparties/' + customer + '/payments/', { method: 'POST', body }); assertAuthScope(scope); }
    catch (failure: any) {
      if (previous?.status !== 'pending' && [400, 403, 404, 422].includes(failure.status)) {
        assertAuthScope(scope);
        await rejectFinancialIdentity(operation, user.id, tenant.id, body.idempotency_key, failure.message); onRecorded?.(false, payload);
      }
      throw failure;
    }
  }
  const result = acceptedDebt(response, customer, payload, user.id, tenant.id, body.idempotency_key);
  const record: AcceptedDebt = { operation, key: body.idempotency_key, result, userId: user.id, tenantId: tenant.id, scope };
  onAccepted?.(record);
  return acknowledgeDebt(record);
}
export async function reconcileDebtIntent(intent: FinancialIntent, user: UserProfile, tenant: UserTenant) {
  if (intent.server !== getServerScope() || intent.userId !== user.id || intent.tenantId !== tenant.id) throw Error('Qarz to‘lovi boshqa server, hisob yoki do‘konga tegishli.');
  permitted(user, tenant);
  const customer = debtCustomer(intent.operation), payload = debtPayload(intent.payload), scope = captureAuthScope(user.id, tenant.id);
  const current = await getFinancialIntent(intent.operation, user.id, tenant.id); assertAuthScope(scope);
  if (!current || current.key !== intent.key || current.fingerprint !== intent.fingerprint || current.status === 'rejected') throw Error('Qarz to‘lovining asl jurnali tasdiqlanmadi.');
  const response = current.status === 'confirmed' ? current.result : await request('/sales/counterparties/' + customer + '/payments/', { method: 'POST', body: { ...current.payload, idempotency_key: current.key } });
  assertAuthScope(scope);
  const result = acceptedDebt(response, customer, payload, user.id, tenant.id, current.key);
  return acknowledgeDebt({ operation: current.operation, key: current.key, result, userId: user.id, tenantId: tenant.id, scope });
}
