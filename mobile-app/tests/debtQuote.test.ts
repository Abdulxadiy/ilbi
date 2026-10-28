import { fetchDebtQuote, DEBT_QUOTE_PROTOCOL } from '../src/features/debts/quote';
import { request, captureAuthScope, assertAuthScope } from '../src/api/client';
import { withFinancialIdentity } from '../src/api/financialIdentity';
import { fieldErrors } from '../src/api/validation';
import type { DebtPayload } from '../src/features/debts/commands';
let mockScope = { generation: 1, server: 'https://ilbi.uz/api/v1', tenantId: '1' as string | null };
jest.mock('../src/api/client', () => ({ request: jest.fn(), captureAuthScope: jest.fn(() => mockScope), assertAuthScope: jest.fn() }));
jest.mock('../src/api/financialIdentity', () => ({ withFinancialIdentity: jest.fn() }));
const tenant = { id: 1, name: 'Store', is_owner: true, permissions: [] as string[] };
const user = { id: 7, username: 'owner', role: 'owner' as const, terms_accepted: true, first_name: '', last_name: '', phone_number: '', tenants: [tenant] };
const payload: DebtPayload = { amount: '5', currency: 'USD', payment_type: 'cash', note: 'Never placed in the URL' };
const quote = (changes: Record<string, any> = {}) => ({
  protocol: DEBT_QUOTE_PROTOCOL, actor_id: 7, tenant_id: 1, counterparty_id: 10, branch_id: 1,
  amount: '5.00', currency: 'USD', payment_type: 'cash', balances: { UZS: '100000.00', USD: '0.00' },
  applied: { UZS: '65000.00', USD: '0.00' }, remaining: { UZS: '35000.00', USD: '0.00' },
  exchange_rate: '13000.000000', exchange_rate_source: 'manual', exchange_rate_date: null,
  creates_credit: false, expected_quote: 'a'.repeat(64), ...changes,
});
const read = (body: Record<string, any>) => { jest.mocked(request).mockResolvedValue(body); return fetchDebtQuote(10, payload, user, tenant); };

describe('Authoritative, read-only debt payment quotes', () => {
  beforeEach(() => {
    jest.clearAllMocks(); jest.mocked(request).mockReset().mockResolvedValue(quote()); jest.mocked(assertAuthScope).mockReset();
    mockScope = { generation: 1, server: 'https://ilbi.uz/api/v1', tenantId: '1' };
  });
  afterEach(() => {
    expect(withFinancialIdentity).not.toHaveBeenCalled();
    expect(jest.mocked(request).mock.calls.every(([, options]) => options?.method === 'GET' && options.body === undefined)).toBe(true);
  });
  test('USD 5 covers UZS 65000 at the actual branch rate even when USD debt is zero', async () => {
    const result = await fetchDebtQuote(10, payload, user, tenant);
    expect(result.applied).toEqual({ UZS: '65000.00', USD: '0.00' }); expect(result.remaining.UZS).toBe('35000.00');
    expect(result.exchange_rate).toBe('13000.000000'); expect(result.expected_quote).toBe('a'.repeat(64));
    expect(request).toHaveBeenCalledWith('/sales/counterparties/10/payments/quote/?amount=5.00&currency=USD&payment_type=cash', { method: 'GET' });
    expect(jest.mocked(request).mock.calls[0][0]).not.toContain(payload.note);
    expect(captureAuthScope).toHaveBeenCalledTimes(1); expect(assertAuthScope).toHaveBeenCalledTimes(2);
  });
  test('a mixed USD/UZS quote pays existing USD first and verifies both remaining balances', async () => {
    const result = await read(quote({ balances: { UZS: '100000.00', USD: '2.00' }, applied: { UZS: '39000.00', USD: '2.00' }, remaining: { UZS: '61000.00', USD: '0.00' } }));
    expect(result.applied.USD).toBe('2.00'); expect(result.applied.UZS).toBe('39000.00');
  });
  test('existing negative other-currency balances are preserved when no new credit is created', async () => {
    const result = await read(quote({ balances: { UZS: '-50.00', USD: '10.00' }, applied: { UZS: '0.00', USD: '5.00' }, remaining: { UZS: '-50.00', USD: '5.00' }, exchange_rate: null, exchange_rate_source: '' }));
    expect(result.remaining.UZS).toBe('-50.00'); expect(result.creates_credit).toBe(false);
    await read(quote({ balances: { UZS: '100000.00', USD: '-2.00' }, applied: { UZS: '65000.00', USD: '0.00' }, remaining: { UZS: '35000.00', USD: '-2.00' } }));
  });
  test.each([['2.500000', '0.02', '9.98'], ['3.500000', '0.04', '9.96']])('six-place CBU rate %s uses exact half-even rounding', async (rate, applied, remaining) => {
    jest.mocked(request).mockResolvedValue(quote({ amount: '0.01', balances: { UZS: '10.00', USD: '0.00' }, applied: { UZS: applied, USD: '0.00' }, remaining: { UZS: remaining, USD: '0.00' }, exchange_rate: rate, exchange_rate_source: 'cbu', exchange_rate_date: '2026-10-27' }));
    expect((await fetchDebtQuote(10, { ...payload, amount: '0.01' }, user, tenant)).applied.UZS).toBe(applied);
  });
  test('UZS-only payment never fabricates FX data or touches an existing USD credit', async () => {
    jest.mocked(request).mockResolvedValue(quote({ currency: 'UZS', balances: { UZS: '100.00', USD: '-2.00' }, applied: { UZS: '5.00', USD: '0.00' }, remaining: { UZS: '95.00', USD: '-2.00' }, exchange_rate: null, exchange_rate_source: '' }));
    const result = await fetchDebtQuote(10, { ...payload, currency: 'UZS' }, user, tenant);
    expect(result.exchange_rate).toBeNull(); expect(result.remaining.USD).toBe('-2.00');
  });
  test.each([{ actor_id: 8 }, { tenant_id: 2 }, { counterparty_id: 11 }, { branch_id: 2 }, { amount: '4.00' }, { currency: 'UZS' }, { payment_type: 'card' }, { protocol: 'old-protocol' }, { expected_quote: 'short' }])('foreign/mismatched quote identity is rejected: %o', async change => {
    await expect(read(quote(change))).rejects.toThrow(/to‘liq tasdiqlamadi/);
  });
  test.each([
    { balances: { UZS: '100000', USD: '0.00' } },
    { applied: { UZS: '-1.00', USD: '0.00' } },
    { applied: { UZS: '65000.01', USD: '0.00' } },
    { remaining: { UZS: '34999.99', USD: '0.00' } },
    { exchange_rate: '13000.00' }, { exchange_rate: '12000.000000' }, { exchange_rate: '0.000000' },
    { exchange_rate_source: 'guessed' }, { exchange_rate_source: 'cbu' }, { exchange_rate_date: '2026-10-27' },
    { exchange_rate_source: 'cbu', exchange_rate_date: '2026-02-30' },
  ])('malformed money, algebra or FX is rejected: %o', async change => {
    await expect(read(quote(change))).rejects.toThrow(/to‘liq tasdiqlamadi/);
  });
  test('a valid credit-creating quote marks the amount field; a dishonest credit flag is rejected', async () => {
    const changes = { balances: { UZS: '10000.00', USD: '0.00' }, remaining: { UZS: '-55000.00', USD: '0.00' }, creates_credit: true };
    let failure: unknown;
    try { await read(quote(changes)); } catch (error) { failure = error; }
    expect(fieldErrors(failure).amount).toContain('Summani kamaytiring');
    await expect(read(quote({ ...changes, creates_credit: false }))).rejects.toThrow(/to‘liq tasdiqlamadi/);
  });
  test('a permitted explicit branch is bound to the quote and transmitted without the private note', async () => {
    const branch = { ...tenant, id: 2 }, account = { ...user, tenants: [tenant, branch] };
    jest.mocked(request).mockResolvedValue(quote({ branch_id: 2 }));
    expect((await fetchDebtQuote(10, { ...payload, branch_id: 2 }, account, tenant)).branch_id).toBe(2);
    expect(jest.mocked(request).mock.calls[0][0]).toContain('&branch_id=2');
    jest.mocked(request).mockClear();
    await expect(fetchDebtQuote(10, { ...payload, branch_id: 3 }, account, tenant)).rejects.toThrow(/do‘kon uchun vakolat/);
    expect(request).not.toHaveBeenCalled();
  });
  test('missing permission or wrong selected store never sends even a GET', async () => {
    await expect(fetchDebtQuote(10, payload, { ...user, terms_accepted: false }, tenant)).rejects.toThrow(/vakolat/);
    mockScope.tenantId = '2'; await expect(fetchDebtQuote(10, payload, user, tenant)).rejects.toThrow(/Faol do‘kon o‘zgargan/);
    expect(request).not.toHaveBeenCalled();
  });
  test('a changed session before GET or after its response cannot publish a quote', async () => {
    jest.mocked(assertAuthScope).mockImplementationOnce(() => { throw Error('Session changed'); });
    await expect(fetchDebtQuote(10, payload, user, tenant)).rejects.toThrow('Session changed'); expect(request).not.toHaveBeenCalled();
    jest.mocked(assertAuthScope).mockReset().mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw Error('Late old account'); });
    await expect(fetchDebtQuote(10, payload, user, tenant)).rejects.toThrow('Late old account');
  });
  test.each([404, 405])('old server HTTP %s explicitly requires an update and never sends a payment', async status => {
    jest.mocked(request).mockRejectedValue(Object.assign(Error('Unavailable'), { status }));
    await expect(fetchDebtQuote(10, payload, user, tenant)).rejects.toThrow(/serverni yangilash/);
    expect(request).toHaveBeenCalledTimes(1);
  });
  test('ordinary network failures remain retryable without marking a business field invalid', async () => {
    const failure = Object.assign(Error('Network unavailable'), { status: 0 }); jest.mocked(request).mockRejectedValue(failure);
    await expect(fetchDebtQuote(10, payload, user, tenant)).rejects.toBe(failure); expect(fieldErrors(failure)).toEqual({});
  });
  test.each([{ amount: '0' }, { amount: '-1' }, { amount: '1000000000000.00' }, { amount: 'invalid' }, { currency: 'EUR' }, { payment_type: 'none' }, { branch_id: 0 }])('invalid input is rejected locally: %o', async change => {
    await expect(fetchDebtQuote(10, { ...payload, ...change } as DebtPayload, user, tenant)).rejects.toThrow(); expect(request).not.toHaveBeenCalled();
  });
});
