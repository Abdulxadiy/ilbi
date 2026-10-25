import { parseMoneyMinor } from '../../domain/money';
import { CatalogVariant, parseVariant } from './model';
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
  if (!value.name.trim() || value.name.trim().length > 150) throw Error('Variant nomi 1–150 belgidan iborat bo‘lsin.');
  if (!['dona', 'kg', 'litr', 'metr'].includes(value.unit)) throw Error('O‘lchov birligini tanlang.');
  if (value.code.trim().length > 64 || value.barcode.trim().length > 64) throw Error('Kod va shtrix-kod 64 belgidan oshmasin.');
  const mxik = value.mxik.trim(), packageCode = value.package_code.trim();
  if (mxik && !/^\d{17}$/.test(mxik)) throw Error('MXIK 17 ta raqamdan iborat bo‘lsin.');
  if (packageCode && (packageCode.length > 20 || /[\s\x00-\x1f\x7f]/.test(packageCode))) throw Error('Qadoq kodi 20 belgidan oshmasin, bo‘sh joy va boshqaruv belgilarini ishlatmang.');
  return { name: value.name.trim(), unit: value.unit, code: value.code.trim(), barcode: value.barcode.trim() || null, price_partner: pricePayload(value.price_partner), price_min: pricePayload(value.price_min), price_recommended: pricePayload(value.price_recommended), mxik: mxik || null, package_code: packageCode || null };
}
