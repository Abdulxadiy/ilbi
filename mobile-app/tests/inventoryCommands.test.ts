import AsyncStorage from '@react-native-async-storage/async-storage';
import { recordStore } from '../src/storage/recordStore';
import { executeInventory, inventoryCommand, inventoryDecimal, INVENTORY_PROTOCOL, InventoryAcknowledgementError, confirmAcceptedInventory, reconcileInventoryIntent } from '../src/features/inventory/commands';
import { request, assertAuthScope } from '../src/api/client';
import { getFinancialIntent, listFinancialIntents } from '../src/api/financialIdentity';
import { inventoryDraft, saveInventoryDraft, clearInventoryDraft } from '../src/features/inventory/drafts';
import { commitApiBaseUrl, getApiBaseUrl, scopedKey } from '../src/api/environment';
jest.mock('../src/storage/recordStore', () => { jest.requireActual('fake-indexeddb/auto'); return jest.requireActual('../src/storage/recordStore.web'); });
jest.mock('../src/api/client', () => ({ request: jest.fn(), captureAuthScope: jest.fn(() => ({ server: jest.requireActual('../src/api/environment').getServerScope() })), assertAuthScope: jest.fn() }));
const tenant = { id: 1, name: 'A', is_owner: true, permissions: [] };
const user = { id: 1, username: 'owner', role: 'owner' as const, terms_accepted: true, tenants: [tenant], first_name: '', last_name: '', phone_number: '' };
const command = () => inventoryCommand('intake', { product_variant_id: 11, quantity: '1,250', cost_price: '2.50' });
const capability = { protocol: INVENTORY_PROTOCOL, operations: ['stock.intake', 'stock.batch_intake', 'stock.adjust', 'stock.customer_return', 'stock.supplier_return', 'stock.write_off', 'transfer.dispatch', 'transfer.receive', 'transfer.return', 'transfer.close_discrepancy'] };
const movement = (body: any) => ({ id: 9, product_variant: body.product_variant_id, quantity: body.quantity, cost_price: body.cost_price, type: 'kirim', direction: 'in', created_by: 1 });
describe('Durable inventory API commands', () => {
  beforeEach(async () => {
    jest.clearAllMocks(); jest.mocked(assertAuthScope).mockReset();
    await AsyncStorage.clear(); for (const [key] of await recordStore.entries()) await recordStore.update(key, () => null);
    jest.mocked(request).mockImplementation(async (path, options) => path.endsWith('capabilities/') ? capability : movement(options?.body));
  });
  test('decimal quantities never round malformed or excess-precision input', () => {
    expect(inventoryDecimal('1,250')).toBe('1.250'); expect(inventoryDecimal('0', 2, true)).toBe('0.00');
    for (const value of ['0', '-1', '1.0001', '1.2.3', '1e3']) expect(() => inventoryDecimal(value)).toThrow();
    expect(() => inventoryCommand('intake', { product_variant_id: 11, quantity: '1', cost_price: '2', expires_on: '2026-02-30' })).toThrow();
  });
  test('old server receives neither stock writes nor new journal', async () => {
    jest.mocked(request).mockResolvedValue({});
    await expect(executeInventory(command(), 'one', user, tenant)).rejects.toThrow(/Server yangilanishi/);
    expect(jest.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
    expect(await listFinancialIntents(1, 1)).toHaveLength(0);
  });
  test('duplicate completed draft returns original result without a second POST', async () => {
    const result = await executeInventory(command(), 'one', user, tenant);
    expect((await getFinancialIntent('inventory:intake:new:one', 1, 1))?.status).toBe('confirmed');
    expect(await executeInventory(command(), 'one', user, tenant)).toEqual(result);
    expect(jest.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  });
  test('uncertain retry keeps original key and blocks another inventory draft', async () => {
    jest.mocked(request).mockImplementation(async (path, options) => {
      if (path.endsWith('capabilities/')) return capability;
      if (jest.mocked(request).mock.calls.filter(([, value]) => value?.method === 'POST').length === 1) throw Error('Network unavailable');
      return movement(options?.body);
    });
    await expect(executeInventory(command(), 'one', user, tenant)).rejects.toThrow('Network unavailable');
    await expect(executeInventory(command(), 'two', user, tenant)).rejects.toThrow('Oldingi amal');
    await executeInventory(command(), 'one', user, tenant);
    const bodies = jest.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST').map(([, options]) => options!.body);
    expect(bodies).toHaveLength(2); expect(bodies[0]).toEqual(bodies[1]);
  });
  test('wrong actor is not acknowledged and changed pending quantity cannot be sent', async () => {
    jest.mocked(request).mockImplementation(async (path, options) => path.endsWith('capabilities/') ? capability : { ...movement(options?.body), created_by: 2 });
    await expect(executeInventory(command(), 'one', user, tenant)).rejects.toThrow(/to‘liq tasdiqlamadi/);
    expect((await getFinancialIntent('inventory:intake:new:one', 1, 1))?.status).toBe('pending');
    await expect(executeInventory(inventoryCommand('intake', { ...command().body, quantity: '2' }), 'one', user, tenant)).rejects.toThrow('Oldingi amal');
  });
  test('a retry 400 cannot erase an earlier unknown result', async () => {
    jest.mocked(request).mockImplementation(async path => { if (path.endsWith('capabilities/')) return capability; throw Error('Network'); });
    await expect(executeInventory(command(), 'one', user, tenant)).rejects.toThrow();
    jest.mocked(request).mockImplementation(async path => { if (path.endsWith('capabilities/')) return capability; throw Object.assign(Error('Rejected retry'), { status: 400 }); });
    await expect(executeInventory(command(), 'one', user, tenant)).rejects.toThrow('Rejected retry');
    expect((await getFinancialIntent('inventory:intake:new:one', 1, 1))?.status).toBe('pending');
  });
  test('accepted stock write plus disk failure is completed locally without POST', async () => {
    const original = recordStore.transaction.bind(recordStore);
    const spy = jest.spyOn(recordStore, 'transaction').mockImplementation(async (...args) => {
      if (jest.mocked(request).mock.calls.some(([, value]) => value?.method === 'POST')) throw Error('Disk full');
      return original(...args);
    });
    let failure: any; try { await executeInventory(command(), 'one', user, tenant); } catch (value) { failure = value; }
    expect(failure).toBeInstanceOf(InventoryAcknowledgementError); spy.mockRestore();
    await confirmAcceptedInventory(failure.accepted);
    expect(jest.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    expect((await getFinancialIntent('inventory:intake:new:one', 1, 1))?.status).toBe('confirmed');
  });
  test('reconciliation refuses another account then sends the original persisted key', async () => {
    jest.mocked(request).mockImplementation(async path => { if (path.endsWith('capabilities/')) return capability; throw Error('Network'); });
    await expect(executeInventory(command(), 'one', user, tenant)).rejects.toThrow();
    const journal = (await listFinancialIntents(1, 1))[0];
    jest.mocked(request).mockImplementation(async (path, options) => path.endsWith('capabilities/') ? capability : movement(options?.body));
    await expect(reconcileInventoryIntent(journal, { ...user, id: 2 }, tenant)).rejects.toThrow(/boshqa hisob/);
    await reconcileInventoryIntent(journal, user, tenant);
    const bodies = jest.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST').map(([, options]) => options!.body);
    expect(bodies[0]).toEqual(bodies[1]); expect(bodies[1].idempotency_key).toBe(journal.key);
  });
  test('receive preserves exact fractional quantities and destination mapping', async () => {
    const receive = inventoryCommand('receive', { items: [{ item_id: 5, received_quantity: '1.250', destination_variant_id: 20, discrepancy_reason: 'Missing' }] }, 8);
    jest.mocked(request).mockImplementation(async (path, options) => path.endsWith('capabilities/') ? capability : { id: 8, destination_tenant: 1, received_by: 1, status: 'discrepancy', items: [{ id: 5, quantity_received: options!.body.items[0].received_quantity }] });
    await executeInventory(receive, 'receive-one', user, tenant);
    expect(request).toHaveBeenCalledWith('/inventory/transfers/8/receive/', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ items: [{ item_id: 5, received_quantity: '1.250', destination_variant_id: 20, destination_category_id: null, discrepancy_reason: 'Missing' }] }) }));
  });
  test('draft restoration keeps identity; obsolete draft cannot erase replacement or cross server', async () => {
    const draft = await inventoryDraft('batch-intake', null, 1, 1, { items: [] });
    await saveInventoryDraft({ ...draft, body: { items: [{ quantity: '1.250' }] } });
    expect((await inventoryDraft('batch-intake', null, 1, 1, {})).body.items[0].quantity).toBe('1.250');
    await clearInventoryDraft(draft);
    const next = await inventoryDraft('batch-intake', null, 1, 1, {}); expect(next.id).not.toBe(draft.id);
    await expect(clearInventoryDraft(draft)).rejects.toThrow(/Yangi qoralamani/);
    const original = getApiBaseUrl(); commitApiBaseUrl('https://other.invalid/api/v1');
    await expect(saveInventoryDraft(next)).rejects.toThrow(/boshqa server/); commitApiBaseUrl(original);
  });
  test('corrupt multi-line draft is preserved and cannot crash into a stock write', async () => {
    const original = await inventoryDraft('batch-intake', null, 1, 1, { items: [] });
    const key = scopedKey('inventory-draft:batch-intake:new', 1, 1);
    await recordStore.update(key, () => ({ ...original, body: { items: null } }));
    await expect(inventoryDraft('batch-intake', null, 1, 1, { items: [] })).rejects.toThrow(/yozuv saqlanadi/);
    expect((await recordStore.read<any>(key)).body.items).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});
