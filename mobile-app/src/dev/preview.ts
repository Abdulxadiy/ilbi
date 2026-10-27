import { createPreviewCore } from './previewCore';
import { createPreviewB2B } from './previewB2B';
import { createPreviewCashbox } from './previewCashbox';
import { createPreviewStoreSettings } from './previewStoreSettings';
import { createPreviewSupport } from './previewSupport';
import { createPreviewNotifications, previewNotificationSettings } from './previewNotifications';
/** Explicit, development-only design data. Never a fallback for a failed API call. */
import { createPreviewCatalog, type PreviewVariant } from './previewCatalog';
import { isDesignPreview } from '../api/environment';
export { isDesignPreview } from '../api/environment';
export const previewUser = {
  id: 900001, username: 'design-preview', first_name: 'Demo', last_name: '',
  phone_number: '', role: 'owner' as const, terms_accepted: true,
  tenants: [{ id: 900001, name: 'Demo do‘kon', is_owner: true, permissions: ['*'] }],
};
let nextCategoryId = 10;
const categories = [{ id: 1, name: 'Oziq-ovqat', kod: '01', parent: null as number | null, currency: 'UZS', is_active: true }];
const products: PreviewVariant[] = [
  ['Sut 1 L', 12000, 2], ['Non', 4000, 3], ['Suv 1.5 L', 5000, 2],
  ['Shakar 1 kg', 16000, 1], ['Choy 100 g', 18000, 1], ["Yog' 1 L", 22000, 1],
  ['Guruch 1 kg', 15000, 2], ['Tuxum (10 dona)', 18000, 1], ['Tuz 1 kg', 3000, 1],
  ['Makaron 500 g', 8000, 1],
].map(([name, price, quantity], index) => ({
  is_active: true, sku: 'DEMO-' + (index + 1), id: index + 1, product: index + 1, category_id: 1, category_name: 'Oziq-ovqat', product_name: String(name), name: 'Standart',
  unit: 'dona', price_recommended: Number(price), price_min: 0, price_partner: Number(price), currency: 'UZS', image: null,
  barcode: '47800000000' + String(index + 1).padStart(2, '0'), stock_quantity: 50,
  quantity: Number(quantity),
}));
const supportRequest = createPreviewSupport();
const notificationRequest = createPreviewNotifications();
const storePreview = createPreviewStoreSettings(previewUser.tenants[0].id, previewUser.tenants[0].name, previewNotificationSettings);
const catalogRequest = createPreviewCatalog(products, categories);
const customers = [
  { id: 1, name: 'Ali Valiyev', phone_number: '', debt_amount: 230000, sales_count: 1 },
  { id: 2, name: 'Dilnoza Karimova', phone_number: '', debt_amount: 320000, sales_count: 1 },
  { id: 3, name: 'Aziz Rahimov', phone_number: '', debt_amount: 180000, sales_count: 1 },
  { id: 4, name: 'Malika Sobirova', phone_number: '', debt_amount: 130000, sales_count: 1 },
];
const sales = new Map<number, any>();
const intents = new Map<string, any>();
function makeSale(payload: any, id: number) {
  const items = (payload.items || products.map(p => ({ product_variant_id: p.id, quantity: p.quantity, unit_price: p.id === 1 ? 11500 : p.price_recommended }))).map((line: any, index: number) => {
    const product = products.find(p => p.id === Number(line.product_variant_id));
    return { ...line, id: id * 1000 + index + 1, product_variant: Number(line.product_variant_id), product_name: product?.product_name || 'Demo tovar', product_variant_name: product?.name || 'Standart', voided_quantity: '0.000', status: 'active', unit: product?.unit || 'dona', total_price: Number(line.quantity) * Number(line.unit_price) };
  });
  const total = items.reduce((sum: number, line: any) => sum + line.total_price, 0);
  return { id, receipt_number: 'DEMO-' + id, receipt_snapshot: storePreview.receiptSnapshot(), currency: 'UZS', status: 'completed', b2b_target_tenant: null, items, total_amount: total, refunded_amount: '0.00', net_amount: total,
    counterparty: payload.counterparty_id || 1, counterparty_name: 'Ali Valiyev', payment_type: payload.payment_type || 'cash', created_at: new Date().toISOString(), _preview: true };
}
sales.set(1043, makeSale({}, 1043));
const coreRequest = createPreviewCore({ user: previewUser, customers, sales, products });
const b2bRequest = createPreviewB2B(previewUser.id, previewUser.tenants[0].id);
const cashboxRequest = createPreviewCashbox(previewUser.id, previewUser.tenants[0].id);

export async function previewRequest(endpoint: string, options: { method?: string; body?: any; headers?: HeadersInit }): Promise<any> {
  if (!isDesignPreview) throw Error('Design preview is disabled');
  const url = new URL(endpoint, 'http://design.invalid'), path = url.pathname;
  const method = (options.method || 'GET').toUpperCase();
  const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body || {};
  const cashboxResult = cashboxRequest(url, method, body);
  if (cashboxResult.handled) return cashboxResult.data;
  const storeResult = storePreview.request(url, method, body, options.headers);
  if (storeResult.handled) return storeResult.data;
  const b2bResult = b2bRequest(url, method, body);
  if (b2bResult.handled) return b2bResult.data;
  const coreResult = coreRequest(url, method, body);
  if (coreResult.handled) return coreResult.data;
  const notificationResult = notificationRequest(url, method, body);
  if (notificationResult.handled) return notificationResult.data;
  const supportResult = supportRequest(url, method, body, options.headers);
  if (supportResult.handled) return supportResult.data;
  const catalogResult = catalogRequest(url, method, body);
  if (catalogResult.handled) return catalogResult.data;
  if (method === 'GET') {
    if (path === '/auth/me/') return previewUser;
    if (path === '/tenants/my/') return previewUser.tenants;
    if (path === '/analytics/dashboard/') return { today_sales_sum: 2450000, sales_count: 24, debt_sum: 860000 };
    if (path === '/catalog/categories/') return { results: categories.filter(c => c.is_active && c.name.toLowerCase().includes((url.searchParams.get('search') || '').toLowerCase()) && (!url.searchParams.has('parent') || (url.searchParams.get('parent') === 'null' ? c.parent === null : c.parent === Number(url.searchParams.get('parent'))))) };
    const category = path.match(/^\/catalog\/categories\/(\d+)\/$/);
    if (category) { const found = categories.find(c => c.id === Number(category[1])); if (!found) throw Error('Kategoriya topilmadi.'); return { ...found }; }
    if (path === '/sales/counterparties/') return { results: customers };
    if (path === '/sales/') return { results: [...sales.values()] };
    const match = path.match(/^\/sales\/(\d+)\/$/);
    if (match && sales.has(Number(match[1]))) return sales.get(Number(match[1]));
  }
  const categoryMatch = path.match(/^\/catalog\/categories\/(\d+)\/$/);
  if ((method === 'POST' && path === '/catalog/categories/') || (method === 'PATCH' && categoryMatch)) {
    const existing = categoryMatch ? categories.find(c => c.id === Number(categoryMatch[1])) : null;
    if (categoryMatch && !existing) throw Error('Kategoriya topilmadi.');
    const parent = body.parent_id ? categories.find(c => c.id === body.parent_id && c.is_active) : null;
    if (body.parent_id && (!parent || parent.parent || parent.id === existing?.id || (existing && categories.some(c => c.parent === existing.id)))) throw Error('Kategoriya tuzilishi noto‘g‘ri.');
    if (!body.name?.trim()) throw Error('Kategoriya nomi kerak.');
    const saved = { id: existing?.id || nextCategoryId++, name: body.name.trim(), kod: body.kod || existing?.kod || String(nextCategoryId), parent: parent?.id || null, currency: parent?.currency || body.currency || 'UZS', is_active: true };
    if (categories.some(c => c.id !== saved.id && c.kod === saved.kod)) throw Error('Kategoriya kodi band.');
    if (existing) Object.assign(existing, saved); else categories.push(saved);
    return { ...saved };
  }
  if (method === 'DELETE' && categoryMatch) {
    const index = categories.findIndex(c => c.id === Number(categoryMatch[1]));
    if (index < 0) throw Error('Kategoriya topilmadi.');
    if (categories.some(c => c.parent === categories[index].id && c.is_active) || products.some(p => p.category_id === categories[index].id)) throw Error('Kategoriyada faol mahsulot yoki ichki kategoriya mavjud.');
    categories.splice(index, 1); return null;
  }
  if (method === 'POST' && path === '/sales/') {
    if (!body.items?.length) throw Error('Savat bo‘sh');
    if (body.idempotency_key && intents.has(body.idempotency_key)) return [intents.get(body.idempotency_key)];
    const sale = makeSale(body, 1044 + sales.size);
    sales.set(sale.id, sale);
    if (body.idempotency_key) intents.set(body.idempotency_key, sale);
    return [sale];
  }
  if (method === 'POST' && path === '/sales/counterparties/') {
    const customer = { id: Date.now(), ...body, debt_amount: 0, sales_count: 0 };
    customers.push(customer); return customer;
  }
  if (method === 'POST' && /^\/sales\/counterparties\/\d+\/payments\/$/.test(path)) return { id: Date.now(), ...body, _preview: true };
  if (method === 'POST' && path === '/auth/password-reset/request/') {
    return { detail: 'Tiklash havolasi emailingizga yuborildi. Spam papkasini ham tekshiring.', has_email: true, email_hint: 'de***@ilbi.uz' };
  }
  if (method === 'POST' && path === '/auth/password-reset/confirm/') {
    return { detail: 'Parol muvaffaqiyatli yangilandi.', username: body.username || 'preview' };
  }
  if (method === 'POST' && path === '/auth/password-reset/change-with-old/') {
    return { detail: 'Parol muvaffaqiyatli almashtirildi.' };
  }
  throw Error('Bu amal dizayn preview rejimida ulanmagan; haqiqiy serverga yuborilmadi.');
}
