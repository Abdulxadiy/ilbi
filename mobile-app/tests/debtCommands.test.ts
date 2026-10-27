import { request, captureAuthScope } from '../src/api/client';
import { recordStore } from '../src/storage/recordStore';
import { getFinancialIntent, withFinancialIdentity } from '../src/api/financialIdentity';
import { submitDebt, reconcileDebtIntent, acknowledgeDebt, type AcceptedDebt } from '../src/features/debts/commands';
import { fetchDebtQuote, DEBT_QUOTE_PROTOCOL, type DebtQuote } from '../src/features/debts/quote';
jest.mock('../src/storage/recordStore', () => { jest.requireActual('fake-indexeddb/auto'); return jest.requireActual('../src/storage/recordStore.web'); });
jest.mock('../src/api/client', () => ({ request: jest.fn(), captureAuthScope: jest.fn(() => ({})), assertAuthScope: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'key-' + Math.random() }));
jest.mock('../src/features/debts/quote', () => ({ DEBT_QUOTE_PROTOCOL: 'ilbi-debt-payment-quote-v1', fetchDebtQuote: jest.fn() }));
const tenant = { id: 7, name: 'Synthetic', is_owner: true, permissions: [] };
const user = { id: 2, role: 'owner', username: 'synthetic', first_name: '', last_name: '', phone_number: '', terms_accepted: true, tenants: [tenant] } as const;
const operation = 'debt:19:11111111-1111-4111-8111-111111111111';
const payload = { amount: '12.50', currency: 'USD' as const, payment_type: 'card' as const, expected_quote: 'a'.repeat(64) };
const customer = { id: 19, name: 'Synthetic', debt_balance_uzs: '0.00', debt_balance_usd: '20.00' };
const accepted = { id: 91, counterparty: 19, amount: '12.50', currency: 'USD', payment_type: 'card', recorded_by: 2, branch_id: 7 };
const acknowledged = (body: any) => ({ ...accepted, payment_operation: { protocol: DEBT_QUOTE_PROTOCOL, idempotency_key: body.idempotency_key, expected_quote: body.expected_quote, actor_id: 2, tenant_id: 7, counterparty_id: 19, branch_id: 7 } });
describe('Debt original-key recovery', () => {
  beforeEach(async () => {
    jest.restoreAllMocks(); jest.clearAllMocks();
    jest.mocked(fetchDebtQuote).mockReset().mockResolvedValue({ expected_quote: payload.expected_quote } as DebtQuote);
    for (const [key] of await recordStore.entries()) await recordStore.update(key, () => null);
    jest.mocked(request).mockImplementation(async (_path, options) => options?.method === 'POST' ? acknowledged(options.body) : customer);
  });
  test('after a lost success, retry skips a now-lower balance and sends the original key', async () => {
    jest.mocked(request).mockImplementation(async (_path, options) => { if (options?.method === 'POST') throw Error('Disconnected'); return customer; });
    await expect(submitDebt(operation, payload, user as any, tenant)).rejects.toThrow('Disconnected');
    const original = (await getFinancialIntent(operation, 2, 7))!;
    jest.mocked(request).mockClear().mockImplementation(async (_path, options) => options?.method === 'POST' ? acknowledged(options.body) : { ...customer, debt_balance_usd: '7.50' });
    await submitDebt(operation, payload, user as any, tenant);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('/sales/counterparties/19/payments/', { method: 'POST', body: { ...payload, idempotency_key: original.key } });
    expect((await getFinancialIntent(operation, 2, 7))?.status).toBe('confirmed');
  });
  test('an authoritative rejection of an unknown-result replay leaves its original identity pending', async () => {
    await withFinancialIdentity(operation, payload, 2, 7);
    jest.mocked(request).mockRejectedValue(Object.assign(Error('Rejected retry'), { status: 400 }));
    await expect(submitDebt(operation, payload, user as any, tenant)).rejects.toThrow('Rejected retry');
    expect((await getFinancialIntent(operation, 2, 7))?.status).toBe('pending');
  });
  test('completed dialog reuses its saved result without another payment POST', async () => {
    await submitDebt(operation, payload, user as any, tenant);
    jest.mocked(request).mockClear();
    await submitDebt(operation, payload, user as any, tenant);
    expect(request).not.toHaveBeenCalled();
    expect(captureAuthScope).toHaveBeenCalledWith(2, 7);
  });
  test.each([{ amount: '125.00' }, { currency: 'UZS' }, { payment_type: 'cash' }, { counterparty: 20 }, { recorded_by: 3 }, { branch_id: 8 }])('mismatched saved receipt remains unresolved: %o', async mismatch => {
    jest.mocked(request).mockImplementation(async (_path, options) => options?.method === 'POST' ? { ...acknowledged(options.body), ...mismatch } : customer);
    await expect(submitDebt(operation, payload, user as any, tenant)).rejects.toThrow(/to‘liq tasdiqlamadi/);
    expect((await getFinancialIntent(operation, 2, 7))?.status).toBe('pending');
  });
  test('local acceptance failure retries storage and blocks a new dialog in the same family', async () => {
    let record: AcceptedDebt | null = null;
    jest.mocked(request).mockImplementation(async (_path, options) => {
      if (!options?.method) return customer;
      jest.spyOn(recordStore, 'transaction').mockRejectedValueOnce(Error('Synthetic disk failure'));
      return acknowledged(options.body);
    });
    await expect(submitDebt(operation, payload, user as any, tenant, value => { record = value; })).rejects.toThrow('Synthetic disk failure');
    await expect(withFinancialIdentity('debt:20:22222222-2222-4222-8222-222222222222', payload, 2, 7)).rejects.toThrow('Oldingi amal');
    await acknowledgeDebt(record!);
    expect(jest.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    expect((await getFinancialIntent(operation, 2, 7))?.status).toBe('confirmed');
  });
  test.each(['debt-19', operation])('shared reconciliation preserves legacy/new operation %s and exact stored payload', async originalOperation => {
    const storedPayload = originalOperation.startsWith('debt-') ? { amount: '12.5', currency: payload.currency, payment_type: payload.payment_type } : { ...payload, amount: '12.5' };
    const identity = await withFinancialIdentity(originalOperation, storedPayload, 2, 7);
    const intent = (await getFinancialIntent(originalOperation, 2, 7))!;
    await reconcileDebtIntent(intent, user as any, tenant);
    expect(request).toHaveBeenCalledWith('/sales/counterparties/19/payments/', { method: 'POST', body: { ...storedPayload, idempotency_key: identity.idempotency_key } });
  });
  test('changed quote blocks a new payment before journal creation', async () => {
    jest.mocked(fetchDebtQuote).mockResolvedValueOnce({ expected_quote: 'b'.repeat(64) } as DebtQuote);
    await expect(submitDebt(operation, payload, user as any, tenant)).rejects.toThrow(/maydonlarni/);
    expect(await getFinancialIntent(operation, 2, 7)).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
  test('an unsupported quote API cannot be bypassed with a supplied expected_quote', async () => {
    jest.mocked(fetchDebtQuote).mockRejectedValueOnce(Error('Server must be updated'));
    await expect(submitDebt(operation, payload, user as any, tenant)).rejects.toThrow('Server must be updated');
    expect(await getFinancialIntent(operation, 2, 7)).toBeNull(); expect(request).not.toHaveBeenCalled();
  });
  test('a fresh dialog requires the displayed quote before any financial action', async () => {
    await expect(submitDebt(operation, { amount: '12.50', currency: 'USD', payment_type: 'card' }, user as any, tenant)).rejects.toThrow(/Avval to‘lov/);
    expect(await getFinancialIntent(operation, 2, 7)).toBeNull(); expect(request).not.toHaveBeenCalled();
  });
  test.each(['key', 'quote', 'actor', 'missing'])('a mismatched %s operation acknowledgement retains the pending quote and key', async field => {
    jest.mocked(request).mockImplementation(async (_path, options) => {
      const value = acknowledged(options!.body);
      if (field === 'key') value.payment_operation.idempotency_key = 'foreign';
      if (field === 'quote') value.payment_operation.expected_quote = 'b'.repeat(64);
      if (field === 'actor') value.payment_operation.actor_id = 3;
      if (field === 'missing') return { ...value, payment_operation: undefined };
      return value;
    });
    await expect(submitDebt(operation, payload, user as any, tenant)).rejects.toThrow(/asl to‘lov kaliti/);
    expect((await getFinancialIntent(operation, 2, 7))?.status).toBe('pending');
  });
});
