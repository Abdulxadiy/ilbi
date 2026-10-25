import { parseVariant, variantToCart } from '../src/features/catalog/model';
const serialized = { id: 9, product: 41, product_name: 'Rice', name: '1kg', unit: 'kg', price_recommended: '11.50', price_min: '10.00', price_partner: '11.00', stock_quantity: '2.750', barcode: '478001', currency: 'UZS', image: 'https://example.test/rice.jpg' };
describe('Real ProductVariantOutputSerializer contract', () => {
  test('maps product (not a fabricated product_id) into the durable cart', () => {
    expect(variantToCart(parseVariant(serialized))).toMatchObject({ variantId: 9, productId: 41, defaultPrice: 11.5, partnerPrice: 11, currency: 'UZS', imageUrl: serialized.image });
  });
  test('rejects a missing parent instead of saving a corrupt draft', () => {
    expect(() => parseVariant({ ...serialized, product: undefined, product_id: 41 })).toThrow();
  });
  test('rejects invalid server prices and unsupported currencies', () => {
    expect(() => parseVariant({ ...serialized, price_min: 'NaN' })).toThrow();
    expect(() => parseVariant({ ...serialized, currency: 'EUR' })).toThrow();
  });
  test('uses the actual minimum if no recommended price was configured', () => {
    expect(variantToCart({ ...serialized, currency: 'UZS', price_recommended: '0.00' }).defaultPrice).toBe(10);
  });
});

test('a partner-only price can be added in wholesale mode and remains rejected in retail mode', () => {
  const value = { ...serialized, currency: 'UZS' as const, price_recommended: '0.00', price_min: '0.00', price_partner: '8.50' };
  expect(variantToCart(value, true).partnerPrice).toBe(8.5);
  expect(() => variantToCart(value)).toThrow();
});
