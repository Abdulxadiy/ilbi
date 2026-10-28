import { parseMoney } from '../../domain/money';
import type { CartItem } from '../cart/CartContext';
export interface CatalogVariant {
  id: number; product: number; product_name: string; name: string; unit: string;
  price_recommended: string | number; price_min: string | number; price_partner: string | number;
  barcode: string | null; stock_quantity: string | number; currency: 'UZS' | 'USD';
  is_active?: boolean; sku?: string; code?: string; mxik?: string | null; package_code?: string | null;
  category_id?: number | null; category_name?: string; image?: string | null; images?: string[];
  expired_batches?: { batch_id?: number; batch_code?: string; expires_on?: string; quantity?: string; days_left?: number; status?: string }[];
}
export function parseVariant(value: any): CatalogVariant {
  if (!value || !Number.isInteger(value.id) || value.id < 1 || !Number.isInteger(value.product) || value.product < 1 || typeof value.product_name !== 'string' || typeof value.unit !== 'string' || !['UZS', 'USD'].includes(value.currency)) throw Error('Serverdagi tovar ma’lumotlari tasdiqlanmadi.');
  for (const key of ['price_recommended', 'price_min', 'price_partner']) parseMoney(value[key]);
  if (!Number.isFinite(Number(value.stock_quantity))) throw Error('Tovar qoldig‘i tasdiqlanmadi.');
  return value;
}
export function variantToCart(value: CatalogVariant, partner = false): Omit<CartItem, 'quantity' | 'unitPrice'> {
  const item = parseVariant(value);
  const retailPrice = parseMoney(item.price_recommended) || parseMoney(item.price_min);
  const price = partner ? parseMoney(item.price_partner) || retailPrice : retailPrice;
  if (price <= 0) throw Error('Tovarga avval sotuv narxini belgilang.');
  return { variantId: item.id, productId: item.product, productName: item.product_name, variantName: item.name,
    unit: item.unit, defaultPrice: retailPrice || price, barcode: item.barcode || undefined, imageUrl: item.image || undefined,
    currency: item.currency, minimumPrice: parseMoney(item.price_min), partnerPrice: parseMoney(item.price_partner),
  };
}
