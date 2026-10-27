import { assertAuthScope, captureAuthScope, request } from '../../api/client';
import { getServerScope } from '../../api/environment';
import { confirmFinancialIdentity, getFinancialIntent, rejectFinancialIdentity, withFinancialIdentity, type FinancialIntent } from '../../api/financialIdentity';
import { hasPermission } from '../auth/permissions';
import type { UserProfile, UserTenant } from '../auth/AuthContext';
import { assertB2BResult, b2bBody, b2bCommand, commandFromB2BIntent, type B2BDraft, type B2BPayload } from './model';

export type AcceptedB2B = { operation: string; payload: B2BPayload; key: string; result: any; userId: number; tenantId: number; scope: ReturnType<typeof captureAuthScope> };
export async function requireB2BCapability() {
  let value;
  try { value = await request('/sales/b2b/capabilities/'); }
  catch (error: any) { if ([404, 405].includes(error.status)) throw Error('B2B amallari uchun serverni yangilash kerak. Amal yuborilmadi.'); throw error; }
  if (value?.b2b_mutations !== 1 || !Array.isArray(value.operations) || !['accept', 'reject', 'receive', 'close_discrepancy'].every(kind => value.operations.includes(kind))) throw Error('Server xavfsiz B2B amallarini qo‘llamaydi. Amal yuborilmadi.');
}
function permission(user: UserProfile, tenant: UserTenant, kind: string) {
  if (!hasPermission(user, tenant, 'sales.manage_b2b') || kind === 'close_discrepancy' && !tenant.is_owner) throw Error('B2B amali uchun vakolat berilmagan.');
}
export async function acknowledgeB2B(record: AcceptedB2B) {
  assertAuthScope(record.scope);
  await confirmFinancialIdentity(record.operation, record.userId, record.tenantId, record.key, record.result);
  assertAuthScope(record.scope);
  return record.result;
}
export async function submitB2B(draft: B2BDraft, user: UserProfile, tenant: UserTenant, onAccepted?: (record: AcceptedB2B) => void, onRecorded?: (pending: boolean) => void) {
  const command = b2bCommand(draft), scope = captureAuthScope();
  permission(user, tenant, command.payload.kind);
  await requireB2BCapability(); assertAuthScope(scope);
  const previous = await getFinancialIntent(command.operation, user.id, tenant.id); assertAuthScope(scope);
  const identity = await withFinancialIdentity(command.operation, command.payload, user.id, tenant.id); assertAuthScope(scope);
  onRecorded?.(true);
  let result: any;
  if (previous?.status === 'confirmed') result = previous.result;
  else {
    try { result = await request(command.endpoint, { method: 'POST', body: b2bBody(command.payload, identity.idempotency_key) }); assertAuthScope(scope); }
    catch (error: any) {
      if (previous?.status !== 'pending' && [400, 403, 404, 422].includes(error.status)) {
        assertAuthScope(scope);
        await rejectFinancialIdentity(command.operation, user.id, tenant.id, identity.idempotency_key, error.message); onRecorded?.(false);
      }
      throw error;
    }
  }
  assertB2BResult(result, command.payload, identity.idempotency_key, user.id, tenant.id);
  const accepted: AcceptedB2B = { operation: command.operation, payload: command.payload, key: identity.idempotency_key, result, userId: user.id, tenantId: tenant.id, scope };
  onAccepted?.(accepted);
  return acknowledgeB2B(accepted);
}
export async function reconcileB2BIntent(intent: FinancialIntent, user: UserProfile, tenant: UserTenant) {
  if (intent.server !== getServerScope() || intent.userId !== user.id || intent.tenantId !== tenant.id) throw Error('B2B amali boshqa server, hisob yoki do‘konga tegishli.');
  const command = commandFromB2BIntent(intent.operation, intent.payload), scope = captureAuthScope();
  permission(user, tenant, command.payload.kind);
  const current = await getFinancialIntent(intent.operation, user.id, tenant.id); assertAuthScope(scope);
  if (!current || current.key !== intent.key || current.fingerprint !== intent.fingerprint || current.status === 'rejected') throw Error('Asl B2B jurnali tasdiqlanmadi. Yangi amal yuborilmadi.');
  if (current.status === 'confirmed') return assertB2BResult(current.result, command.payload, current.key, user.id, tenant.id);
  await requireB2BCapability(); assertAuthScope(scope);
  const result = await request(command.endpoint, { method: 'POST', body: b2bBody(command.payload, current.key) }); assertAuthScope(scope);
  assertB2BResult(result, command.payload, current.key, user.id, tenant.id);
  return acknowledgeB2B({ operation: intent.operation, payload: command.payload, key: current.key, result, userId: user.id, tenantId: tenant.id, scope });
}
