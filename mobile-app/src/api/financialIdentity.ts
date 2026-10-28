import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { getServerScope, scopedKey } from './environment';
import { recordStore } from '../storage/recordStore';

export interface FinancialIntent {
  version: 1; key: string; fingerprint: string; payload: object; operation: string;
  server: string; userId: number; tenantId: number;
  status: 'pending' | 'confirmed' | 'rejected'; createdAt: string; updatedAt: string;
  result?: any; lastError?: string; reviewRequired?: boolean; reviewAcknowledgedAt?: string;
}
export class PendingOperationError extends Error {
  constructor(public intent: FinancialIntent | null) { super('Oldingi amal natijasini tekshiring; yangi moliyaviy amal hali yuborilmadi.'); }
}
function canonical(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function family(operation: string): 'sale' | 'inventory' | 'void' | 'cashbox' | 'b2b' | 'debt' | null {
  if (operation.startsWith('sale:')) return 'sale';
  if (operation.startsWith('inventory:')) return 'inventory';
  if (operation.startsWith('void-sale-') || operation.startsWith('void-item-')) return 'void';
  if (operation.startsWith('cashbox:')) return 'cashbox';
  if (operation.startsWith('b2b:')) return 'b2b';
  if (operation.startsWith('debt-adjustment:') || operation.startsWith('debt:') || /^debt-\d+$/.test(operation)) return 'debt';
  return null;
}
export async function withFinancialIdentity(operation: string, payload: object, userId?: number, tenantId?: number) {
  const storageKey = scopedKey('intent:' + operation, userId, tenantId), server = getServerScope();
  const legacyKey = 'ilbi_financial_intent:' + userId + ':' + tenantId + ':' + operation;
  const genericSale = operation.startsWith('sale:') ? 'ilbi_financial_intent:' + userId + ':' + tenantId + ':sale' : null;
  if (genericSale && (await AsyncStorage.getItem(genericSale) || await recordStore.read<FinancialIntent>(scopedKey('intent:sale', userId, tenantId)).then(row => Boolean(row && (row.status === 'pending' || row.reviewRequired))))) throw new PendingOperationError(null);
  if (await AsyncStorage.getItem(legacyKey)) throw new PendingOperationError(null);
  const fingerprint = canonical(payload);
  const group = family(operation);
  const lockKey = group ? scopedKey(group + '-lock', userId, tenantId) : null;
  // Preserve pre-lock journals: a domain operation may already be accepted.
  if (lockKey) {
    const legacyPending = (await listFinancialIntents(userId!, tenantId!)).find(intent => family(intent.operation) === group && intent.operation !== operation);
    if (legacyPending) throw new PendingOperationError(legacyPending);
  }
  const intent = await recordStore.transaction([storageKey, ...(lockKey ? [lockKey] : [])], records => {
    const record: FinancialIntent | null = records[storageKey];
    const immutableDraft = operation.startsWith('sale:') || operation.startsWith('inventory:') || operation.startsWith('cashbox:') || operation.startsWith('b2b:') || operation.startsWith('debt:') || operation.startsWith('debt-adjustment:')
      || /^void-(?:sale-\d+|item-\d+-\d+):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(operation);
    if (record?.status === 'pending' || (record?.status === 'confirmed' && immutableDraft)) {
      if (record.fingerprint !== fingerprint) throw new PendingOperationError(record);
      return { updates: {}, result: record };
    }
    if (lockKey && records[lockKey]?.status === 'pending') throw new PendingOperationError(records[lockKey]);
    const now = new Date().toISOString();
    const next: FinancialIntent = { version: 1, key: Crypto.randomUUID(), fingerprint, payload, operation, server, userId: userId!, tenantId: tenantId!, status: 'pending', createdAt: now, updatedAt: now };
    const updates: Record<string, any> = { [storageKey]: next };
    if (record) updates['ilbi:intent-history:' + record.key] = record;
    if (lockKey) updates[lockKey] = next;
    return { updates, result: next };
  });
  return { ...payload, idempotency_key: intent!.key };
}
async function finishIdentity(operation: string, userId: number, tenantId: number, expectedKey: string | undefined, status: 'confirmed' | 'rejected', result?: any, reason?: string) {
  const key = scopedKey('intent:' + operation, userId, tenantId), group = family(operation);
  const lock = group ? scopedKey(group + '-lock', userId, tenantId) : null;
  await recordStore.transaction([key, ...(lock ? [lock] : [])], records => {
    const record: FinancialIntent | null = records[key];
    if (!record) throw Error('Moliyaviy amal yozuvi topilmadi; savat saqlab qolindi.');
    if ((expectedKey && record.key !== expectedKey) || (status === 'rejected' && record.status === 'confirmed')) throw new PendingOperationError(record);
    const updates: Record<string, any> = { [key]: { ...record, status, ...(operation === 'sale' && status === 'confirmed' ? { reviewRequired: !record.reviewAcknowledgedAt } : {}), result: result ?? record.result, lastError: reason, updatedAt: new Date().toISOString() } };
    if (lock && records[lock]?.key === record.key) updates[lock] = null;
    return { updates, result: undefined };
  });
}
export async function confirmFinancialIdentity(operation: string, userId?: number, tenantId?: number, expectedKey?: string, result?: any) {
  if (!userId || !tenantId) throw Error('Moliyaviy tasdiqning hisob va do‘koni topilmadi.');
  await finishIdentity(operation, userId, tenantId, expectedKey, 'confirmed', result);
}
export async function rejectFinancialIdentity(operation: string, userId: number, tenantId: number, expectedKey: string, reason: string) {
  await finishIdentity(operation, userId, tenantId, expectedKey, 'rejected', undefined, reason);
}
export async function listFinancialIntents(userId: number, tenantId: number): Promise<FinancialIntent[]> {
  const entries = await recordStore.entries<FinancialIntent>(scopedKey('intent:', userId, tenantId));
  return entries.map(([, record]) => record).filter(record => record?.version === 1 && record.server === getServerScope() && record.userId === userId && record.tenantId === tenantId && (record.status === 'pending' || record.reviewRequired === true));
}

export async function getFinancialIntent(operation: string, userId: number, tenantId: number): Promise<FinancialIntent | null> {
  return recordStore.read<FinancialIntent>(scopedKey('intent:' + operation, userId, tenantId));
}

export async function acknowledgeLegacySale(operationKey: string, cartId: string, userId: number, tenantId: number) {
  const key = scopedKey('intent:sale', userId, tenantId), alias = scopedKey('intent:sale:' + cartId, userId, tenantId);
  await recordStore.transaction([key, alias], rows => {
    const record: FinancialIntent | null = rows[key];
    if (!record || record.key !== operationKey || record.status !== 'confirmed' || !record.result?.id || !cartId) throw Error('Eski savdo natijasi tasdiqlanmadi.');
    if (rows[alias] && rows[alias].key !== record.key) throw new PendingOperationError(rows[alias]);
    return { updates: { [key]: { ...record, reviewRequired: false, reviewAcknowledgedAt: new Date().toISOString() }, [alias]: { ...record, operation: 'sale:' + cartId, reviewRequired: false } }, result: undefined };
  });
}
