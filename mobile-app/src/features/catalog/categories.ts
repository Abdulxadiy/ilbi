import { formError, type FieldErrors } from '../../api/validation';
export interface Category { id: number; name: string; kod: string; parent: number | null; currency: 'UZS' | 'USD'; is_active: boolean; }
export function parseCategory(value: any): Category {
  if (!value || !Number.isInteger(value.id) || value.id < 1 || typeof value.name !== 'string' || typeof value.kod !== 'string' || !['UZS', 'USD'].includes(value.currency) || (value.parent !== null && (!Number.isInteger(value.parent) || value.parent < 1)) || typeof value.is_active !== 'boolean') throw Error('Kategoriya ma’lumotlari tasdiqlanmadi.');
  return value;
}
export function categoryPayload({ name, kod, parent, currency, id }: { name: string; kod: string; parent: Category | null; currency: string; id?: number }) {
  const errors: FieldErrors = {};
  if (!name.trim() || name.trim().length > 150) errors.name = 'Kategoriya nomi 1–150 belgidan iborat bo‘lsin.';
  if (kod.trim().length > 20) errors.kod = 'Kategoriya kodi 20 belgidan oshmasin.';
  if (!['UZS', 'USD'].includes(currency)) errors.currency = 'Valyutani tanlang.';
  if (parent && (parent.id === id || parent.parent !== null || !parent.is_active)) errors.parent_id = 'Faqat boshqa faol bosh kategoriyani tanlash mumkin.';
  if (Object.keys(errors).length) throw formError(errors, Object.values(errors).join(' '));
  return { name: name.trim(), ...(kod.trim() ? { kod: kod.trim() } : {}), parent_id: parent?.id || null, ...(id && !parent ? { clear_parent: true } : {}), currency: parent?.currency || currency };
}
