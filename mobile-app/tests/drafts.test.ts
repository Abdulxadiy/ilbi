import { newDraft, validateCartDraft } from '../src/features/cart/drafts';
const item = { variantId: 1, productId: 2, productName: 'Sut', unit: 'kg', quantity: 0.125, unitPrice: 11.5, defaultPrice: 12 };
describe('Persisted draft schema', () => {
  test('a valid fractional draft retains exact prices and ownership', () => expect(validateCartDraft(newDraft(1, 2, [item]), 1, 2).items).toEqual([item]));
  test.each([
    { quantity: -1 }, { quantity: '2' }, { unitPrice: NaN }, { variantId: 0 }, { productId: undefined }, { quantity: Infinity },
  ])('rejects invalid persisted item %j', patch => expect(() => validateCartDraft(newDraft(1, 2, [{ ...item, ...patch } as any]), 1, 2)).toThrow());
  test('another store cannot restore a valid draft', () => expect(() => validateCartDraft(newDraft(1, 2, [item]), 1, 3)).toThrow());
  test('unknown versions are quarantined rather than guessed', () => expect(() => validateCartDraft({ ...newDraft(1, 2, [item]), version: 99 }, 1, 2)).toThrow());
});
