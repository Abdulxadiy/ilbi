export const CUSTOMER_IMPORT_PROTOCOL = 'ilbi-counterparty-import-v1';
export const IMPORT_MAX_BYTES = 8 * 1024 * 1024;
export const importFields = { name: 'Mijoz', phone_number: 'Telefon', debt_balance_uzs: 'Nasiya UZS', debt_balance_usd: 'Nasiya USD', note: 'Izoh' };
type Field = keyof typeof importFields;
export type ImportScope = { actorId: number; tenantId: number };
export type ImportRow = { row_number: number; data: Partial<Record<Field, string>>; errors: Partial<Record<Field, string>> };
export type ImportPayload = { job_id: number; expected_count: number; expected_total_debt_uzs: string; expected_total_debt_usd: string };
export type ImportJob = { id: number; rows: ImportRow[]; expires_at: string; scope: ImportScope; payload: ImportPayload | null };
const id = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const invalid = (): never => { throw Error('Server mijoz importi ma’lumotlarini to‘liq tasdiqlamadi. Faylni qayta tekshiring.'); };
const decimal = (minor: bigint) => `${minor / 100n}.${(minor % 100n).toString().padStart(2, '0')}`;
function cents(value: unknown, total = false) {
  if (typeof value !== 'string' || !(total ? /^(?:0|[1-9]\d{0,14})(?:\.\d{1,2})?$/ : /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/).test(value)) return invalid();
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
function validContext(value: any, scope: ImportScope, job: number) {
  return id(scope.actorId) && id(scope.tenantId) && value?.protocol === CUSTOMER_IMPORT_PROTOCOL && value.job_id === job && value.actor_id === scope.actorId && value.tenant_id === scope.tenantId;
}
export function parseImportJob(value: any, scope: ImportScope): ImportJob {
  if (!id(value?.id) || !validContext(value.operation_context, scope, value.id) || !Array.isArray(value.rows) || !value.rows.length || value.rows.length > 1000 || typeof value.expires_at !== 'string' || !Number.isFinite(Date.parse(value.expires_at)) || value.completed_at !== null) return invalid();
  const seen = new Set<number>();
  let uzs = 0n, usd = 0n, hasErrors = false;
  const rows = value.rows.map((row: any): ImportRow => {
    if (!id(row?.row_number) || row.row_number < 2 || row.row_number > 1001 || seen.has(row.row_number) || !row.data || typeof row.data !== 'object' || Array.isArray(row.data) || !row.errors || typeof row.errors !== 'object' || Array.isArray(row.errors)) return invalid();
    seen.add(row.row_number);
    const data: ImportRow['data'] = {}, errors: ImportRow['errors'] = {};
    for (const field of Object.keys(importFields) as Field[]) {
      if (row.data[field] != null) {
        if (typeof row.data[field] !== 'string') return invalid();
        data[field] = row.data[field].slice(0, field === 'note' ? 5000 : 500);
      }
      if (row.errors[field] != null) {
        if (typeof row.errors[field] !== 'string' || !row.errors[field]) return invalid();
        errors[field] = row.errors[field].slice(0, 2000);
      }
    }
    // Unknown errors must never be dropped to enable a financial commit.
    if (Object.keys(row.errors).some(field => !Object.hasOwn(importFields, field))) return invalid();
    if (Object.keys(errors).length) hasErrors = true;
    else {
      if (!data.name?.trim() || data.name.length > 150 || !/^\d{7,15}$/.test((data.phone_number || '').replace(/[\s()+-]/g, ''))) return invalid();
      uzs += cents(row.data.debt_balance_uzs ?? '0'); usd += cents(row.data.debt_balance_usd ?? '0');
    }
    return { row_number: row.row_number, data, errors };
  });
  return { id: value.id, rows, expires_at: value.expires_at, scope: { ...scope }, payload: hasErrors ? null : { job_id: value.id, expected_count: rows.length, expected_total_debt_uzs: decimal(uzs), expected_total_debt_usd: decimal(usd) } };
}
export function parseImportPayload(value: any): ImportPayload {
  if (!id(value?.job_id) || !id(value.expected_count) || value.expected_count > 1000) return invalid();
  return { job_id: value.job_id, expected_count: value.expected_count, expected_total_debt_uzs: decimal(cents(value.expected_total_debt_uzs, true)), expected_total_debt_usd: decimal(cents(value.expected_total_debt_usd, true)) };
}
export function acceptedImport(value: any, payload: ImportPayload, scope: ImportScope) {
  const input = parseImportPayload(payload);
  if (!validContext(value?.import_operation, scope, input.job_id) || value.created_count !== input.expected_count || !Array.isArray(value.counterparty_ids) || value.counterparty_ids.length !== input.expected_count || !value.counterparty_ids.every(id) || new Set(value.counterparty_ids).size !== input.expected_count || decimal(cents(value.total_debt_uzs, true)) !== input.expected_total_debt_uzs || decimal(cents(value.total_debt_usd, true)) !== input.expected_total_debt_usd) return invalid();
  return { created_count: input.expected_count, counterparty_ids: [...value.counterparty_ids] as number[], total_debt_uzs: input.expected_total_debt_uzs, total_debt_usd: input.expected_total_debt_usd, import_operation: { protocol: CUSTOMER_IMPORT_PROTOCOL, job_id: input.job_id, actor_id: scope.actorId, tenant_id: scope.tenantId } };
}
export function importMoney(value: string) {
  const [whole, fraction] = decimal(cents(value, true)).split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (fraction === '00' ? '' : ',' + fraction);
}
