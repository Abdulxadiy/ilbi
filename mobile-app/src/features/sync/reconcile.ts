import { assertAuthScope, captureAuthScope, request } from '../../api/client';
import { getServerScope } from '../../api/environment';
import { reconcileVoidIntent } from '../sales/void';
import { reconcileB2BIntent } from '../b2b/commands';
import { reconcileDebtIntent } from '../debts/commands';
import { reconcileInventoryIntent } from '../inventory/commands';
import { reconcileCashboxIntent } from '../cashbox/commands';
import { acceptedRetailSale } from '../checkout/saleResponse';
import { confirmFinancialIdentity, getFinancialIntent, type FinancialIntent } from '../../api/financialIdentity';
import { hasPermission } from '../auth/permissions';
import type { UserProfile, UserTenant } from '../auth/AuthContext';
export async function reconcileFinancialIntent(intent: FinancialIntent, user: UserProfile, tenant: UserTenant) {
  if (intent.server !== getServerScope() || intent.userId !== user.id || intent.tenantId !== tenant.id) throw Error('Amal ushbu server, hisob va do‘konga tegishli emas.');
  if (intent.operation.startsWith('void-')) return reconcileVoidIntent(intent, user, tenant);
  if (intent.operation.startsWith('b2b:')) return reconcileB2BIntent(intent, user, tenant);
  if (intent.operation.startsWith('debt:') || intent.operation.startsWith('debt-')) return reconcileDebtIntent(intent, user, tenant);
  if (intent.operation.startsWith('inventory:')) return reconcileInventoryIntent(intent, user, tenant);
  if (intent.operation.startsWith('cashbox:')) return reconcileCashboxIntent(intent, user, tenant);
  const sale = intent.operation === 'sale' || intent.operation.startsWith('sale:');
  if (!sale) throw Error('Bu amal uchun tekshirilgan qayta yuborish yo‘li topilmadi. Yozuv saqlanadi.');
  if (!hasPermission(user, tenant, 'sales.add_sale')) throw Error('Amalni tekshirish uchun vakolat berilmagan.');
  const scope = captureAuthScope(user.id, tenant.id);
  const current = await getFinancialIntent(intent.operation, user.id, tenant.id);
  assertAuthScope(scope);
  if (!current || current.key !== intent.key || current.fingerprint !== intent.fingerprint) throw Error('Jurnaldagi amal o‘zgardi. Ro‘yxatni yangilang.');
  if (current.status === 'rejected') throw Error('Bu amal rad etilgan. Uni yangi amal sifatida ko‘rib chiqing.');
  if (current.status === 'confirmed' && current.result?.id) return current.result;
  const response = await request('/sales/', {
    method: 'POST', body: { ...current.payload, idempotency_key: current.key },
  });
  assertAuthScope(scope);
  const result = acceptedRetailSale(response);
  if (!result || !Number.isSafeInteger(Number(result.id)) || Number(result.id) < 1) throw Error('Server amal natijasini tasdiqlamadi. Jurnal saqlanadi.');
  await confirmFinancialIdentity(current.operation, user.id, tenant.id, current.key, result);
  assertAuthScope(scope);
  return result;
}
