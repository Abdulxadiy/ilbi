import * as Crypto from 'expo-crypto';
import { getServerScope, scopedKey } from '../../api/environment';
import { recordStore } from '../../storage/recordStore';
import type { InventoryAction } from './commands';
import { isUuid } from '../../domain/identifiers';

export type InventoryDraft = { version: 1; id: string; kind: InventoryAction; targetId: number | null; userId: number; tenantId: number; server: string; body: Record<string, any>; updatedAt: string };
const key = (kind: InventoryAction, target: number | null, userId: number, tenantId: number) => scopedKey(`inventory-draft:${kind}:${target || 'new'}`, userId, tenantId);
export async function inventoryDraft(kind: InventoryAction, targetId: number | null, userId: number, tenantId: number, initial: Record<string, any>): Promise<InventoryDraft> {
  const scope = getServerScope();
  const value = await recordStore.read<InventoryDraft>(key(kind, targetId, userId, tenantId));
  if (value) {
    const rowsValid = !['batch-intake', 'dispatch', 'receive', 'return'].includes(kind) || (Array.isArray(value.body?.items) && value.body.items.length <= 100 && value.body.items.every((item: any) => item && typeof item === 'object' && !Array.isArray(item)));
    if (value.version !== 1 || value.kind !== kind || value.targetId !== targetId || value.userId !== userId || value.tenantId !== tenantId || value.server !== scope || !isUuid(value.id) || !value.body || typeof value.body !== 'object' || Array.isArray(value.body) || !rowsValid) throw Error('Ombor qoralamasining manbasi tasdiqlanmadi; yozuv saqlanadi.');
    return value;
  }
  const created: InventoryDraft = { version: 1, id: Crypto.randomUUID(), kind, targetId, userId, tenantId, server: scope, body: initial, updatedAt: new Date().toISOString() };
  await saveInventoryDraft(created); return created;
}
export async function saveInventoryDraft(draft: InventoryDraft) {
  if (draft.server !== getServerScope()) throw Error('Qoralama boshqa serverga tegishli.');
  await recordStore.update<InventoryDraft>(key(draft.kind, draft.targetId, draft.userId, draft.tenantId), previous => {
    if (previous && previous.id !== draft.id) throw Error('Ombor qoralamasi boshqa oynada yangilangan.');
    return { ...draft, updatedAt: new Date().toISOString() };
  });
}
export async function clearInventoryDraft(draft: InventoryDraft) {
  if (draft.server !== getServerScope()) throw Error('Qoralama boshqa serverga tegishli.');
  await recordStore.update<InventoryDraft>(key(draft.kind, draft.targetId, draft.userId, draft.tenantId), previous => {
    if (previous && previous.id !== draft.id) throw Error('Yangi qoralamani eski amal bilan o‘chirish mumkin emas.');
    return null;
  });
}
