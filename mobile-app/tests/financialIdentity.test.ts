import AsyncStorage from '@react-native-async-storage/async-storage';
import { recordStore } from '../src/storage/recordStore';
import { withFinancialIdentity, confirmFinancialIdentity, rejectFinancialIdentity, acknowledgeLegacySale, listFinancialIntents } from '../src/api/financialIdentity';
import { setApiBaseUrl, getApiBaseUrl } from '../src/api/client';

jest.mock('../src/storage/recordStore', () => { jest.requireActual('fake-indexeddb/auto'); return jest.requireActual('../src/storage/recordStore.web'); });
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid-' + Math.random()) }));
describe('Durable financial retry identity', () => {
  beforeEach(async () => { await AsyncStorage.clear(); for (const [key] of await recordStore.entries()) await recordStore.update(key, () => null); });

  test('a confirmed stable cart never acquires a fresh retry key after restart', async () => {
    const first = await withFinancialIdentity('sale:cart-1', { amount: 100 }, 1, 2);
    await confirmFinancialIdentity('sale:cart-1', 1, 2, first.idempotency_key, { id: 5 });
    expect((await withFinancialIdentity('sale:cart-1', { amount: 100 }, 1, 2)).idempotency_key).toBe(first.idempotency_key);
    await expect(withFinancialIdentity('sale:cart-1', { amount: 200 }, 1, 2)).rejects.toThrow('Oldingi amal');
    expect((await withFinancialIdentity('sale:cart-2', { amount: 100 }, 1, 2)).idempotency_key).not.toBe(first.idempotency_key);
  });

  test('concurrent different carts cannot create two unresolved sales', async () => {
    const results = await Promise.allSettled(['cart-a', 'cart-b'].map(id => withFinancialIdentity('sale:' + id, { amount: 100 }, 1, 2)));
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(row => row.status === 'rejected')).toHaveLength(1);
  });
  test('an abandoned pending cart blocks a fresh sale until reconciliation', async () => {
    const old = await withFinancialIdentity('sale:cart-old', { amount: 100 }, 1, 2);
    await expect(withFinancialIdentity('sale:cart-new', { amount: 100 }, 1, 2)).rejects.toThrow('Oldingi amal');
    await confirmFinancialIdentity('sale:cart-old', 1, 2, old.idempotency_key, { id: 5 });
    await expect(withFinancialIdentity('sale:cart-new', { amount: 100 }, 1, 2)).resolves.toHaveProperty('idempotency_key');
  });

  test('a scoped legacy sale requires explicit review and leaves a confirmed cart tombstone', async () => {
    const old = await withFinancialIdentity('sale', { amount: 100 }, 1, 2);
    await confirmFinancialIdentity('sale', 1, 2, old.idempotency_key, { id: 5 });
    expect((await listFinancialIntents(1, 2))[0].reviewRequired).toBe(true);
    await expect(withFinancialIdentity('sale:new-cart', { amount: 100 }, 1, 2)).rejects.toThrow('Oldingi amal');
    await acknowledgeLegacySale(old.idempotency_key, 'old-cart', 1, 2);
    expect(await listFinancialIntents(1, 2)).toHaveLength(0);
    expect((await withFinancialIdentity('sale:old-cart', { amount: 100 }, 1, 2)).idempotency_key).toBe(old.idempotency_key);
    await expect(withFinancialIdentity('sale:new-cart', { amount: 100 }, 1, 2)).resolves.toHaveProperty('idempotency_key');
  });
  test('a network retry reuses its identity until server confirmation', async () => {
    const first = await withFinancialIdentity('sale', { amount: 160000 }, 1, 2);
    const retry = await withFinancialIdentity('sale', { amount: 160000 }, 1, 2);
    expect(retry.idempotency_key).toBe(first.idempotency_key);
    await confirmFinancialIdentity('sale', 1, 2);
    const next = await withFinancialIdentity('sale', { amount: 160000 }, 1, 2);
    expect(next.idempotency_key).not.toBe(first.idempotency_key);
  });
  test('another account or store cannot reuse the same identity', async () => {
    const records = await Promise.all([
      withFinancialIdentity('sale', {}, 1, 2), withFinancialIdentity('sale', {}, 2, 2), withFinancialIdentity('sale', {}, 1, 3),
    ]);
    expect(new Set(records.map(r => r.idempotency_key)).size).toBe(3);
  });
  test('concurrent submissions share one durable identity', async () => {
    const records = await Promise.all(Array.from({ length: 20 }, () => withFinancialIdentity('sale', { amount: 100 }, 1, 2)));
    expect(new Set(records.map(row => row.idempotency_key)).size).toBe(1);
  });
  test('object property order does not change retry identity', async () => {
    const one = await withFinancialIdentity('sale', { amount: 100, currency: 'UZS' }, 1, 2);
    const two = await withFinancialIdentity('sale', { currency: 'UZS', amount: 100 }, 1, 2);
    expect(one.idempotency_key).toBe(two.idempotency_key);
  });
  test('the same account and store on a different server get a separate intent', async () => {
    const original = getApiBaseUrl();
    const one = await withFinancialIdentity('sale', {}, 1, 2);
    await setApiBaseUrl('https://other.invalid/api/v1');
    const two = await withFinancialIdentity('sale', {}, 1, 2);
    expect(two.idempotency_key).not.toBe(one.idempotency_key);
    await setApiBaseUrl(original);
  });
  test('changing a sale with an uncertain result requires reconciliation', async () => {
    await withFinancialIdentity('sale', { amount: 160000 }, 1, 2);
    await expect(withFinancialIdentity('sale', { amount: 150000 }, 1, 2)).rejects.toThrow('Oldingi amal');
    await expect(withFinancialIdentity('sale', {}, undefined, 2)).rejects.toThrow();
  });

  test.each(['inventory:intake:one', 'void-item-41'])('pending family %s blocks another operation until local acknowledgement', async operation => {
    const other = operation.startsWith('inventory:') ? 'inventory:write-off:two' : 'void-item-15-42';
    const first = await withFinancialIdentity(operation, { quantity: '1' }, 1, 2);
    expect((await withFinancialIdentity(operation, { quantity: '1' }, 1, 2)).idempotency_key).toBe(first.idempotency_key);
    await expect(withFinancialIdentity(other, { quantity: '2' }, 1, 2)).rejects.toThrow('Oldingi amal');
    await expect(confirmFinancialIdentity(operation, 1, 2, 'wrong-key', { id: 3 })).rejects.toThrow('Oldingi amal');
    await expect(withFinancialIdentity(other, { quantity: '2' }, 1, 2)).rejects.toThrow('Oldingi amal');
    await confirmFinancialIdentity(operation, 1, 2, first.idempotency_key, { id: 3 });
    await expect(withFinancialIdentity(other, { quantity: '2' }, 1, 2)).resolves.toHaveProperty('idempotency_key');
  });

  test('void-sale and void-item share a pending lock; rejection frees only that family', async () => {
    const stock = await withFinancialIdentity('inventory:intake:x', { quantity: '1' }, 1, 2);
    const voided = await withFinancialIdentity('void-sale-15', { reason: 'Review' }, 1, 2);
    await expect(withFinancialIdentity('void-item-15-41', { quantity: '1' }, 1, 2)).rejects.toThrow('Oldingi amal');
    await rejectFinancialIdentity('void-sale-15', 1, 2, voided.idempotency_key, 'Rejected');
    await expect(withFinancialIdentity('void-item-15-41', { quantity: '1' }, 1, 2)).resolves.toHaveProperty('idempotency_key');
    await expect(withFinancialIdentity('inventory:write-off:y', { quantity: '1' }, 1, 2)).rejects.toThrow('Oldingi amal');
    await confirmFinancialIdentity('inventory:intake:x', 1, 2, stock.idempotency_key, { id: 7 });
  });

  test('simultaneous inventory operations cannot create independent unresolved stock writes', async () => {
    const attempts = await Promise.allSettled(['a', 'b'].map(id => withFinancialIdentity('inventory:intake:' + id, { quantity: '1' }, 1, 2)));
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1);
  });
  test('cashbox writes use a distinct pending family and local acknowledgement frees only that lock', async () => {
    const payment = await withFinancialIdentity('cashbox:open:one', { amount: '1' }, 1, 2);
    await expect(withFinancialIdentity('cashbox:close:one', { amount: '1' }, 1, 2)).rejects.toThrow('Oldingi amal');
    const inventory = await withFinancialIdentity('inventory:intake:one', { quantity: '1' }, 1, 2);
    await confirmFinancialIdentity('cashbox:open:one', 1, 2, payment.idempotency_key, { id: 3 });
    await expect(withFinancialIdentity('cashbox:close:one', { amount: '1' }, 1, 2)).resolves.toHaveProperty('idempotency_key');
    await expect(withFinancialIdentity('inventory:write-off:two', { quantity: '1' }, 1, 2)).rejects.toThrow('Oldingi amal');
    await confirmFinancialIdentity('inventory:intake:one', 1, 2, inventory.idempotency_key, { id: 4 });
  });
  test.each(['inventory:intake:draft-one', 'cashbox:close:draft-one', 'b2b:request:draft-one', 'debt:15:12345678-1234-1234-1234-123456789abc', 'void-sale-15:12345678-1234-1234-1234-123456789abc', 'void-item-15-41:12345678-1234-1234-1234-123456789abc'])('confirmed unique draft %s keeps its original key permanently', async operation => {
    const first = await withFinancialIdentity(operation, { quantity: '1' }, 1, 2);
    await confirmFinancialIdentity(operation, 1, 2, first.idempotency_key, { id: 9 });
    expect((await withFinancialIdentity(operation, { quantity: '1' }, 1, 2)).idempotency_key).toBe(first.idempotency_key);
    await expect(withFinancialIdentity(operation, { quantity: '2' }, 1, 2)).rejects.toThrow('Oldingi amal');
    await expect(withFinancialIdentity(operation + '-next', { quantity: '2' }, 1, 2)).resolves.toHaveProperty('idempotency_key');
  });
  test('B2B has its own unresolved-operation lock', async () => {
    const first = await withFinancialIdentity('b2b:request:one', {}, 1, 2);
    await expect(withFinancialIdentity('b2b:accept:two', {}, 1, 2)).rejects.toThrow('Oldingi amal');
    await expect(withFinancialIdentity('inventory:dispatch:one', {}, 1, 2)).resolves.toHaveProperty('idempotency_key');
    await confirmFinancialIdentity('b2b:request:one', 1, 2, first.idempotency_key, { id: 3 });
    await expect(withFinancialIdentity('b2b:accept:two', {}, 1, 2)).resolves.toHaveProperty('idempotency_key');
  });
  test('legacy pending debt payment blocks a new dialog until original-key reconciliation', async () => {
    const legacy = await withFinancialIdentity('debt-15', { amount: '12.50' }, 1, 2);
    const next = 'debt:15:12345678-1234-1234-1234-123456789abc';
    await expect(withFinancialIdentity(next, { amount: '12.50' }, 1, 2)).rejects.toThrow('Oldingi amal');
    await confirmFinancialIdentity('debt-15', 1, 2, legacy.idempotency_key, { id: 3 });
    await expect(withFinancialIdentity(next, { amount: '12.50' }, 1, 2)).resolves.toHaveProperty('idempotency_key');
  });
});
