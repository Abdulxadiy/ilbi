import { submitVoid, acknowledgeVoid, reconcileVoidIntent } from '../src/features/sales/void';
import { request, assertAuthScope } from '../src/api/client';
import { withFinancialIdentity, confirmFinancialIdentity, getFinancialIntent, rejectFinancialIdentity, type FinancialIntent } from '../src/api/financialIdentity';
import { getServerScope } from '../src/api/environment';
import { commandFromIntent, voidCommand } from '../src/features/sales/model';
const draftId = '11111111-1111-4111-8111-111111111111';
const tenant = { id: 1, name: 'A', is_owner: true, permissions: [] };
const user = { id: 1, username: 'owner', role: 'owner' as const, terms_accepted: true, tenants: [tenant], first_name: '', last_name: '', phone_number: '' };
jest.mock('../src/api/client', () => ({ request: jest.fn(), captureAuthScope: jest.fn(() => ({})), assertAuthScope: jest.fn() }));
jest.mock('../src/api/financialIdentity', () => ({ withFinancialIdentity: jest.fn(async (_operation, payload) => ({ ...payload, idempotency_key: 'original-void-key' })), getFinancialIntent: jest.fn(async () => null), confirmFinancialIdentity: jest.fn(async () => {}), rejectFinancialIdentity: jest.fn(async () => {}) }));
export const savedSale = { id: 10, receipt_number: 'R10', status: 'completed', created_at: '2026-10-27T03:00:00Z', total_amount: '1000.00', refunded_amount: '0.00', net_amount: '1000.00', currency: 'UZS', payment_type: 'cash', b2b_target_tenant: null, items: [{ id: 51, product_name: 'Rice', quantity: '5.000', voided_quantity: '0.000', unit_price: '200.00', total_price: '1000.00', unit: 'kg', status: 'active' }] };
function acknowledged(path: string, body: any) {
  const partial = path.includes('/items/');
  return { id: partial ? 51 : 10, void_operation: { actor_id: 1, tenant_id: 1, idempotency_key: body.idempotency_key, kind: partial ? 'item' : 'sale', sale_id: 10, sale_item_id: partial ? 51 : null, reason: body.reason, quantity: partial ? body.quantity : null, result: { currency: 'UZS', sale_status: partial ? 'partially_voided' : 'voided', refunded_amount: partial ? '250.00' : '1000.00', sale_net_amount: partial ? '750.00' : '0.00' } } };
}
describe('Durable mobile full/partial sale returns', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(assertAuthScope).mockReset();
    jest.mocked(getFinancialIntent).mockReset().mockResolvedValue(null);
    jest.mocked(confirmFinancialIdentity).mockReset().mockResolvedValue(undefined);
    jest.mocked(request).mockImplementation(async (path, options) => path === '/sales/capabilities/' ? { sale_void_idempotency: 1 } : options?.method === 'POST' ? acknowledged(path, options.body) : savedSale);
  });
  test('an old server cannot receive a return before idempotency capability is proven', async () => {
    jest.mocked(request).mockRejectedValueOnce(Object.assign(Error('Not found'), { status: 404 }));
    await expect(submitVoid({ draftId, saleId: 10, reason: 'Returned' }, user, tenant)).rejects.toThrow(/serverni yangilash/);
    expect(withFinancialIdentity).not.toHaveBeenCalled();
    expect(jest.mocked(request).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });
  test('full return requires original-key acknowledgement before journal confirmation', async () => {
    const accepted = jest.fn();
    await submitVoid({ draftId, saleId: 10, reason: ' Returned ' }, user, tenant, accepted);
    expect(withFinancialIdentity).toHaveBeenCalledWith('void-sale-10:' + draftId, { reason: 'Returned' }, 1, 1);
    expect(request).toHaveBeenCalledWith('/sales/10/void/', { method: 'POST', body: { reason: 'Returned', idempotency_key: 'original-void-key' } });
    expect(accepted).toHaveBeenCalledTimes(1);
    expect(confirmFinancialIdentity).toHaveBeenCalledWith('void-sale-10:' + draftId, 1, 1, 'original-void-key', expect.objectContaining({ id: 10 }));
  });
  test('fractional item return preserves exact three-place quantity', async () => {
    await submitVoid({ draftId, saleId: 10, itemId: 51, quantity: '1,250', reason: 'Returned' }, user, tenant);
    expect(withFinancialIdentity).toHaveBeenCalledWith('void-item-10-51:' + draftId, { quantity: '1.250', reason: 'Returned' }, 1, 1);
    expect(request).toHaveBeenCalledWith('/sales/items/51/void/', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ quantity: '1.250' }) }));
  });
  test('new item return re-reads remaining quantity and cannot exceed another device return', async () => {
    jest.mocked(request).mockImplementation(async path => path === '/sales/capabilities/' ? { sale_void_idempotency: 1 } : { ...savedSale, status: 'partially_voided', refunded_amount: '800.00', net_amount: '200.00', items: [{ ...savedSale.items[0], voided_quantity: '4.000' }] });
    await expect(submitVoid({ draftId, saleId: 10, itemId: 51, quantity: '1.250', reason: 'Returned' }, user, tenant)).rejects.toThrow(/maydonlarni/);
    expect(withFinancialIdentity).not.toHaveBeenCalled();
  });
  test('pending original replay does not treat its already committed effect as a new request', async () => {
    jest.mocked(getFinancialIntent).mockResolvedValue({ status: 'pending' } as FinancialIntent);
    await submitVoid({ draftId, saleId: 10, itemId: 51, quantity: '1.250', reason: 'Returned' }, user, tenant);
    expect(jest.mocked(request).mock.calls.some(([path]) => path === '/sales/10/')).toBe(false);
    expect(confirmFinancialIdentity).toHaveBeenCalledTimes(1);
  });
  test('a rejection while checking an unknown original result cannot erase the pending journal', async () => {
    jest.mocked(getFinancialIntent).mockResolvedValue({ status: 'pending' } as FinancialIntent);
    jest.mocked(request).mockImplementation(async (path, options) => {
      if (options?.method === 'POST') throw Object.assign(Error('Old response unavailable'), { status: 400 });
      return { sale_void_idempotency: 1 };
    });
    await expect(submitVoid({ draftId, saleId: 10, reason: 'Returned' }, user, tenant)).rejects.toThrow('Old response unavailable');
    expect(rejectFinancialIdentity).not.toHaveBeenCalled();
  });
  test('a completed unique dialog reads its verified original result without another POST', async () => {
    const result = acknowledged('/sales/10/void/', { reason: 'Returned', idempotency_key: 'original-void-key' });
    jest.mocked(getFinancialIntent).mockResolvedValue({ status: 'confirmed', result } as FinancialIntent);
    await expect(submitVoid({ draftId, saleId: 10, reason: 'Returned' }, user, tenant)).resolves.toEqual(result);
    expect(jest.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
    expect(withFinancialIdentity).toHaveBeenCalledWith('void-sale-10:' + draftId, { reason: 'Returned' }, 1, 1);
  });
  test('new partial return dialogs have distinct operations; both legacy and unique journals reconcile', () => {
    const first = voidCommand({ draftId, saleId: 10, itemId: 51, quantity: '1.250', reason: 'Returned' });
    const second = voidCommand({ draftId: '22222222-2222-4222-8222-222222222222', saleId: 10, itemId: 51, quantity: '1.250', reason: 'Returned' });
    expect(first.operation).not.toBe(second.operation);
    expect(commandFromIntent(first.operation, first.payload)).toEqual(first);
    expect(commandFromIntent('void-item-10-51', first.payload)?.operation).toBe('void-item-10-51');
    expect(commandFromIntent('void-sale-10:wrong-dialog', { reason: 'Returned' })).toBeNull();
  });
  test.each([{ actor_id: 2 }, { tenant_id: 2 }])('a receipt for another account/store is never locally confirmed (%o)', async mismatch => {
    jest.mocked(request).mockImplementation(async (path, options) => {
      if (path === '/sales/capabilities/') return { sale_void_idempotency: 1 };
      if (options?.method !== 'POST') return savedSale;
      const result = acknowledged(path, options.body);
      return { ...result, void_operation: { ...result.void_operation, ...mismatch } };
    });
    await expect(submitVoid({ draftId, saleId: 10, reason: 'Returned' }, user, tenant)).rejects.toThrow(/asl kalitini/);
    expect(confirmFinancialIdentity).not.toHaveBeenCalled();
    expect(rejectFinancialIdentity).not.toHaveBeenCalled();
  });
  test('a missing or mismatched receipt leaves the original journal unresolved', async () => {
    jest.mocked(request).mockImplementation(async (path, options) => path === '/sales/capabilities/' ? { sale_void_idempotency: 1 } : options?.method === 'POST' ? { ...acknowledged(path, options.body), void_operation: { idempotency_key: 'wrong-key' } } : savedSale);
    await expect(submitVoid({ draftId, saleId: 10, reason: 'Returned' }, user, tenant)).rejects.toThrow(/asl kalitini/);
    expect(confirmFinancialIdentity).not.toHaveBeenCalled(); expect(rejectFinancialIdentity).not.toHaveBeenCalled();
  });
  test('accepted request with local write failure retries only local acknowledgement', async () => {
    jest.mocked(confirmFinancialIdentity).mockRejectedValueOnce(Error('Disk unavailable')).mockResolvedValueOnce(undefined);
    let accepted: any;
    await expect(submitVoid({ draftId, saleId: 10, reason: 'Returned' }, user, tenant, record => { accepted = record; })).rejects.toThrow('Disk unavailable');
    await acknowledgeVoid(accepted);
    expect(jest.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    expect(confirmFinancialIdentity).toHaveBeenCalledTimes(2);
  });
  test('reconciliation sends the persisted original key and never creates a replacement key', async () => {
    const intent = { version: 1, key: 'original-void-key', fingerprint: 'original', payload: { reason: 'Returned' }, operation: 'void-sale-10', server: getServerScope(), userId: 1, tenantId: 1, status: 'pending', createdAt: '', updatedAt: '' } as FinancialIntent;
    jest.mocked(getFinancialIntent).mockResolvedValue(intent);
    await reconcileVoidIntent(intent, user, tenant);
    expect(withFinancialIdentity).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith('/sales/10/void/', { method: 'POST', body: { reason: 'Returned', idempotency_key: 'original-void-key' } });
  });
  test('stale account scope and B2B transfers cannot be submitted as ordinary returns', async () => {
    jest.mocked(assertAuthScope).mockImplementationOnce(() => { throw Error('Scope changed'); });
    await expect(submitVoid({ draftId, saleId: 10, reason: 'Returned' }, user, tenant)).rejects.toThrow('Scope changed');
    expect(withFinancialIdentity).not.toHaveBeenCalled();
    jest.mocked(request).mockImplementation(async path => path === '/sales/capabilities/' ? { sale_void_idempotency: 1 } : { ...savedSale, b2b_target_tenant: 2 });
    await expect(submitVoid({ draftId, saleId: 10, reason: 'Returned' }, user, tenant)).rejects.toThrow(/ochiq emas/);
  });
});
