import * as Crypto from 'expo-crypto';
import type { CartItem, SelectedCustomer } from './CartContext';
import { scopedKey, getServerScope } from '../../api/environment';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isIsoDate } from '../../domain/date';

export interface PaymentDraft { method: 'cash' | 'card' | 'debt'; cashReceived: string; dueDate: string; }
export const emptyPayment = (): PaymentDraft => ({ method: 'cash', cashReceived: '', dueDate: '' });
export interface CartDraft {
  version: 3; id: string; payment: PaymentDraft; server: string; userId: number; tenantId: number;
  items: CartItem[]; customer: SelectedCustomer | null; partner?: boolean;
}
export const cartDraftKey = (userId: number, tenantId: number) => scopedKey('cart', userId, tenantId);
export function validateCartDraft(input: unknown, userId: number, tenantId: number): CartDraft {
  const draft = input as CartDraft;
  if (!draft || ![2, 3].includes(draft.version) || draft.server !== getServerScope() || draft.userId !== userId || draft.tenantId !== tenantId || !Array.isArray(draft.items)) throw Error('Qoralama manbasi yoki talqini tasdiqlanmadi. Ma’lumot saqlab qolindi.');
  const variants = new Set();
  for (const item of draft.items) {
    if (!item || !Number.isInteger(item.variantId) || item.variantId < 1 || !Number.isInteger(item.productId) || item.productId < 1 || typeof item.productName !== 'string' || !item.productName || typeof item.unit !== 'string'
      || typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0 || Math.abs(Math.round(item.quantity * 1000) - item.quantity * 1000) > 0.000001
      || typeof item.unitPrice !== 'number' || !Number.isFinite(item.unitPrice) || item.unitPrice <= 0 || typeof item.defaultPrice !== 'number' || !Number.isFinite(item.defaultPrice) || item.defaultPrice < 0 || variants.has(item.variantId)) throw Error('Qoralamadagi tovar ma’lumotini tekshirish kerak. Asl nusxa o‘zgartirilmadi.');
    variants.add(item.variantId);
  }
  if (draft.customer && (!Number.isInteger(draft.customer.id) || draft.customer.id < 1 || typeof draft.customer.name !== 'string')) throw Error('Qoralamadagi mijoz tasdiqlanmadi.');
  if (draft.customer && (draft.customer.debtDueDate != null && !isIsoDate(draft.customer.debtDueDate) || draft.customer.targetTenantId != null && (!Number.isSafeInteger(draft.customer.targetTenantId) || draft.customer.targetTenantId < 1) || draft.customer.targetTenantName !== undefined && typeof draft.customer.targetTenantName !== 'string')) throw Error('Qoralamadagi mijozning B2B yoki sana ma’lumotlari tasdiqlanmadi. Asl nusxa saqlandi.');
  if (draft.version === 3 && (typeof draft.id !== 'string' || !draft.id || !draft.payment || !['cash', 'card', 'debt'].includes(draft.payment.method) || typeof draft.payment.cashReceived !== 'string' || typeof draft.payment.dueDate !== 'string')) throw Error('To‘lov qoralamasi tasdiqlanmadi. Asl nusxa saqlandi.');
  return draft.version === 3 ? draft : newDraft(userId, tenantId, draft.items, draft.customer, { partner: draft.partner });
}
export function newDraft(userId: number, tenantId: number, items: CartItem[] = [], customer: SelectedCustomer | null = null, options: Partial<Pick<CartDraft, 'id' | 'payment' | 'partner'>> = {}): CartDraft {
  return { version: 3, id: options.id || Crypto.randomUUID(), payment: options.payment || emptyPayment(), partner: options.partner || false, server: getServerScope(), userId, tenantId, items, customer };
}
export async function readCartDraft(userId: number, tenantId: number): Promise<CartDraft | null> {
  const raw = await AsyncStorage.getItem(cartDraftKey(userId, tenantId));
  if (raw === null) return null;
  const parsed = JSON.parse(raw), draft = validateCartDraft(parsed, userId, tenantId);
  if (parsed.version === 2) {
    await AsyncStorage.setItem(cartDraftKey(userId, tenantId) + ':migration-v2', raw);
    await AsyncStorage.setItem(cartDraftKey(userId, tenantId), JSON.stringify(draft));
  }
  return draft;
}
export async function readLegacyCart(userId: number, tenantId: number): Promise<unknown> {
  const raw = await AsyncStorage.getItem('ilbi_cart_draft:' + userId + ':' + tenantId);
  return raw ? JSON.parse(raw) : null;
}
