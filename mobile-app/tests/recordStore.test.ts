import 'fake-indexeddb/auto';
import { createRecordStore } from '../src/storage/recordStore.web';
describe('Atomic journal records', () => {
  test('independent connections cannot lose concurrent increments', async () => {
    const name = 'concurrent-' + Date.now(), a = createRecordStore(name), b = createRecordStore(name);
    await Promise.all(Array.from({ length: 40 }, (_, index) => (index % 2 ? a : b).transaction(['counter'], rows => ({ updates: { counter: (rows.counter || 0) + 1 }, result: undefined }))));
    expect(await a.read('counter')).toBe(40);
  });
  test('a failed transaction preserves both the intent and lock', async () => {
    const store = createRecordStore('rollback-' + Date.now());
    await store.transaction([], () => ({ updates: { intent: { key: 'one' }, lock: 'one' }, result: true }));
    await expect(store.transaction(['intent', 'lock'], () => { throw Error('Cannot confirm'); })).rejects.toThrow('Cannot confirm');
    expect(await store.read('intent')).toEqual({ key: 'one' }); expect(await store.read('lock')).toBe('one');
  });
});
