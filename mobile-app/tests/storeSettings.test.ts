import { request, assertAuthScope } from '../src/api/client';
import { conflictsWith, convertStoreCurrency, parseStoreSettings, sectionPatch, settingsDraft } from '../src/features/settings/storeModel';
import { saveStoreSection, sendStoreAction } from '../src/features/settings/storeCommands';
import { storeSettingsFixture as raw } from './fixtures/storeSettings';

jest.mock('../src/api/client', () => ({ request: jest.fn(), captureAuthScope: jest.fn(() => ({})), assertAuthScope: jest.fn() }));
const tenant = { id: 1, name: 'A', is_owner: true, permissions: [] }, user = { id: 1, role: 'owner', terms_accepted: true, tenants: [tenant] } as any;
describe('Scoped tenant settings and exact section patches', () => {
  beforeEach(() => { jest.resetAllMocks(); jest.mocked(request).mockResolvedValue(raw); });
  test('receipt edits send only changed fields with the fresh atomic revision and preserve all other settings', async () => {
    const original = parseStoreSettings(raw), draft = { ...settingsDraft(original), receipt_footer: 'New footer', usd_rate: '999' };
    jest.mocked(request).mockResolvedValueOnce({ ...raw, telegram_group_id: '@changed_elsewhere', settings_revision: 'b'.repeat(64) }).mockResolvedValueOnce({ ...raw, receipt_footer: 'New footer', telegram_group_id: '@changed_elsewhere', settings_revision: 'c'.repeat(64) });
    const result = await saveStoreSection('identity', draft, original, user, tenant);
    expect(request).toHaveBeenLastCalledWith('/tenants/current/', { method: 'PATCH', headers: { 'If-Match': '"' + 'b'.repeat(64) + '"' }, body: { receipt_footer: 'New footer' } });
    expect(result.values.telegram_group_id).toBe('@changed_elsewhere'); expect(result.values.usd_rate).toBe(raw.manual_usd_rate);
  });
  test('a changed field conflict retains drafts and never sends a PATCH', async () => {
    const original = parseStoreSettings(raw), draft = { ...settingsDraft(original), vat_rate: '8' };
    jest.mocked(request).mockResolvedValue({ ...raw, vat_rate: '9.00', settings_revision: 'b'.repeat(64) });
    await expect(saveStoreSection('tax', draft, original, user, tenant)).rejects.toThrow(/boshqa oynada/);
    expect(request).toHaveBeenCalledTimes(1); expect(draft.vat_rate).toBe('8');
  });
  test('a save already applied before a lost response is read back without a second PATCH', async () => {
    const original = parseStoreSettings(raw), draft = { ...settingsDraft(original), receipt_footer: 'Already saved' };
    jest.mocked(request).mockResolvedValue({ ...raw, receipt_footer: 'Already saved', settings_revision: 'b'.repeat(64) });
    await expect(saveStoreSection('identity', draft, original, user, tenant)).resolves.toMatchObject({ values: { receipt_footer: 'Already saved' } });
    expect(request).toHaveBeenCalledTimes(1);
  });
  test('read/patch racing update returns a useful conflict without clearing the draft', async () => {
    const original = parseStoreSettings(raw), draft = { ...settingsDraft(original), receipt_footer: 'New footer' };
    jest.mocked(request).mockResolvedValueOnce(raw).mockRejectedValueOnce(Object.assign(Error('Precondition failed'), { status: 412 }));
    await expect(saveStoreSection('identity', draft, original, user, tenant)).rejects.toThrow(/boshqa oynada/);
    expect(draft.receipt_footer).toBe('New footer');
  });
  test.each([{ id: 2 }, { receipt_footer: 'Wrong saved value' }])('wrong acknowledgement is rejected (%o)', async mismatch => {
    const original = parseStoreSettings(raw);
    jest.mocked(request).mockResolvedValueOnce(raw).mockResolvedValueOnce({ ...raw, receipt_footer: 'New footer', ...mismatch });
    await expect(saveStoreSection('identity', { ...settingsDraft(original), receipt_footer: 'New footer' }, original, user, tenant)).rejects.toThrow(/tasdiqlamadi/);
  });
  test('an old server or a session/permission change cannot receive a settings write', async () => {
    const original = parseStoreSettings({ ...raw, settings_revision: undefined }), draft = { ...settingsDraft(original), address: 'New address' };
    await expect(saveStoreSection('identity', draft, original, user, tenant)).rejects.toThrow(/serverni yangilash/);
    expect(request).not.toHaveBeenCalled();
    await expect(saveStoreSection('identity', draft, original, { ...user, tenants: [] }, tenant)).rejects.toThrow(/vakolat/);
    jest.mocked(assertAuthScope).mockImplementationOnce(() => { throw Error('Session changed'); });
    await expect(saveStoreSection('identity', draft, parseStoreSettings(raw), user, tenant)).rejects.toThrow('Session changed');
    expect(jest.mocked(request).mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(0);
  });
  test('automatic currency mode omits manual rate, preserves its value and requires actual CBU data', () => {
    const original = parseStoreSettings(raw), draft = { ...settingsDraft(original), auto_usd_rate: true, usd_rate: '' };
    expect(sectionPatch(original, 'currency', draft)).toEqual({ auto_usd_rate: true });
    expect(() => sectionPatch(parseStoreSettings({ ...raw, cbu_rates: {} }), 'currency', draft)).toThrow(/maydonlarni/);
  });
  test.each([
    ['tax', { vat_rate: '100.01' }], ['tax', { tax_regime: 'turnover' }], ['tax', { tax_regime: 'other', tax_regime_name: '' }],
    ['schedule', { daily_report_time: '25:00' }], ['schedule', { low_stock_weekday: '8' }], ['schedule', { low_stock_frequency: 'monthly', low_stock_day_of_month: '32' }],
    ['telegram', { telegram_group_id: 'https://t.me/invalid' }], ['currency', { usd_rate: '-1' }],
  ] as const)('invalid %s settings are field errors', (section, change) => {
    const original = parseStoreSettings(raw);
    expect(() => sectionPatch(original, section, { ...settingsDraft(original), ...change })).toThrow(/maydonlarni/);
  });
  test('missing settings are not invented and stale checks compare only explicitly edited fields', () => {
    const original = parseStoreSettings(raw);
    expect(() => sectionPatch(parseStoreSettings({ ...raw, vat_rate: undefined }), 'tax', settingsDraft(original))).toThrow(/barcha sozlamalarini/);
    expect(conflictsWith(original, parseStoreSettings({ ...raw, telegram_group_id: '@changed_elsewhere' }), { receipt_footer: 'New' })).toEqual([]);
  });
  test('conversion keeps six-place official rates and half-up rounding without financial writes', () => {
    expect(convertStoreCurrency('1', '13000.123456', 'UZS')).toBe('13000.12');
    expect(convertStoreCurrency('0.01', '1.5', 'UZS')).toBe('0.02');
    expect(convertStoreCurrency('13000.12', '13000.123456', 'USD')).toBe('1.00');
    expect(request).not.toHaveBeenCalled();
  });
  test('explicit report actions read the current store and do not automatically retry a lost response', async () => {
    jest.mocked(request).mockResolvedValueOnce(raw).mockRejectedValueOnce(Error('Network lost'));
    await expect(sendStoreAction('daily', user, tenant)).rejects.toThrow('Network lost');
    expect(request).toHaveBeenLastCalledWith('/tenants/current/send-report-now/', { method: 'POST', body: {} });
    expect(jest.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  });
  test.each([['telegram', 'test-telegram/'], ['daily', 'send-report-now/'], ['stock', 'send-low-stock-report-now/']] as const)('explicit %s action requires the actual saved-store acknowledgement', async (action, endpoint) => {
    jest.mocked(request).mockResolvedValueOnce(raw).mockResolvedValueOnce({ success: true, detail: 'Isolated transport accepted' });
    await expect(sendStoreAction(action, user, tenant)).resolves.toBe('Isolated transport accepted');
    expect(request).toHaveBeenLastCalledWith('/tenants/current/' + endpoint, { method: 'POST', body: {} });
    expect(jest.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  });
});
