import { acceptedRetailSale } from '../src/features/checkout/saleResponse';
import { parseVariant, variantToCart } from '../src/features/catalog/model';
import { validateProfile } from '../src/features/auth/profile';
const contract = require('./contracts/backend.json');
describe('Mobile adapters against real isolated Django API responses', () => {
  test('many=True sale creation is accepted, with the server-rounded fractional total', () => {
    const sale = acceptedRetailSale(contract.created_sales);
    expect(Number(sale.total_amount)).toBe(1.44);
    expect(sale.id).toBe(contract.sale_detail.id);
  });
  test('real catalog output maps to a valid cart product and decimal price', () => {
    const variant = parseVariant(contract.variants.results[0]);
    expect(variantToCart(variant)).toMatchObject({ productId: variant.product, defaultPrice: 11.5 });
  });
  test('real current profile retains active membership ownership and permissions', () => {
    const profile = validateProfile(contract.profile);
    expect(profile.tenants.some(row => row.id === contract.tenant.id && row.is_owner && Array.isArray(row.permissions))).toBe(true);
  });
  test('ambiguous empty or multiple receipt responses are retained for reconciliation', () => {
    expect(() => acceptedRetailSale([])).toThrow();
    expect(() => acceptedRetailSale([...contract.created_sales, ...contract.created_sales])).toThrow();
  });
});
