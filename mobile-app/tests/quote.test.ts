import { buildRetailQuote } from '../src/features/checkout/quote';
import { taxLine, parseTaxSettings } from '../src/domain/tax';
const data = require('./contracts/backend.json');
const variant = data.variants.results[0];
const item = { variantId: variant.id, productId: variant.product, productName: 'Rice', unit: 'kg', quantity: 0.125, unitPrice: 11.5, defaultPrice: 11.5 };
const settings = data.tenant.receipt_settings;
describe('Authoritative stock and tax quote', () => {
  test('matches the actual backend fractional non-VAT sale total', () => expect(buildRetailQuote([item], [variant], settings).totalAmount).toBe(Number(data.created_sales[0].total_amount)));
  test('VAT exclusive totals add per-line rounded tax', () => {
    expect(buildRetailQuote([item], [variant], { ...settings, is_vat_payer: true, price_includes_vat: false })).toMatchObject({ subtotalAmount: 1.44, taxAmount: 0.17, totalAmount: 1.61 });
  });
  test('VAT inclusive totals retain the agreed gross price', () => {
    expect(buildRetailQuote([item], [variant], { ...settings, is_vat_payer: true, price_includes_vat: true })).toMatchObject({ subtotalAmount: 1.29, taxAmount: 0.15, totalAmount: 1.44 });
  });
  test('fresh insufficient stock and disappeared variants block payment', () => {
    expect(() => buildRetailQuote([item], [{ ...variant, stock_quantity: '0.124' }], settings)).toThrow('qoldiq yetarli emas');
    expect(() => buildRetailQuote([item], [], settings)).toThrow('qayta tekshiring');
  });
  test('non-UZS items are explicitly refused', () => expect(() => buildRetailQuote([item], [{ ...variant, currency: 'USD' }], settings)).toThrow('USD'));
  test('expired live batches appear in an explicit warning identity', () => {
    const quote = buildRetailQuote([item], [{ ...variant, expired_batches: [{ batch_code: 'OLD-1', expires_on: '2020-01-01', quantity: '1.000' }] }], settings);
    expect(quote.warnings[0]).toContain('OLD-1 — 2020-01-01'); expect(quote.warningKey).toContain('OLD-1');
  });
  test('partner mode requires an authoritative configured partner price', () => expect(() => buildRetailQuote([item], [{ ...variant, price_partner: '0.00' }], settings, true)).toThrow('ulgurji'));
  test('malformed settings cannot silently produce a tax-free quote', () => expect(() => parseTaxSettings({})).toThrow());
  test('per-line rounding is integer arithmetic', () => expect(taxLine('0.125', '11.50', parseTaxSettings(settings)).totalMinor).toBe(144n));
});
