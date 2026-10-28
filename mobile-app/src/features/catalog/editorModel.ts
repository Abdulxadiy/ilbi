import { parseMoneyMinor } from '../../domain/money';
import { CatalogVariant, parseVariant } from './model';
import { formError, type FieldErrors } from '../../api/validation';
export interface CatalogProduct { id: number; name: string; category: number; is_active: boolean; image: string | null; gallery_images: { id: number; image_url?: string; image?: string }[]; variants: CatalogVariant[]; }
export function parseProduct(value: any): CatalogProduct {
  if (!value || !Number.isInteger(value.id) || value.id < 1 || typeof value.name !== 'string' || !Number.isInteger(value.category) || value.category < 1 || typeof value.is_active !== 'boolean' || !Array.isArray(value.variants)) throw Error('Mahsulot ma’lumotlari tasdiqlanmadi.');
  for (const variant of value.variants) { parseVariant(variant); if (variant.product !== value.id) throw Error('Variant boshqa mahsulotga tegishli.'); }
  return value;
}
export interface VariantDraft { name: string; unit: string; code: string; barcode: string; price_partner: string; price_min: string; price_recommended: string; mxik: string; package_code: string; }
export function variantDraft(value?: CatalogVariant | null): VariantDraft {
  return { name: value?.name || 'Standart', unit: value?.unit || 'dona', code: value?.code || '', barcode: value?.barcode || '', price_partner: String(value?.price_partner ?? ''), price_min: String(value?.price_min ?? ''), price_recommended: String(value?.price_recommended ?? ''), mxik: value?.mxik || '', package_code: value?.package_code || '' };
}
export function pricePayload(value: string) {
  const minor = parseMoneyMinor(value);
  if (minor > 999999999999) throw Error('Narx 9 999 999 999,99 dan oshmasin.');
  return Math.floor(minor / 100) + '.' + String(minor % 100).padStart(2, '0');
}
export function variantPayload(value: VariantDraft) {
  const errors: FieldErrors = {};
  if (!value.name.trim() || value.name.trim().length > 150) errors.name = 'Variant nomi 1–150 belgidan iborat bo‘lsin.';
  if (!['dona', 'kg', 'litr', 'metr'].includes(value.unit)) errors.unit = 'O‘lchov birligini tanlang.';
  if (value.code.trim().length > 64) errors.code = 'Kod 64 belgidan oshmasin.';
  if (value.barcode.trim().length > 64) errors.barcode = 'Shtrix-kod 64 belgidan oshmasin.';
  const mxik = value.mxik.trim(), packageCode = value.package_code.trim();
  if (mxik && !/^\d{17}$/.test(mxik)) errors.mxik = 'MXIK 17 ta raqamdan iborat bo‘lsin.';
  if (packageCode && (packageCode.length > 20 || /[\s\x00-\x1f\x7f]/.test(packageCode))) errors.package_code = 'Qadoq kodi 20 belgidan oshmasin, bo‘sh joy va boshqaruv belgilarini ishlatmang.';
  const prices = {} as Record<'price_partner' | 'price_min' | 'price_recommended', string>;
  for (const key of ['price_partner', 'price_min', 'price_recommended'] as const) {
    try { prices[key] = pricePayload(value[key]); } catch (error: any) { errors[key] = error.message; }
  }
  if (Object.keys(errors).length) throw formError(errors, Object.values(errors).join(' '));
  return { name: value.name.trim(), unit: value.unit, code: value.code.trim(), barcode: value.barcode.trim() || null, ...prices, mxik: mxik || null, package_code: packageCode || null };
}
