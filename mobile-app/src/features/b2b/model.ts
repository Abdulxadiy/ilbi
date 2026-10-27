import { formError } from '../../api/validation';
import { quantityMilli } from '../../domain/quantity';
import { parseMoneyMinor } from '../../domain/money';
import { positiveId, escapeHtml, formatAmount } from '../reports/model';

export type B2BKind = 'accept' | 'reject' | 'receive' | 'close_discrepancy';
export type B2BLine = { id: number; product_name: string; product_variant_name: string; unit: string; quantity: string; unit_price: string; b2b_accepted_quantity: string; voided_quantity: string; b2b_rejected_quantity: string; b2b_return_pending_quantity: string; b2b_discrepancy_closed_quantity: string };
export type B2BSale = { id: number; receipt_number: string; status: string; currency: 'UZS' | 'USD'; source_tenant_name: string; b2b_target_tenant_name: string; total_amount: string; refunded_amount: string; net_amount: string; b2b_expires_at: string | null; items: B2BLine[] };
export type B2BDetail = { direction: 'incoming' | 'outgoing'; sale: B2BSale };
export type B2BPayload = { sale_id: number; kind: B2BKind; reason?: string; items?: { sale_item_id: number; quantity?: string; accepted_quantity?: string; target_variant_id?: number; target_category_id?: number }[] };
export type B2BDraft = B2BPayload & { draftId: string };
const kinds: B2BKind[] = ['accept', 'reject', 'receive', 'close_discrepancy'];
const statuses = ['b2b_pending', 'b2b_partially_accepted', 'b2b_accepted', 'b2b_rejected', 'b2b_return_pending', 'b2b_cancelled', 'voided', 'partially_voided'];
export const b2bStatus = (value: string) => ({ b2b_pending: 'Qabul kutilmoqda', b2b_partially_accepted: 'Qisman qabul qilingan', b2b_accepted: 'Qabul qilingan', b2b_rejected: 'Rad etilgan', b2b_return_pending: 'Jismoniy qaytish kutilmoqda', b2b_cancelled: 'Bekor qilingan' }[value] || value);
const quantity = (value: any) => { quantityMilli(value, true); return String(value); };
const money = (value: any) => { if (value == null) throw Error('B2B summasi qaytmadi.'); parseMoneyMinor(String(value), true); return String(value); };
export function parseB2BSale(value: any): B2BSale {
  if (!value || !Array.isArray(value.items) || !statuses.includes(value.status) || !['UZS', 'USD'].includes(value.currency)) throw Error('Server B2B ma’lumotlarini tasdiqlamadi.');
  return { ...value, id: positiveId(value.id), receipt_number: String(value.receipt_number || value.id), source_tenant_name: String(value.source_tenant_name || value.tenant_name || ''), b2b_target_tenant_name: String(value.b2b_target_tenant_name || ''), total_amount: money(value.total_amount), refunded_amount: money(value.refunded_amount), net_amount: money(value.net_amount), b2b_expires_at: value.b2b_expires_at || null,
    items: value.items.map((row: any) => { const result = { ...row, id: positiveId(row.id), product_name: String(row.product_name || ''), product_variant_name: String(row.product_variant_name || ''), unit: String(row.unit || ''), unit_price: money(row.unit_price) }; for (const field of ['quantity', 'b2b_accepted_quantity', 'voided_quantity', 'b2b_rejected_quantity', 'b2b_return_pending_quantity', 'b2b_discrepancy_closed_quantity']) result[field] = quantity(row[field]); return result; }) };
}
export function parseB2BDetail(value: any): B2BDetail {
  if (!['incoming', 'outgoing'].includes(value?.direction)) throw Error('B2B yo‘nalishi tasdiqlanmadi.');
  return { direction: value.direction, sale: parseB2BSale(value.sale) };
}
export function pendingQuantity(line: B2BLine): bigint {
  return quantityMilli(line.quantity, true) - ['b2b_accepted_quantity', 'voided_quantity', 'b2b_rejected_quantity', 'b2b_return_pending_quantity', 'b2b_discrepancy_closed_quantity'].reduce((sum, key) => sum + quantityMilli(line[key as keyof B2BLine], true), 0n);
}
export const decimalQuantity = (value: bigint) => `${value / 1000n}.${(value % 1000n).toString().padStart(3, '0')}`;
export function b2bEndpoint(payload: B2BPayload) {
  positiveId(payload.sale_id);
  const suffix = { accept: 'accept', reject: 'reject', receive: 'returns/receive', close_discrepancy: 'returns/close-discrepancy' }[payload.kind];
  if (!suffix) throw Error('B2B amali tasdiqlanmadi.');
  return `/sales/b2b/${payload.sale_id}/${suffix}/`;
}
export function b2bCommand(draft: B2BDraft) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(draft.draftId) || !kinds.includes(draft.kind)) throw Error('B2B amal identity’si tasdiqlanmadi.');
  positiveId(draft.sale_id);
  const errors: Record<string, string> = {}, payload: B2BPayload = { sale_id: draft.sale_id, kind: draft.kind };
  if (draft.kind !== 'accept') { payload.reason = String(draft.reason || '').trim(); if (!payload.reason) errors.reason = 'Amal sababini kiriting.'; }
  if (draft.kind !== 'reject') {
    if (!Array.isArray(draft.items) || !draft.items.length) errors.items = 'Kamida bitta tovar miqdorini kiriting.';
    const seen = new Set<number>();
    payload.items = (draft.items || []).map((row, index) => {
      const result = { ...row }; positiveId(row.sale_item_id);
      if (seen.has(row.sale_item_id)) errors.items = 'Bir tovar qatori ikki marta yuborilmasin.'; seen.add(row.sale_item_id);
      const field = draft.kind === 'accept' ? 'accepted_quantity' : 'quantity';
      try { result[field] = decimalQuantity(quantityMilli(row[field]!, draft.kind === 'accept')); } catch { errors[`items.${index}.${field}`] = 'Miqdorni 3 kasr xonasigacha to‘g‘ri kiriting.'; }
      if (row.target_variant_id != null) positiveId(row.target_variant_id);
      if (row.target_category_id != null) positiveId(row.target_category_id);
      return result;
    });
    if (draft.kind === 'accept' && payload.items.every(row => row.accepted_quantity === '0.000')) errors.items = 'Kamida bitta tovarni qabul qiling.';
  }
  if (Object.keys(errors).length) throw formError(errors);
  return { operation: `b2b:${draft.kind}:${draft.draftId}`, payload, endpoint: b2bEndpoint(payload) };
}
export function commandFromB2BIntent(operation: string, value: any) {
  const match = /^b2b:(accept|reject|receive|close_discrepancy):([a-f0-9-]{36})$/.exec(operation);
  if (!match || value?.kind !== match[1]) throw Error('Asl B2B amal ma’lumoti mos emas.');
  return b2bCommand({ ...value, draftId: match[2] });
}
export function b2bBody(payload: B2BPayload, key: string) {
  return { ...(payload.items ? { items: payload.items } : {}), ...(payload.reason ? { reason: payload.reason } : {}), operation_id: key, ...(['receive', 'close_discrepancy'].includes(payload.kind) ? { idempotency_key: key } : {}) };
}
export function assertB2BResult(value: any, payload: B2BPayload, key: string, userId: number, tenantId: number) {
  const ack = value?.b2b_operation;
  if (!ack || ack.operation_id !== key || ack.kind !== payload.kind || ack.actor_id !== userId || ack.tenant_id !== tenantId || ack.sale_id !== payload.sale_id) throw Error('Server asl B2B amalini to‘liq tasdiqlamadi. Jurnalni tekshiring.');
  const sale = parseB2BSale(['accept', 'reject'].includes(payload.kind) ? value : value.sale);
  if (sale.id !== payload.sale_id) throw Error('B2B natijasi boshqa savdoga tegishli.');
  if (['receive', 'close_discrepancy'].includes(payload.kind)) { positiveId(ack.resource_id); if (value[payload.kind === 'receive' ? 'receipt_id' : 'closure_id'] !== ack.resource_id) throw Error('B2B qaytish tasdig‘i mos emas.'); }
  return value;
}
export function b2bHtml(detail: B2BDetail) {
  const sale = detail.sale;
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif;padding:24px}table{width:100%;border-collapse:collapse}th,td{padding:8px;text-align:left;border-bottom:1px solid #ddd}</style></head><body><h1>ILBI — B2B hujjati</h1><h2>${escapeHtml(sale.receipt_number)}</h2><p>${escapeHtml(detail.direction === 'incoming' ? sale.source_tenant_name : sale.b2b_target_tenant_name)}</p><p>${escapeHtml(b2bStatus(sale.status))}</p><table><tr><th>Tovar</th><th>Jo‘natilgan</th><th>Qabul</th><th>Qaytish</th><th>Narx</th></tr>${sale.items.map(line => `<tr><td>${escapeHtml(line.product_name)} ${escapeHtml(line.product_variant_name)}</td><td>${escapeHtml(line.quantity)} ${escapeHtml(line.unit)}</td><td>${escapeHtml(line.b2b_accepted_quantity)}</td><td>${escapeHtml(line.b2b_return_pending_quantity)}</td><td>${formatAmount(line.unit_price)} ${sale.currency}</td></tr>`).join('')}</table><p>Jami: ${formatAmount(sale.total_amount)} ${sale.currency}</p><p>Qaytarilgan: ${formatAmount(sale.refunded_amount)} ${sale.currency}</p><p>Qolgan: ${formatAmount(sale.net_amount)} ${sale.currency}</p></body></html>`;
}
