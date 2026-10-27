import { request, captureAuthScope, assertAuthScope } from '../../api/client';
import { formError } from '../../api/validation';
import { parseMoneyMinor } from '../../domain/money';
import { isIsoDate } from '../../domain/date';
import { hasPermission } from '../auth/permissions';
import type { UserProfile, UserTenant } from '../auth/AuthContext';
import type { DebtPayload } from './commands';

export const DEBT_QUOTE_PROTOCOL = 'ilbi-debt-payment-quote-v1';
type MoneyPair = { UZS: string; USD: string };
export type DebtQuote = {
  protocol: typeof DEBT_QUOTE_PROTOCOL; actor_id: number; tenant_id: number; counterparty_id: number; branch_id: number;
  amount: string; currency: 'UZS' | 'USD'; payment_type: 'cash' | 'card';
  balances: MoneyPair; applied: MoneyPair; remaining: MoneyPair;
  exchange_rate: string | null; exchange_rate_source: '' | 'manual' | 'cbu'; exchange_rate_date: string | null;
  creates_credit: boolean; expected_quote: string;
};
const maxMoney = 99_999_999_999_999n;
const invalid = (): never => { throw Error('Server to‘lov hisobini to‘liq tasdiqlamadi. Qayta hisoblang.'); };
const positiveId = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** Server decimals have fixed precision. Do not parse punctuation as grouping or use float arithmetic. */
function serverMoney(value: unknown): bigint {
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d{0,31})\.\d{2}$/.test(value)) return invalid();
  const negative = value.startsWith('-'), [whole, fraction] = (negative ? value.slice(1) : value).split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction);
  return negative ? -minor : minor;
}
function pair(value: any, nonnegative = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const UZS = serverMoney(value.UZS), USD = serverMoney(value.USD);
  if (nonnegative && (UZS < 0n || USD < 0n)) return invalid();
  return { text: { UZS: value.UZS as string, USD: value.USD as string }, UZS, USD };
}
/** Python Decimal.quantize(0.01) uses ROUND_HALF_EVEN for the server allocation. */
function convertedMinor(usdMinor: bigint, rate: bigint) {
  const numerator = usdMinor * rate, whole = numerator / 1_000_000n, fraction = numerator % 1_000_000n;
  return whole + (fraction > 500_000n || fraction === 500_000n && whole % 2n !== 0n ? 1n : 0n);
}
function parseQuote(value: any, customerId: number, amount: string, currency: DebtPayload['currency'], method: DebtPayload['payment_type'], actor: number, tenant: number, branch: number): DebtQuote {
  if (!value || value.protocol !== DEBT_QUOTE_PROTOCOL || value.actor_id !== actor || value.tenant_id !== tenant || value.counterparty_id !== customerId || value.branch_id !== branch
    || value.amount !== amount || value.currency !== currency || value.payment_type !== method || typeof value.creates_credit !== 'boolean'
    || typeof value.expected_quote !== 'string' || !/^[a-f0-9]{64}$/.test(value.expected_quote)) return invalid();
  const total = serverMoney(value.amount), balances = pair(value.balances), applied = pair(value.applied, true), remaining = pair(value.remaining);
  if ([balances.UZS, balances.USD].some(number => number > maxMoney || number < -maxMoney)
    || balances.UZS - applied.UZS !== remaining.UZS || balances.USD - applied.USD !== remaining.USD) return invalid();
  const paidUSD = currency === 'USD' ? (balances.USD > 0n ? (total < balances.USD ? total : balances.USD) : 0n) : 0n;
  const converting = currency === 'USD' && total > paidUSD;
  if (currency === 'UZS' && (applied.UZS !== total || applied.USD !== 0n) || currency === 'USD' && applied.USD !== paidUSD) return invalid();
  if (converting) {
    if (typeof value.exchange_rate !== 'string' || !/^(?:0|[1-9]\d{0,9})\.\d{6}$/.test(value.exchange_rate)) return invalid();
    const [whole, fraction] = value.exchange_rate.split('.'), rate = BigInt(whole) * 1_000_000n + BigInt(fraction);
    if (rate <= 0n || rate >= 10_000_000_000n * 1_000_000n || applied.UZS !== convertedMinor(total - paidUSD, rate)) return invalid();
    if (value.exchange_rate_source === 'manual') { if (value.exchange_rate_date !== null) return invalid(); }
    else if (value.exchange_rate_source !== 'cbu' || typeof value.exchange_rate_date !== 'string' || !isIsoDate(value.exchange_rate_date)) return invalid();
  } else if (value.exchange_rate !== null || value.exchange_rate_source !== '' || value.exchange_rate_date !== null || currency === 'USD' && applied.UZS !== 0n) return invalid();
  const createsCredit = remaining.UZS < (balances.UZS < 0n ? balances.UZS : 0n) || remaining.USD < (balances.USD < 0n ? balances.USD : 0n);
  if (createsCredit !== value.creates_credit) return invalid();
  if (createsCredit) throw formError({ amount: 'To‘lov qarzdan oshib, mijoz avansini hosil qiladi. Summani kamaytiring.' });
  return {
    protocol: DEBT_QUOTE_PROTOCOL, actor_id: actor, tenant_id: tenant, counterparty_id: customerId, branch_id: branch,
    amount, currency, payment_type: method, balances: balances.text, applied: applied.text, remaining: remaining.text,
    exchange_rate: value.exchange_rate, exchange_rate_source: value.exchange_rate_source, exchange_rate_date: value.exchange_rate_date,
    creates_credit: false, expected_quote: value.expected_quote,
  };
}

/** Read-only authoritative calculation. Never creates a financial journal or sends a payment. */
export async function fetchDebtQuote(customerId: number, raw: DebtPayload, user: UserProfile, tenant: UserTenant): Promise<DebtQuote> {
  if (!positiveId(customerId) || !positiveId(user?.id) || !positiveId(tenant?.id)) throw Error('Hisob, do‘kon yoki mijoz tasdiqlanmadi.');
  if (!hasPermission(user, tenant, 'sales.record_debt_payment')) throw Error('To‘lov hisobini ko‘rish uchun faol do‘konda vakolat berilmagan.');
  let minor: bigint;
  try { minor = BigInt(parseMoneyMinor(raw?.amount)); if (minor <= 0n || minor > maxMoney) throw Error(); }
  catch { throw formError({ amount: 'To‘lov summasini to‘g‘ri kiriting.' }); }
  if (!['UZS', 'USD'].includes(raw.currency)) throw formError({ currency: 'To‘lov valyutasini tanlang.' });
  if (!['cash', 'card'].includes(raw.payment_type)) throw formError({ payment_type: 'Naqd yoki karta usulini tanlang.' });
  const branch = raw.branch_id ?? tenant.id;
  if (!positiveId(branch)) throw formError({ branch_id: 'To‘lov qabul qiluvchi do‘konni tanlang.' });
  if (branch !== tenant.id) {
    const member = user.tenants.find(value => value.id === branch);
    if (!member || !hasPermission(user, member, 'sales.record_debt_payment')) throw Error('To‘lov qabul qiluvchi do‘kon uchun vakolat berilmagan.');
  }
  const amount = `${minor / 100n}.${(minor % 100n).toString().padStart(2, '0')}`, scope = captureAuthScope(user.id, tenant.id);
  assertAuthScope(scope);
  if (scope.tenantId !== String(tenant.id)) throw Error('Faol do‘kon o‘zgargan. To‘lov hisobini qayta oching.');
  const query = new URLSearchParams({ amount, currency: raw.currency, payment_type: raw.payment_type });
  if (raw.branch_id != null) query.set('branch_id', String(branch));
  let value: unknown;
  try { value = await request(`/sales/counterparties/${customerId}/payments/quote/?${query}`, { method: 'GET' }); }
  catch (failure: any) {
    assertAuthScope(scope);
    if ([404, 405].includes(failure.status)) throw Error('Qarz to‘lovini hisoblash uchun serverni yangilash kerak. To‘lov yuborilmadi.');
    throw failure;
  }
  assertAuthScope(scope);
  return parseQuote(value, customerId, amount, raw.currency, raw.payment_type, user.id, tenant.id, branch);
}
