import { formError } from '../../api/validation';
import { positiveId } from '../reports/model';

type Definition = { label: string; kind: 'text' | 'long' | 'boolean' | 'choice' | 'rate' | 'money' | 'time' | 'integer'; max?: number; options?: readonly { value: string; label: string }[] };
const targets = [{ value: 'none', label: 'Yuborilmasin' }, { value: 'personal', label: 'Shaxsiy chat' }, { value: 'group', label: 'Guruh yoki kanal' }, { value: 'both', label: 'Shaxsiy chat va guruh' }];
export const storeFields: Record<string, Definition> = {
  address: { label: 'Do‘kon manzili', kind: 'text', max: 255 }, description: { label: 'Do‘kon tavsifi', kind: 'long' },
  receipt_phone: { label: 'Chekdagi telefon', kind: 'text', max: 30 }, receipt_header: { label: 'Chek yuqorisidagi matn', kind: 'long' }, receipt_footer: { label: 'Chek pastidagi matn', kind: 'long' },
  receipt_paper_width: { label: 'Chek qog‘ozi eni', kind: 'choice', options: [{ value: '58mm', label: '58 mm' }, { value: '80mm', label: '80 mm' }] },
  receipt_show_cashier: { label: 'Chekda sotuvchini ko‘rsatish', kind: 'boolean' }, receipt_show_customer: { label: 'Chekda mijozni ko‘rsatish', kind: 'boolean' }, receipt_show_item_tax: { label: 'Tovar qatorida QQSni ko‘rsatish', kind: 'boolean' },
  tax_regime: { label: 'Soliq rejimi', kind: 'choice', options: [{ value: 'unspecified', label: 'Belgilanmagan' }, { value: 'general', label: 'Umumbelgilangan' }, { value: 'turnover', label: 'Aylanmadan olinadigan soliq' }, { value: 'other', label: 'Boshqa rejim' }] },
  tax_regime_name: { label: 'Boshqa soliq rejimi nomi', kind: 'text', max: 150 }, is_vat_payer: { label: 'QQS to‘lovchisi', kind: 'boolean' }, vat_rate: { label: 'QQS stavkasi (%)', kind: 'rate' }, price_includes_vat: { label: 'QQS sotuv narxining ichida', kind: 'boolean' }, turnover_tax_rate: { label: 'AOS stavkasi (%)', kind: 'rate' }, profit_tax_enabled: { label: 'Foyda solig‘i yoqilgan', kind: 'boolean' }, profit_tax_rate: { label: 'Foyda solig‘i (%)', kind: 'rate' },
  auto_usd_rate: { label: 'CBU dollar kursidan avtomatik foydalanish', kind: 'boolean' }, usd_rate: { label: 'Ichki dollar kursi (UZS)', kind: 'money' },
  telegram_group_id: { label: 'Telegram guruh yoki kanal IDsi', kind: 'text', max: 100 }, notify_on_sale: { label: 'Savdodan keyin Telegram xabari', kind: 'boolean' }, notify_on_debt: { label: 'Qarz ogohlantirishlari', kind: 'boolean' }, notify_web_reports: { label: 'Ilovada Z-hisobot bildirishnomalari', kind: 'boolean' }, notify_web_low_stock: { label: 'Ilovada kamaygan tovar bildirishnomalari', kind: 'boolean' },
  daily_report_target: { label: 'Kunlik hisobot manzili', kind: 'choice', options: targets }, shift_report_target: { label: 'Smena hisoboti manzili', kind: 'choice', options: targets }, low_stock_report_target: { label: 'Kamaygan tovar hisoboti manzili', kind: 'choice', options: targets },
  daily_report_time: { label: 'Kunlik hisobot vaqti', kind: 'time' }, low_stock_report_time: { label: 'Kamaygan tovar hisoboti vaqti', kind: 'time' }, low_stock_frequency: { label: 'Kamaygan tovarlar hisoboti davri', kind: 'choice', options: [{ value: 'daily', label: 'Har kuni' }, { value: 'weekly', label: 'Haftada bir marta' }, { value: 'monthly', label: 'Oyda bir marta' }] }, low_stock_weekday: { label: 'Hafta kuni (1–7)', kind: 'integer', max: 7 }, low_stock_day_of_month: { label: 'Oy kuni (1–31)', kind: 'integer', max: 31 },
};
export const storeSections = {
  identity: { title: 'Do‘kon va chek matni', fields: ['address', 'description', 'receipt_phone', 'receipt_header', 'receipt_footer'] },
  receipt: { title: 'Chek ko‘rinishi', fields: ['receipt_paper_width', 'receipt_show_cashier', 'receipt_show_customer', 'receipt_show_item_tax'] },
  tax: { title: 'Soliq sozlamalari', fields: ['tax_regime', 'tax_regime_name', 'is_vat_payer', 'vat_rate', 'price_includes_vat', 'turnover_tax_rate', 'profit_tax_enabled', 'profit_tax_rate'] },
  currency: { title: 'Valyuta va kurs', fields: ['auto_usd_rate', 'usd_rate'] },
  telegram: { title: 'Telegram va bildirishnomalar', fields: ['telegram_group_id', 'notify_on_sale', 'notify_on_debt', 'notify_web_reports', 'notify_web_low_stock', 'daily_report_target', 'shift_report_target', 'low_stock_report_target'] },
  schedule: { title: 'Hisobot jadvali', fields: ['daily_report_time', 'low_stock_report_time', 'low_stock_frequency', 'low_stock_weekday', 'low_stock_day_of_month'] },
} as const;
export type StoreSection = keyof typeof storeSections;
export type StoreDraft = Record<string, string | boolean>;
export type StoreSettings = { id: number; name: string; revision: string | null; values: Record<string, string | boolean | number>; receiptIdentity: Record<string, string>; effectiveUsdRate: string | null; rates: Record<string, { rate: string; date: string }> };

export function parseStoreSettings(value: any): StoreSettings {
  const id = positiveId(value?.id);
  if (typeof value.name !== 'string') throw Error('Do‘kon nomi serverda tasdiqlanmadi.');
  const values: StoreSettings['values'] = {};
  for (const [field, definition] of Object.entries(storeFields)) {
    const raw = field === 'usd_rate' ? value.manual_usd_rate : value[field];
    if (raw === undefined) continue; // Missing server fields never become editable defaults.
    const kind = definition.kind;
    if (kind === 'boolean' ? typeof raw !== 'boolean' : kind === 'integer' ? !Number.isSafeInteger(raw) : typeof raw !== 'string') throw Error('Do‘kon sozlamasi tasdiqlanmadi: ' + definition.label);
    values[field] = raw;
  }
  const receiptIdentity: Record<string, string> = {};
  for (const field of ['store_code', 'seller_name', 'seller_tax_identifier']) if (typeof value.receipt_settings?.[field] === 'string') receiptIdentity[field] = value.receipt_settings[field];
  const rates: StoreSettings['rates'] = {};
  for (const code of ['USD', 'EUR', 'RUB']) {
    const row = value.cbu_rates?.[code];
    if (row && typeof row.rate === 'string' && /^\d+(?:\.\d+)?$/.test(row.rate) && Number(row.rate) > 0 && typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date)) rates[code] = { rate: row.rate, date: row.date };
  }
  const effectiveUsdRate = typeof value.usd_rate === 'string' && /^\d+(?:\.\d+)?$/.test(value.usd_rate) && Number(value.usd_rate) > 0 ? value.usd_rate : null;
  return { id, name: value.name, values, receiptIdentity, rates, effectiveUsdRate, revision: typeof value.settings_revision === 'string' && /^[a-f0-9]{64}$/.test(value.settings_revision) ? value.settings_revision : null };
}
export function settingsDraft(settings: StoreSettings): StoreDraft {
  return Object.fromEntries(Object.entries(settings.values).map(([field, value]) => [field, typeof value === 'boolean' ? value : String(value)]));
}
export function sectionSupported(settings: StoreSettings, section: StoreSection) {
  return storeSections[section].fields.every(field => Object.hasOwn(settings.values, field));
}
function normalized(field: string, raw: string | boolean | number | undefined): string | boolean | number {
  const definition = storeFields[field], fail = (message: string): never => { throw formError({ [field]: message }); };
  if (definition.kind === 'boolean') return typeof raw === 'boolean' ? raw : fail('Tanlovni qayta belgilang.');
  if (typeof raw !== 'string' && typeof raw !== 'number') return fail('Maydon qiymati yuklanmadi.');
  const text = String(raw).trim();
  if (definition.kind === 'choice') return definition.options!.some(row => row.value === text) ? text : fail('Ro‘yxatdan to‘g‘ri qiymatni tanlang.');
  if (definition.kind === 'integer') return /^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= definition.max! ? Number(text) : fail(`1 dan ${definition.max} gacha butun son kiriting.`);
  if (definition.kind === 'time') return /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(text) ? text.length === 5 ? text + ':00' : text : fail('Vaqtni HH:MM shaklida kiriting (00:00–23:59).');
  if (definition.kind === 'rate' || definition.kind === 'money') {
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) return fail('Ko‘pi bilan ikki kasrli musbat son kiriting.');
    const [whole, fraction = ''] = text.replace(',', '.').split('.'), minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    if (definition.kind === 'rate' ? minor > 10000n : minor < 1n || minor >= 1000000000000n) return fail(definition.kind === 'rate' ? 'Stavka 0 dan 100 gacha bo‘lsin.' : 'Kurs 0 dan katta va ruxsat etilgan oraliqda bo‘lsin.');
    return (minor / 100n) + '.' + (minor % 100n).toString().padStart(2, '0');
  }
  if (definition.max && text.length > definition.max) return fail(`Ko‘pi bilan ${definition.max} ta belgi kiriting.`);
  if (field === 'telegram_group_id' && text && !/^(?:-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/.test(text)) return fail('Raqamli ID yoki @kanal_nomi kiriting.');
  return text;
}
export function sectionPatch(settings: StoreSettings, section: StoreSection, draft: StoreDraft) {
  if (!sectionSupported(settings, section)) throw Error('Server bu bo‘limning barcha sozlamalarini bermadi. Qiymatlar taxmin qilinmaydi.');
  const values: Record<string, string | boolean | number> = {}, errors: Record<string, string> = {};
  for (const field of storeSections[section].fields) {
    if (section === 'currency' && field === 'usd_rate' && draft.auto_usd_rate === true) continue;
    if (section === 'schedule' && (field === 'low_stock_weekday' && draft.low_stock_frequency !== 'weekly' || field === 'low_stock_day_of_month' && draft.low_stock_frequency !== 'monthly')) continue;
    try { values[field] = normalized(field, draft[field]); }
    catch (error: any) { Object.assign(errors, error.data?.error?.details); }
  }
  if (section === 'tax') {
    if (['unspecified', 'turnover'].includes(String(values.tax_regime)) && (values.is_vat_payer || values.profit_tax_enabled)) errors.tax_regime = 'QQS yoki foyda solig‘i uchun mos soliq rejimini tanlang.';
    if (values.tax_regime === 'other' && !values.tax_regime_name) errors.tax_regime_name = 'Boshqa soliq rejimi nomini kiriting.';
  }
  if (section === 'currency' && values.auto_usd_rate === true && !settings.rates.USD) errors.auto_usd_rate = 'CBU dollar kursi serverda hali yo‘q. Sozlamalarni qayta yuklang yoki ichki kursdan foydalaning.';
  if (Object.keys(errors).length) throw formError(errors);
  return Object.fromEntries(Object.entries(values).filter(([field, value]) => value !== normalized(field, settings.values[field])));
}
export function conflictsWith(settings: StoreSettings, latest: StoreSettings, patch: Record<string, unknown>) {
  return Object.keys(patch).filter(field => normalized(field, settings.values[field]) !== normalized(field, latest.values[field]) && normalized(field, latest.values[field]) !== patch[field]);
}
export function convertStoreCurrency(amount: string, rate: string, direction: 'USD' | 'UZS') {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(amount) || !/^\d+(?:\.\d{1,6})?$/.test(rate)) throw Error('Summa va kursni to‘g‘ri kiriting.');
  const scaled = (text: string, digits: number) => { const [whole, fraction = ''] = text.replace(',', '.').split('.'); return BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0')); };
  const minor = scaled(amount, 2), microRate = scaled(rate, 6);
  if (!microRate || minor > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('Kurs yoki summa ruxsat etilgan oraliqda emas.');
  const numerator = direction === 'UZS' ? minor * microRate : minor * 1000000n, divisor = direction === 'UZS' ? 1000000n : microRate;
  const result = (numerator + divisor / 2n) / divisor;
  return (result / 100n) + '.' + (result % 100n).toString().padStart(2, '0');
}
