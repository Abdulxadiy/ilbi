export interface Category { id: number; name: string; kod: string; parent: number | null; currency: 'UZS' | 'USD'; is_active: boolean; }
export function parseCategory(value: any): Category {
  if (!value || !Number.isInteger(value.id) || value.id < 1 || typeof value.name !== 'string' || typeof value.kod !== 'string' || !['UZS', 'USD'].includes(value.currency) || (value.parent !== null && (!Number.isInteger(value.parent) || value.parent < 1)) || typeof value.is_active !== 'boolean') throw Error('Kategoriya ma’lumotlari tasdiqlanmadi.');
  return value;
}
export function categoryPayload({ name, kod, parent, currency, id }: { name: string; kod: string; parent: Category | null; currency: string; id?: number }) {
  if (!name.trim() || name.trim().length > 150) throw Error('Kategoriya nomi 1–150 belgidan iborat bo‘lsin.');
  if (kod.trim().length > 20) throw Error('Kategoriya kodi 20 belgidan oshmasin.');
  if (!['UZS', 'USD'].includes(currency)) throw Error('Valyutani tanlang.');
  if (parent && (parent.id === id || parent.parent !== null || !parent.is_active)) throw Error('Faqat boshqa faol bosh kategoriyani tanlash mumkin.');
  return { name: name.trim(), ...(kod.trim() ? { kod: kod.trim() } : {}), parent_id: parent?.id || null, ...(id && !parent ? { clear_parent: true } : {}), currency: parent?.currency || currency };
}
