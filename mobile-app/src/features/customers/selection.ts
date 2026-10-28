import { isIsoDate } from '../../domain/date';
import { positiveId } from '../reports/model';
import type { SelectedCustomer } from '../cart/CartContext';
export function customerSelection(value: any): SelectedCustomer {
  if (!value || typeof value.name !== 'string' || value.debt_due_date && !isIsoDate(value.debt_due_date)) throw Error('Mijoz ma’lumotlari tasdiqlanmadi.');
  return { id: positiveId(value.id), name: value.name, phoneNumber: String(value.phone_number || ''), ...(value.target_tenant !== undefined ? { targetTenantId: value.target_tenant === null ? null : positiveId(value.target_tenant), targetTenantName: String(value.target_tenant_name || '') } : {}), ...(value.debt_due_date !== undefined ? { debtDueDate: value.debt_due_date || null } : {}) };
}
