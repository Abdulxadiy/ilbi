import { parseMoneyMinor } from './money';
import { quantityMilli } from './quantity';
export interface TaxSettings { is_vat_payer: boolean; vat_rate: string; price_includes_vat: boolean; }
export function parseTaxSettings(value: any): TaxSettings {
  if (!value || typeof value.is_vat_payer !== 'boolean' || typeof value.price_includes_vat !== 'boolean' || typeof value.vat_rate !== 'string') throw Error('Soliq sozlamalari tasdiqlanmadi.');
  const rate = BigInt(parseMoneyMinor(value.vat_rate));
  if (rate > 10000n) throw Error('Soliq stavkasini tekshiring.');
  return { is_vat_payer: value.is_vat_payer, vat_rate: value.vat_rate, price_includes_vat: value.price_includes_vat };
}
const round = (value: bigint, divisor: bigint) => (value + divisor / 2n) / divisor;
export function taxLine(quantity: string | number, price: string | number, settings: TaxSettings) {
  const amount = round(quantityMilli(quantity) * BigInt(parseMoneyMinor(price)), 1000n);
  const rate = settings.is_vat_payer ? BigInt(parseMoneyMinor(settings.vat_rate)) : 0n;
  const net = settings.price_includes_vat ? round(amount * 10000n, 10000n + rate) : amount;
  const tax = settings.price_includes_vat ? amount - net : round(amount * rate, 10000n);
  return { netMinor: net, taxMinor: tax, totalMinor: net + tax };
}
