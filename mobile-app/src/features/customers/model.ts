import { requiredDecimal, positiveId } from '../reports/model';
import { isIsoDate } from '../../domain/date';
import { formError } from '../../api/validation';
export type Customer = { id: number; name: string; phone_number: string; target_tenant: number | null; target_tenant_name: string; debt_balance_uzs: string; debt_balance_usd: string; debt_due_date: string | null; note: string; is_active: boolean; last_payment?: any };
export function parseCustomer(value: any): Customer {
  if (!value || typeof value.name !== 'string') throw Error('Server mijoz ma’lumotini tasdiqlamadi.');
  if (value.debt_due_date && !isIsoDate(value.debt_due_date)) throw Error('Mijoz qarz muddati tasdiqlanmadi.');
  return { id: positiveId(value.id), name: value.name, phone_number: String(value.phone_number || ''), target_tenant: value.target_tenant == null ? null : positiveId(value.target_tenant), target_tenant_name: String(value.target_tenant_name || ''), debt_balance_uzs: requiredDecimal(value.debt_balance_uzs), debt_balance_usd: requiredDecimal(value.debt_balance_usd), debt_due_date: value.debt_due_date || null, note: String(value.note || ''), is_active: value.is_active !== false, last_payment: value.last_payment };
}
export type CustomerDraft = { name: string; phone_number: string; note: string; target_tenant_code: string; debt_due_date: string };
export const customerDraft = (row?: Customer): CustomerDraft => ({ name: row?.name || '', phone_number: row?.phone_number || '', note: row?.note || '', target_tenant_code: '', debt_due_date: row?.debt_due_date || '' });
export function customerBody(draft: CustomerDraft, editing: boolean) {
  const fields: Record<string, string> = {};
  if (!draft.name.trim() || draft.name.trim().length > 150) fields.name = 'Mijoz ismini kiriting (150 belgigacha).';
  if (!editing && !/^\+?[\d\s()-]{7,20}$/.test(draft.phone_number.trim())) fields.phone_number = 'Telefon raqamini tekshiring.';
  if (!editing && draft.target_tenant_code.trim() && !/^[A-Z0-9]{1,12}$/i.test(draft.target_tenant_code.trim())) fields.target_tenant_code = 'Faol boshqa do‘konning kodini kiriting (12 belgigacha).';
  if (draft.debt_due_date && !isIsoDate(draft.debt_due_date)) fields.debt_due_date = 'Sanani YYYY-MM-DD shaklida to‘g‘ri kiriting.';
  if (Object.keys(fields).length) throw formError(fields);
  return { name: draft.name.trim(), note: draft.note.trim(), debt_due_date: draft.debt_due_date || null, ...(!editing ? { phone_number: draft.phone_number.trim(), target_tenant_code: draft.target_tenant_code.trim().toUpperCase() } : {}) };
}
export type CustomerPayment = { id: number; counterparty: number; amount: string; currency: 'UZS' | 'USD'; payment_type: 'cash' | 'card' | 'none'; is_correction: boolean; paid_at: string; recorded_by_name: string; branch_name: string; note: string; exchange_rate: string | null; converted_amount_uzs: string | null };
export function parseCustomerPayment(value: any, customerId: number): CustomerPayment {
  if (!value || value.counterparty !== customerId || !['UZS', 'USD'].includes(value.currency) || !['cash', 'card', 'none'].includes(value.payment_type) || typeof value.is_correction !== 'boolean' || !Number.isFinite(Date.parse(value.paid_at))) throw Error('Mijoz to‘lov yozuvi tasdiqlanmadi.');
  return { id: positiveId(value.id), counterparty: value.counterparty, amount: requiredDecimal(value.amount), currency: value.currency, payment_type: value.payment_type, is_correction: value.is_correction, paid_at: value.paid_at, recorded_by_name: String(value.recorded_by_name || ''), branch_name: String(value.branch_name || ''), note: String(value.note || ''), exchange_rate: value.exchange_rate == null ? null : requiredDecimal(value.exchange_rate), converted_amount_uzs: value.converted_amount_uzs == null ? null : requiredDecimal(value.converted_amount_uzs) };
}
