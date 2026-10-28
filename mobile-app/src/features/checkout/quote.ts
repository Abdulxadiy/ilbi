import { parseTaxSettings, taxLine, type TaxSettings } from '../../domain/tax';
import { quantityMilli } from '../../domain/quantity';
import { parseMoney } from '../../domain/money';
import type { CartItem } from '../cart/CartContext';
import { parseVariant, type CatalogVariant } from '../catalog/model';
export interface RetailQuote { totalAmount: number; subtotalAmount: number; taxAmount: number; settings: TaxSettings; warnings: string[]; warningKey: string; }
export function buildRetailQuote(items: CartItem[], currentVariants: unknown[], receiptSettings: unknown, partner = false): RetailQuote {
  if (!items.length || items.length > 100) throw Error('Chekda 1 tadan 100 tagacha tovar bo‘lishi kerak.');
  const settings = parseTaxSettings(receiptSettings);
  const variants = new Map<number, CatalogVariant>(currentVariants.map(raw => { const row = parseVariant(raw); return [row.id, row]; }));
  let total = 0n, net = 0n, tax = 0n;
  const warnings: string[] = [], seen = new Set<number>();
  for (const item of items) {
    const variant = variants.get(item.variantId);
    if (!variant || variant.product !== item.productId || seen.has(item.variantId)) throw Error(item.productName + ': tovarni katalogdan qayta tekshiring.');
    seen.add(item.variantId);
    if (variant.currency !== 'UZS' || item.currency === 'USD') throw Error(item.productName + ': USD tovar POS savdosiga qo‘shilmaydi.');
    const required = quantityMilli(item.quantity), available = quantityMilli(variant.stock_quantity, true);
    if (required > available) throw Error(item.productName + ': qoldiq yetarli emas. Mavjud: ' + variant.stock_quantity + ', savatda: ' + item.quantity + '.');
    if (partner && parseMoney(variant.price_partner) <= 0) throw Error(item.productName + ': ulgurji narx belgilanmagan.');
    if (parseMoney(item.unitPrice) <= 0) throw Error(item.productName + ': sotuv narxini tekshiring.');
    for (const batch of variant.expired_batches || []) warnings.push(item.productName + ': ' + (batch.batch_code || 'Partiya') + ' — ' + (batch.expires_on || '—') + ' (' + batch.quantity + ')');
    const line = taxLine(item.quantity, item.unitPrice, settings);
    total += line.totalMinor; net += line.netMinor; tax += line.taxMinor;
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('Jami summa qurilmadagi aniq hisoblash chegarasidan tashqarida.');
  return { totalAmount: Number(total) / 100, subtotalAmount: Number(net) / 100, taxAmount: Number(tax) / 100, settings, warnings, warningKey: JSON.stringify(warnings) };
}
