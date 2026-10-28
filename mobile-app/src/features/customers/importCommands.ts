import { assertAuthScope, captureAuthScope, request } from '../../api/client';
import { getServerScope } from '../../api/environment';
import { confirmFinancialIdentity, getFinancialIntent, PendingOperationError, rejectFinancialIdentity, withFinancialIdentity, type FinancialIntent } from '../../api/financialIdentity';
import type { UserProfile, UserTenant } from '../auth/AuthContext';
import { hasPermission } from '../auth/permissions';
import { acceptedImport, parseImportJob, parseImportPayload, type ImportPayload } from './importModel';

export type AcceptedImport = { operation: string; key: string; result: ReturnType<typeof acceptedImport>; userId: number; tenantId: number; scope: ReturnType<typeof captureAuthScope> };
const context = (user: UserProfile, tenant: UserTenant) => ({ actorId: user.id, tenantId: tenant.id });
function permitted(user: UserProfile, tenant: UserTenant, payload?: ImportPayload) {
  if (!hasPermission(user, tenant, 'sales.manage_counterparty')) throw Error('Mijozlarni yuklash uchun vakolat berilmagan.');
  if (payload && [payload.expected_total_debt_uzs, payload.expected_total_debt_usd].some(value => value !== '0.00') && !hasPermission(user, tenant, 'sales.record_debt_payment')) throw Error('Boshlang‘ich nasiya uchun qarz to‘lovlarini qayd etish vakolati kerak.');
}
export async function previewCustomerImport(body: FormData, user: UserProfile, tenant: UserTenant) {
  permitted(user, tenant);
  const scope = captureAuthScope(user.id, tenant.id); assertAuthScope(scope);
  const value = await request('/sales/counterparties/import/preview/', { method: 'POST', body, timeoutMs: 60000 }); assertAuthScope(scope);
  return parseImportJob(value, context(user, tenant));
}
function stored(record: FinancialIntent, user: UserProfile, tenant: UserTenant) {
  const payload = parseImportPayload(record.payload), operation = 'customer-import:' + payload.job_id;
  const fingerprint = '{' + Object.keys(payload).sort().map(key => JSON.stringify(key) + ':' + JSON.stringify(payload[key as keyof ImportPayload])).join(',') + '}';
  if (record.version !== 1 || record.operation !== operation || record.server !== getServerScope() || record.userId !== user.id || record.tenantId !== tenant.id || !record.key || typeof record.key !== 'string' || record.key.length > 64 || record.fingerprint !== fingerprint || !['pending', 'confirmed', 'rejected'].includes(record.status)) throw Error('Importning asl manbasi yoki jurnali tasdiqlanmadi. Yozuv saqlanadi.');
  return payload;
}
export async function acknowledgeCustomerImport(record: AcceptedImport) {
  assertAuthScope(record.scope);
  await confirmFinancialIdentity(record.operation, record.userId, record.tenantId, record.key, record.result);
  assertAuthScope(record.scope); return record.result;
}
export async function commitCustomerImport(raw: ImportPayload, user: UserProfile, tenant: UserTenant, onAccepted?: (record: AcceptedImport) => void, onRecorded?: (pending: boolean) => void) {
  const payload = parseImportPayload(raw), operation = 'customer-import:' + payload.job_id;
  permitted(user, tenant, payload);
  const scope = captureAuthScope(user.id, tenant.id); assertAuthScope(scope);
  const previous = await getFinancialIntent(operation, user.id, tenant.id); assertAuthScope(scope);
  if (previous) {
    const saved = stored(previous, user, tenant);
    if (JSON.stringify(saved) !== JSON.stringify(payload)) throw new PendingOperationError(previous);
  }
  const identity = await withFinancialIdentity(operation, payload, user.id, tenant.id); assertAuthScope(scope);
  onRecorded?.(true);
  let value = previous?.status === 'confirmed' ? previous.result : null;
  if (!value) {
    try { value = await request(`/sales/counterparties/import/${payload.job_id}/commit/`, { method: 'POST', body: {}, timeoutMs: 60000 }); assertAuthScope(scope); }
    catch (failure: any) {
      if (previous?.status !== 'pending' && [400, 403, 404, 422].includes(failure.status)) {
        assertAuthScope(scope); await rejectFinancialIdentity(operation, user.id, tenant.id, identity.idempotency_key, failure.message); onRecorded?.(false);
      }
      throw failure;
    }
  }
  const result = acceptedImport(value, payload, context(user, tenant));
  const accepted = { operation, key: identity.idempotency_key, result, userId: user.id, tenantId: tenant.id, scope };
  onAccepted?.(accepted); return acknowledgeCustomerImport(accepted);
}
export async function reconcileCustomerImport(intent: FinancialIntent, user: UserProfile, tenant: UserTenant) {
  if (intent.server !== getServerScope() || intent.userId !== user.id || intent.tenantId !== tenant.id) throw Error('Import boshqa server, hisob yoki do‘konga tegishli.');
  const scope = captureAuthScope(user.id, tenant.id); assertAuthScope(scope);
  const saved = await getFinancialIntent(intent.operation, user.id, tenant.id); assertAuthScope(scope);
  if (!saved || saved.operation !== intent.operation || saved.key !== intent.key || saved.fingerprint !== intent.fingerprint || saved.status === 'rejected') throw Error('Importning asl jurnali topilmadi yoki tasdiqlanmadi.');
  return commitCustomerImport(stored(saved, user, tenant), user, tenant);
}
