import { assertAuthScope, captureAuthScope, request } from '../../api/client';
import { confirmFinancialIdentity, getFinancialIntent, PendingOperationError, rejectFinancialIdentity, withFinancialIdentity, type FinancialIntent } from '../../api/financialIdentity';
import { formError } from '../../api/validation';
import { isIsoDate } from '../../domain/date';
import { hasPermission } from '../auth/permissions';
import type { UserProfile, UserTenant } from '../auth/AuthContext';
import { positiveId } from '../reports/model';

export const INVENTORY_PROTOCOL = 'ilbi-inventory-idempotency-v1';
export const inventoryActions = {
  intake: ['intake/', 'inventory.add_stock_intake', 'stock.intake'],
  'batch-intake': ['intake/batch/', 'inventory.add_stock_intake', 'stock.batch_intake'],
  adjust: ['adjust/', 'inventory.adjust_stock', 'stock.adjust'],
  'customer-return': ['customer-return/', 'inventory.adjust_stock', 'stock.customer_return'],
  'supplier-return': ['supplier-return/', 'inventory.adjust_stock', 'stock.supplier_return'],
  'write-off': ['write-off/', 'inventory.adjust_stock', 'stock.write_off'],
  dispatch: ['transfers/', 'inventory.transfer_stock', 'transfer.dispatch'],
  receive: ['transfers/{id}/receive/', 'inventory.transfer_stock', 'transfer.receive'],
  return: ['transfers/{id}/return/', 'inventory.transfer_stock', 'transfer.return'],
  'close-discrepancy': ['transfers/{id}/close-discrepancy/', 'inventory.transfer_stock', 'transfer.close_discrepancy'],
} as const;
export type InventoryAction = keyof typeof inventoryActions;
export type InventoryCommand = { version: 1; kind: InventoryAction; targetId: number | null; body: Record<string, any> };
export type InventoryResult = { id: number; kind: InventoryAction; resources: any[] };
type Scope = ReturnType<typeof captureAuthScope>;
export type AcceptedInventory = { operation: string; key: string; userId: number; tenantId: number; scope: Scope; result: InventoryResult };
export class InventoryAcknowledgementError extends Error {
  constructor(public accepted: AcceptedInventory) { super('Server ombor amalini saqladi. Telefondagi tasdiqni yakunlang; yangi amal yuborilmaydi.'); }
}
const stable = (value: any): string => Array.isArray(value) ? '[' + value.map(stable).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}' : JSON.stringify(value);

/** Exact decimal quantities/costs: no floating-point rounding or punctuation guessing. */
export function inventoryDecimal(value: unknown, scale = 3, allowZero = false, field = 'quantity'): string {
  const text = String(value ?? '').trim().replace(/\s/g, '');
  if (!new RegExp('^\\d+(?:[.,]\\d{1,' + scale + '})?$').test(text)) throw formError({ [field]: 'Musbat sonni to‘g‘ri kiriting.' });
  const [whole, fraction = ''] = text.replace(',', '.').split('.');
  const units = BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0'));
  const limit = scale === 3 ? 100000000000000n : 1000000000000n;
  if (units >= limit || (!allowZero && units === 0n)) throw formError({ [field]: 'Qiymat ruxsat etilgan oraliqda bo‘lsin.' });
  return units / 10n ** BigInt(scale) + '.' + (units % 10n ** BigInt(scale)).toString().padStart(scale, '0');
}
const id = (value: unknown, field: string) => {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  try { return positiveId(number); } catch { throw formError({ [field]: 'Ro‘yxatdan to‘g‘ri yozuvni tanlang.' }); }
};
const optionalId = (value: unknown, field: string) => value == null || value === '' ? null : id(value, field);
const text = (value: unknown) => String(value ?? '').trim();

export function inventoryCommand(kind: InventoryAction, raw: any, targetId: number | null = null): InventoryCommand {
  if (!Object.hasOwn(inventoryActions, kind)) throw Error('Ombor amali turi tasdiqlanmadi.');
  if (['receive', 'return', 'close-discrepancy'].includes(kind)) targetId = id(targetId, 'targetId');
  const base = { version: 1 as const, kind, targetId };
  const movement = (row: any, prefix = '', intake = false) => {
    const result: Record<string, any> = {
      product_variant_id: id(row.product_variant_id, prefix + 'product_variant_id'),
      quantity: inventoryDecimal(row.quantity, 3, false, prefix + 'quantity'), note: text(row.note),
    };
    if (intake) {
      result.cost_price = inventoryDecimal(row.cost_price, 2, true, prefix + 'cost_price');
      result.supplier = text(row.supplier); result.batch_code = text(row.batch_code);
      if (text(row.expires_on) && !isIsoDate(text(row.expires_on))) throw formError({ [prefix + 'expires_on']: 'Sanani YYYY-MM-DD ko‘rinishida kiriting.' });
      result.expires_on = text(row.expires_on) || null;
    } else result.batch_id = optionalId(row.batch_id, prefix + 'batch_id');
    return result;
  };
  const lines = (value: unknown) => {
    if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw formError({ items: '1 dan 100 tagacha tovar qatori kerak.' });
    return value;
  };
  if (kind === 'batch-intake') return { ...base, body: { items: lines(raw.items).map((row, index) => movement(row, `items.${index}.`, true)), supplier: text(raw.supplier), faktura_number: text(raw.faktura_number), note: text(raw.note) } };
  if (['intake', 'adjust', 'customer-return', 'supplier-return', 'write-off'].includes(kind)) {
    const body = movement(raw, '', kind === 'intake');
    if (kind === 'adjust') {
      if (!['in', 'out'].includes(raw.direction)) throw formError({ direction: 'Kirim yoki chiqim yo‘nalishini tanlang.' });
      body.direction = raw.direction;
    }
    if (kind !== 'intake' && !body.note) throw formError({ note: 'Ombor amali sababini kiriting.' });
    return { ...base, body };
  }
  if (kind === 'dispatch') return { ...base, body: {
    destination_tenant_id: id(raw.destination_tenant_id, 'destination_tenant_id'), note: text(raw.note),
    items: lines(raw.items).map((row, index) => ({ source_variant_id: id(row.source_variant_id, `items.${index}.source_variant_id`), quantity: inventoryDecimal(row.quantity, 3, false, `items.${index}.quantity`), destination_variant_id: optionalId(row.destination_variant_id, `items.${index}.destination_variant_id`), destination_category_id: optionalId(row.destination_category_id, `items.${index}.destination_category_id`) })),
  } };
  if (kind === 'receive') return { ...base, body: { items: lines(raw.items).map((row, index) => ({ item_id: id(row.item_id, `items.${index}.item_id`), received_quantity: inventoryDecimal(row.received_quantity, 3, true, `items.${index}.received_quantity`), destination_variant_id: optionalId(row.destination_variant_id, `items.${index}.destination_variant_id`), destination_category_id: optionalId(row.destination_category_id, `items.${index}.destination_category_id`), discrepancy_reason: text(row.discrepancy_reason) })) } };
  if (kind === 'return') return { ...base, body: { items: lines(raw.items).map((row, index) => ({ original_item_id: id(row.original_item_id, `items.${index}.original_item_id`), quantity: inventoryDecimal(row.quantity, 3, false, `items.${index}.quantity`) })), note: text(raw.note) } };
  if (text(raw.reason).length < 3) throw formError({ reason: 'Tafovutni yopish sababini kiriting (kamida 3 ta belgi).' });
  return { ...base, body: { reason: text(raw.reason) } };
}

function accepted(command: InventoryCommand, response: any, tenantId: number, key: string, userId: number): InventoryResult {
  const fail = () => { throw Error('Server ombor natijasini to‘liq tasdiqlamadi. Asl amal jurnalida saqlanadi.'); };
  const rows = command.kind === 'batch-intake' ? response : [response];
  if (!Array.isArray(rows) || !rows.length || rows.some(row => !row || !Number.isSafeInteger(row.id) || row.id < 1) || new Set(rows.map(row => row.id)).size !== rows.length) return fail();
  const expected = command.kind === 'batch-intake' ? command.body.items : [command.body];
  const kinds: Record<string, [string, string]> = { intake: ['kirim', 'in'], 'batch-intake': ['kirim', 'in'], adjust: ['tuzatish', command.body.direction], 'customer-return': ['mijoz_qaytardi', 'in'], 'supplier-return': ['yetkazib_beruvchiga_qaytarish', 'out'], 'write-off': ['isrofgarchilik', 'out'] };
  if (kinds[command.kind]) {
    if (rows.length !== expected.length) return fail();
    const unmatched = [...expected];
    for (const row of rows) {
      const index = unmatched.findIndex(item => row.product_variant === item.product_variant_id && inventoryDecimal(row.quantity) === item.quantity && (row.cost_price == null || item.cost_price == null || inventoryDecimal(row.cost_price, 2, true) === item.cost_price));
      if (index < 0 || row.type !== kinds[command.kind][0] || row.direction !== kinds[command.kind][1] || row.created_by !== userId) return fail();
      unmatched.splice(index, 1);
    }
  } else {
    const row = rows[0];
    if (!Array.isArray(row.items) || !['pending', 'delivered', 'delivered_owner', 'discrepancy', 'closed'].includes(row.status)) return fail();
    if (command.kind === 'dispatch' && (row.source_tenant !== tenantId || row.destination_tenant !== command.body.destination_tenant_id || row.request_key !== key || row.created_by !== userId)) return fail();
    if (command.kind === 'return' && (row.source_tenant !== tenantId || row.return_of !== command.targetId || row.kind !== 'return' || row.request_key !== key || row.created_by !== userId)) return fail();
    if (command.kind === 'receive') {
      if (row.id !== command.targetId || row.destination_tenant !== tenantId || row.status === 'pending' || row.received_by !== userId || row.items.length !== command.body.items.length) return fail();
      for (const item of command.body.items) {
        const line = row.items.find((line: any) => line.id === item.item_id);
        if (!line || inventoryDecimal(line.quantity_received, 3, true) !== item.received_quantity) return fail();
      }
    }
    if (command.kind === 'dispatch' || command.kind === 'return') {
      if (row.items.length !== command.body.items.length) return fail();
      for (const item of command.body.items) {
        const line = row.items.find((line: any) => command.kind === 'dispatch' ? line.source_variant === item.source_variant_id : line.original_item === item.original_item_id);
        if (!line || inventoryDecimal(line.quantity_sent) !== item.quantity) return fail();
      }
    }
    if (command.kind === 'close-discrepancy' && (row.id !== command.targetId || row.source_tenant !== tenantId || row.status !== 'closed')) return fail();
  }
  return { id: rows[0].id, kind: command.kind, resources: rows };
}

export async function inventoryCapability(command: InventoryCommand, user: UserProfile, tenant: UserTenant) {
  const definition = inventoryActions[command.kind];
  if (!hasPermission(user, tenant, definition[1])) throw Error('Bu ombor amali uchun faol do‘konda vakolat berilmagan.');
  let capability: any;
  try { capability = await request('/inventory/operations/capabilities/'); }
  catch (failure: any) { if (![404, 405].includes(failure.status)) throw failure; }
  if (capability?.protocol !== INVENTORY_PROTOCOL || !Array.isArray(capability.operations) || !capability.operations.includes(definition[2])) throw Error('Server yangilanishi kerak; tovar harakati yuborilmadi.');
}

export async function confirmAcceptedInventory(value: AcceptedInventory) {
  assertAuthScope(value.scope);
  await confirmFinancialIdentity(value.operation, value.userId, value.tenantId, value.key, value.result);
  assertAuthScope(value.scope);
  return value.result;
}

async function send(command: InventoryCommand, operation: string, key: string, user: UserProfile, tenant: UserTenant, scope: Scope) {
  const body = { ...command.body, idempotency_key: key, ...(['dispatch', 'return'].includes(command.kind) ? { request_key: key } : {}) };
  const result = accepted(command, await request('/inventory/' + inventoryActions[command.kind][0].replace('{id}', String(command.targetId)), { method: 'POST', body }), tenant.id, key, user.id);
  assertAuthScope(scope);
  const value = { operation, key, userId: user.id, tenantId: tenant.id, scope, result };
  try { return await confirmAcceptedInventory(value); } catch { throw new InventoryAcknowledgementError(value); }
}

export async function executeInventory(command: InventoryCommand, draftId: string, user: UserProfile, tenant: UserTenant): Promise<InventoryResult> {
  const scope = captureAuthScope();
  const normalized = inventoryCommand(command.kind, command.body, command.targetId);
  const operation = `inventory:${normalized.kind}:${normalized.targetId || 'new'}:${draftId}`;
  await inventoryCapability(normalized, user, tenant); assertAuthScope(scope);
  const old = await getFinancialIntent(operation, user.id, tenant.id); assertAuthScope(scope);
  if (old?.status === 'confirmed') {
    if (stable(old.payload) !== stable(normalized)) throw new PendingOperationError(old);
    return accepted(normalized, normalized.kind === 'batch-intake' ? old.result?.resources : old.result?.resources?.[0], tenant.id, old.key, user.id);
  }
  const identity = await withFinancialIdentity(operation, normalized, user.id, tenant.id); assertAuthScope(scope);
  try { return await send(normalized, operation, identity.idempotency_key, user, tenant, scope); }
  catch (failure: any) {
    // A rejection of a replay cannot prove the earlier attempt was rejected.
    if (old?.status !== 'pending' && [400, 403, 404, 422].includes(failure.status)) {
      assertAuthScope(scope); await rejectFinancialIdentity(operation, user.id, tenant.id, identity.idempotency_key, failure.message);
    }
    throw failure;
  }
}

export async function reconcileInventoryIntent(intent: FinancialIntent, user: UserProfile, tenant: UserTenant): Promise<InventoryResult> {
  const scope = captureAuthScope();
  if (intent.userId !== user.id || intent.tenantId !== tenant.id || intent.server !== scope.server) throw Error('Ombor amali boshqa hisob, server yoki do‘konga tegishli.');
  const raw = intent.payload as InventoryCommand;
  if (raw.version !== 1) throw Error('Ombor jurnali talqini tasdiqlanmadi.');
  const command = inventoryCommand(raw.kind, raw.body, raw.targetId);
  if (!intent.operation.startsWith(`inventory:${command.kind}:${command.targetId || 'new'}:`)) throw Error('Ombor amali yo‘nalishi jurnaldagi yozuvga mos emas.');
  await inventoryCapability(command, user, tenant); assertAuthScope(scope);
  const current = await getFinancialIntent(intent.operation, user.id, tenant.id); assertAuthScope(scope);
  if (!current || current.key !== intent.key || current.fingerprint !== intent.fingerprint || current.status === 'rejected') throw Error('Asl ombor amali o‘zgargan yoki rad etilgan.');
  if (current.status === 'confirmed') return accepted(command, command.kind === 'batch-intake' ? current.result?.resources : current.result?.resources?.[0], tenant.id, current.key, user.id);
  return send(command, current.operation, current.key, user, tenant, scope);
}
