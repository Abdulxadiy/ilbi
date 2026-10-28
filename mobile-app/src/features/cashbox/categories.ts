import { recordStore } from '../../storage/recordStore';
import { scopedKey } from '../../api/environment';
export type CategoryKind = 'income' | 'expense';
export const defaultCategories: Record<CategoryKind, string[]> = {
  expense: ['Kommunal to‘lovlar', 'Ijara to‘lovi', 'Xodimlar xarajati', 'Xo‘jalik / Tozalik', 'Yetkazib berish', 'Kantselyariya / Paketlar', 'Boshqa xarajat'],
  income: ['Qo‘shimcha xizmat', 'Yetkazib berish haqi', 'Mijoz to‘lovi', 'Kassa to‘ldirish (Qaytim)', 'Boshqa kirim'],
};
const normalized = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()) && item.length <= 255).map(item => item.trim()))].slice(0, 50) : [];
const key = (kind: CategoryKind, user: number, tenant: number) => scopedKey('cashbox:categories:' + kind, user, tenant);
export async function readCategories(kind: CategoryKind, user: number, tenant: number) {
  return normalized(await recordStore.read(key(kind, user, tenant)));
}
export async function saveCategory(kind: CategoryKind, user: number, tenant: number, name: string, remove = false) {
  const value = name.trim();
  if (!value || value.length > 255) throw Error('Nom 1–255 ta belgidan iborat bo‘lsin.');
  return normalized(await recordStore.update<string[]>(key(kind, user, tenant), previous => {
    const rows = normalized(previous).filter(item => item !== value);
    if (!remove && rows.length >= 50) throw Error('50 ta saqlangan nom bor. Avval keraksizini o‘chiring.');
    return remove ? rows : [...rows, value];
  }));
}
