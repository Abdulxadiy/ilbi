import { positiveId, requiredDecimal } from '../reports/model';
import { quantityMilli } from '../../domain/quantity';
import { parseMoneyMinor } from '../../domain/money';
import { formError } from '../../api/validation';
export const saleStatuses = { completed: 'Yakunlangan', partially_voided: 'Qisman qaytarilgan', voided: 'Bekor qilingan', b2b_pending: 'B2B: kutilmoqda', b2b_partially_accepted: 'B2B: qisman qabul', b2b_accepted: 'B2B: qabul qilingan', b2b_rejected: 'B2B: rad etilgan', b2b_return_pending: 'B2B: qaytarish kutilmoqda' };
export type SaleLine = { id: number; product_name: string; product_variant_name?: string; quantity: string; voided_quantity: string; unit_price: string; total_price: string; unit: string; status: string; [key: string]: any };
export type SavedSale = { id: number; receipt_number: string; currency: 'UZS' | 'USD'; status: keyof typeof saleStatuses; total_amount: string; refunded_amount: string; net_amount: string; items: SaleLine[]; b2b_target_tenant: number | null; created_at: string; payment_type: 'cash' | 'card' | 'debt'; [key: string]: any };
export function parseSavedSale(value: any): SavedSale {
  if (!value || !Array.isArray(value.items) || !['UZS', 'USD'].includes(value.currency) || !['cash', 'card', 'debt'].includes(value.payment_type) || !Object.prototype.hasOwnProperty.call(saleStatuses, value.status)) throw Error('Server savdo ma’lumotini tasdiqlamadi.');
  const items = value.items.map((raw: any) => {
    const quantity = requiredDecimal(raw.quantity), voided_quantity = requiredDecimal(raw.voided_quantity);
    if (quantityMilli(voided_quantity, true) > quantityMilli(quantity)) throw Error('Qaytarilgan miqdor sotilgan miqdordan katta.');
    return { ...raw, id: positiveId(raw.id), product_name: String(raw.product_name || ''), quantity, voided_quantity, unit_price: requiredDecimal(raw.unit_price), total_price: requiredDecimal(raw.total_price), unit: String(raw.unit || ''), status: String(raw.status || '') };
  });
  const total_amount = requiredDecimal(value.total_amount), refunded_amount = requiredDecimal(value.refunded_amount), net_amount = requiredDecimal(value.net_amount);
  if (parseMoneyMinor(total_amount) - parseMoneyMinor(refunded_amount) !== parseMoneyMinor(net_amount)) throw Error('Serverning savdo va qaytarish summalari mos kelmadi.');
  return { ...value, id: positiveId(value.id), receipt_number: String(value.receipt_number || value.id), total_amount, refunded_amount, net_amount, items, b2b_target_tenant: value.b2b_target_tenant == null ? null : positiveId(value.b2b_target_tenant), created_at: String(value.created_at || '') };
}
export const voidDraftUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export type VoidDraft = { draftId: string; saleId: number; itemId?: number; reason: string; quantity?: string };
export type VoidCommand = { operation: string; endpoint: string; saleId: number; itemId?: number; payload: { reason: string; quantity?: string } };
export function voidCommand(draft: VoidDraft): VoidCommand {
  if (!voidDraftUuid.test(draft.draftId)) throw Error('Qaytarish oynasining asl raqami topilmadi. Oynani qayta oching.');
  positiveId(draft.saleId);
  const reason = draft.reason.trim();
  const fields: Record<string, string> = {};
  if (!reason) fields.reason = 'Qaytarish sababini kiriting.';
  let quantity: string | undefined;
  if (draft.itemId != null) {
    positiveId(draft.itemId);
    try { const milli = quantityMilli(draft.quantity || ''); quantity = `${milli / 1000n}.${(milli % 1000n).toString().padStart(3, '0')}`; }
    catch (error: any) { fields.quantity = error.message; }
  }
  if (Object.keys(fields).length) throw formError(fields);
  const itemId = draft.itemId;
  return { saleId: draft.saleId, ...(itemId ? { itemId } : {}), operation: (itemId ? `void-item-${draft.saleId}-${itemId}` : `void-sale-${draft.saleId}`) + ':' + draft.draftId, endpoint: itemId ? `/sales/items/${itemId}/void/` : `/sales/${draft.saleId}/void/`, payload: { reason, ...(quantity ? { quantity } : {}) } };
}
export function commandFromIntent(operation: string, payload: any): VoidCommand | null {
  const [legacy, draftId, extra] = operation.split(':');
  if (extra !== undefined || draftId !== undefined && !voidDraftUuid.test(draftId)) return null;
  const full = legacy.match(/^void-sale-([1-9]\d*)$/), partial = legacy.match(/^void-item-([1-9]\d*)-([1-9]\d*)$/);
  if (!full && !partial) return null;
  // Older journals have fixed IDs. Only new dialogs get a unique immutable draft ID.
  const command = voidCommand({ draftId: draftId || '00000000-0000-4000-8000-000000000000', saleId: Number((full || partial)![1]), ...(partial ? { itemId: Number(partial[2]), quantity: payload?.quantity } : {}), reason: typeof payload?.reason === 'string' ? payload.reason : '' });
  return { ...command, operation };
}
export function assertVoidResult(value: any, command: VoidCommand, key: string, actorId: number, tenantId: number) {
  const receipt = value?.void_operation;
  if (!receipt || receipt.actor_id !== actorId || receipt.tenant_id !== tenantId || receipt.idempotency_key !== key || receipt.kind !== (command.itemId ? 'item' : 'sale') || receipt.sale_id !== command.saleId || receipt.sale_item_id !== (command.itemId || null) || receipt.reason !== command.payload.reason || value.id !== (command.itemId || command.saleId)) throw Error('Server bekor qilishning asl kalitini tasdiqlamadi. Jurnal saqlanadi.');
  if (command.itemId && quantityMilli(receipt.quantity) !== quantityMilli(command.payload.quantity!)) throw Error('Server qaytarilgan miqdorni tasdiqlamadi. Jurnal saqlanadi.');
  if (!['UZS', 'USD'].includes(receipt.result?.currency) || !['voided', 'partially_voided'].includes(receipt.result?.sale_status)) throw Error('Server bekor qilish natijasini tasdiqlamadi.');
  parseMoneyMinor(requiredDecimal(receipt.result.refunded_amount));
  parseMoneyMinor(requiredDecimal(receipt.result.sale_net_amount));
  return value;
}
export function validDate(value: string) { return !value || /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
