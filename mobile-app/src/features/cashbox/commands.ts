import { request, assertAuthScope, captureAuthScope } from '../../api/client';
import { getServerScope } from '../../api/environment';
import { confirmFinancialIdentity, getFinancialIntent, rejectFinancialIdentity, withFinancialIdentity, type FinancialIntent } from '../../api/financialIdentity';
import { hasPermission } from '../auth/permissions';
import type { UserProfile, UserTenant } from '../auth/AuthContext';
import { cashboxEndpoint, cashboxPermission, parseCashboxResult, type CashboxKind } from './model';

export class CashboxAcceptedButUnrecorded extends Error {
  constructor(public operation: string, public key: string, public result: any) { super('Amal serverda saqlandi, qurilmadagi tasdiq yakunlanmadi. Amalni qayta yaratmang.'); }
}
export function cashboxKind(operation: string): CashboxKind {
  const match = operation.match(/^cashbox:(open|close|income|expense):[a-f0-9-]{36}$/);
  if (!match) throw Error('Kassa amali jurnali tasdiqlanmadi.');
  return match[1] as CashboxKind;
}
export async function cashboxAvailable() {
  try {
    const value = await request('/cashbox/capabilities/');
    return value?.cashbox_mutations === 1 && ['open', 'close', 'income', 'expense'].every(kind => value.idempotent_operations?.includes(kind));
  } catch (failure: any) { if ([404, 405].includes(failure.status)) return false; throw failure; }
}
export async function submitCashbox(operation: string, payload: object, user: UserProfile, tenant: UserTenant) {
  const kind = cashboxKind(operation), scope = captureAuthScope();
  if (!hasPermission(user, tenant, cashboxPermission(kind))) throw Error('Bu kassa amali uchun vakolat berilmagan.');
  if (!await cashboxAvailable()) throw Error('Server kassa amallarining xavfsiz yangilanishini hali qo‘llamaydi. Ma’lumotlar saqlandi.');
  assertAuthScope(scope);
  const previous = await getFinancialIntent(operation, user.id, tenant.id);
  assertAuthScope(scope);
  const body = await withFinancialIdentity(operation, payload, user.id, tenant.id);
  assertAuthScope(scope);
  let result;
  try { result = parseCashboxResult(await request(cashboxEndpoint(kind), { method: 'POST', body }), kind, body.idempotency_key, user.id, tenant.id, payload); }
  catch (failure: any) {
    // A rejection on a later unknown-result retry cannot prove the original write failed.
    if (previous?.status !== 'pending' && failure.status >= 400 && failure.status < 500 && ![408, 409, 425, 429].includes(failure.status)) {
      try { await rejectFinancialIdentity(operation, user.id, tenant.id, body.idempotency_key, failure.message); } catch {}
    }
    throw failure;
  }
  assertAuthScope(scope);
  try { await confirmFinancialIdentity(operation, user.id, tenant.id, body.idempotency_key, result); }
  catch { throw new CashboxAcceptedButUnrecorded(operation, body.idempotency_key, result); }
  assertAuthScope(scope);
  return result;
}

export async function reconcileCashboxIntent(intent: FinancialIntent, user: UserProfile, tenant: UserTenant) {
  const kind = cashboxKind(intent.operation);
  if (intent.server !== getServerScope() || intent.userId !== user.id || intent.tenantId !== tenant.id) throw Error('Kassa amali boshqa server, hisob yoki do‘konga tegishli.');
  if (!hasPermission(user, tenant, cashboxPermission(kind))) throw Error('Kassa amalini tekshirish uchun vakolat berilmagan.');
  const scope = captureAuthScope(), current = await getFinancialIntent(intent.operation, user.id, tenant.id);
  assertAuthScope(scope);
  if (!current || current.key !== intent.key || current.fingerprint !== intent.fingerprint || current.status === 'rejected') throw Error('Kassa jurnali o‘zgargan yoki amal rad etilgan.');
  if (current.status === 'confirmed') return parseCashboxResult(current.result, kind, current.key, user.id, tenant.id, current.payload);
  if (!await cashboxAvailable()) throw Error('Server xavfsiz kassa qayta urinishini qo‘llamaydi. Jurnal saqlanadi.');
  assertAuthScope(scope);
  const result = parseCashboxResult(await request(cashboxEndpoint(kind), { method: 'POST', body: { ...current.payload, idempotency_key: current.key } }), kind, current.key, user.id, tenant.id, current.payload);
  assertAuthScope(scope);
  await confirmFinancialIdentity(current.operation, user.id, tenant.id, current.key, result);
  assertAuthScope(scope);
  return result;
}
