// React Native Web UI acceptance with an explicit controlled API adapter.
// Real employee/API behavior is checked separately in PostgreSQL contract tests.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { launchBrowser } from '../../frontend/ilbi/tests/browser/chrome.mjs';

const exportDir = process.env.ILBI_PARITY_WEB_EXPORT;
const evidence = process.env.ILBI_PARITY_UI_EVIDENCE;
if (!exportDir || !evidence) throw Error('Set ILBI_PARITY_WEB_EXPORT and ILBI_PARITY_UI_EVIDENCE to isolated test directories.');
const root = resolve(exportDir), contract = JSON.parse(await readFile(new URL('./contracts/employees.json', import.meta.url), 'utf8'));
await mkdir(evidence, { recursive: true });
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf', '.ico': 'image/x-icon', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  try {
    const requested = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://test.invalid').pathname));
    if (requested !== root && !requested.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const path = extname(requested) ? requested : resolve(root, 'index.html');
    res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await launchBrowser({ width: 390, height: 844 });
function adapter(contract) {
  const employee = structuredClone(contract.directory.results[0]);
  const tenantId = contract.tenant_id, teamBase = `/tenants/${tenantId}/employees/`;
  const encode = value => btoa(JSON.stringify(value));
  const jwt = encode({ alg: 'test-adapter-only' }) + '.' + encode({ user_id: 900007, exp: Math.floor(Date.now() / 1000) + 3600 }) + '.synthetic';
  window.__parityQa = { requests: [], unexpected: [], api: 'Controlled browser adapter; no live backend or native acceptance' };
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = options.method || 'GET', body = options.body ? JSON.parse(options.body) : null;
    window.__parityQa.requests.push({ path, method, body });
    let data;
    if (path === '/auth/admin-login/') data = { access: jwt, refresh: jwt };
    else if (path === '/auth/me/') data = { id: 900007, username: 'qa-owner', first_name: 'QA', last_name: '', role: 'owner', terms_accepted: true, phone_number: '', tenants: [{ id: tenantId, name: 'QA store', is_owner: true, permissions: ['*'] }] };
    else if (path === '/sales/notifications/') data = { results: [], unread_count: 0, next_before_id: null };
    else if (path === '/sales/') data = { results: [], count: 0, next: null };
    else if (path === '/analytics/dashboard/') data = { kpi: { total_sales_uzs: '0.00', total_debt_uzs: '0.00', sales_count: 0 } };
    else if (path === teamBase + 'permissions/') data = contract.choices;
    else if (path === teamBase && method === 'GET') data = { results: [employee], next: null, count: 1 };
    else if (path === teamBase + employee.id + '/' && method === 'PATCH') { Object.assign(employee, body); data = employee; }
    else if (path === '/auth/password-reset/verify/') data = { valid: true, purpose: 'new_employee', phase: 'password_required', has_username: false, username: '', phone_hint: '+99890***1234', tenant_name: 'QA store', position: 'Kassir' };
    else if (path === '/auth/password-reset/confirm/') data = { login_ticket: 'controlled-setup-ticket', phone_hint: '+99890***1234', telegram_linked: false, otp_sent: false };
    else if (path === '/auth/admin-login/telegram-status/') data = { telegram_linked: false };
    else { window.__parityQa.unexpected.push({ path, method }); return new Response(JSON.stringify({ detail: 'Unexpected controlled API path' }), { status: 503, headers: { 'Content-Type': 'application/json' } }); }
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (expression, label) => {
  for (let i = 0; i < 200; i++) { if (await browser.evaluate('Boolean(' + expression + ')')) return; await pause(100); }
  throw Error('Timed out: ' + label + '; ' + await browser.evaluate('document.body.innerText.slice(-2000)'));
};
const click = async label => {
  await pause(350);
  const point = await browser.evaluate(`(() => {
    const node = [...document.querySelectorAll('[role="button"],[role="tab"],button')].find(el => (el.getAttribute('aria-label') === ${JSON.stringify(label)} || el.innerText.trim() === ${JSON.stringify(label)}) && !el.closest('[aria-hidden="true"],[inert]'));
    if (!node) throw Error('Missing button: ' + ${JSON.stringify(label)});
    node.scrollIntoView({ block: 'center' }); const r = node.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  await pause(150);
  await browser.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await browser.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
};
const fill = async (label, value) => {
  await browser.evaluate(`(() => { const el = [...document.querySelectorAll('input,textarea')].find(el => el.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!el) throw Error('Missing input'); el.scrollIntoView({block:'center'}); el.focus(); el.select(); })()`);
  await browser.call('Input.insertText', { text: value });
};
const screenshot = async name => { const result = await browser.call('Page.captureScreenshot', { format: 'png' }); await writeFile(resolve(evidence, name + '.png'), Buffer.from(result.data, 'base64')); };
try {
  await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: '(' + adapter.toString() + ')(' + JSON.stringify(contract) + ')' });
  await browser.call('Page.navigate', { url: base });
  await waitFor(`document.querySelector('input[aria-label="Foydalanuvchi nomi yoki telefon"]')`, 'login');
  await fill('Foydalanuvchi nomi yoki telefon', 'qa-owner'); await fill('Parol', 'Synthetic-qa-password'); await click('Kirish');
  await waitFor(`document.body.innerText.includes('Bugungi holat')`, 'authenticated home');
  await click('Menyu'); await click('Xodimlar');
  await waitFor(`document.body.innerText.includes('Native Contract')`, 'native team directory from sidebar');
  assert.equal(await browser.evaluate(`document.querySelectorAll('[role="tab"]').length`), 5);
  await screenshot('employees-light-390');
  await click('Tahrirlash: Native Contract');
  await fill('Xodim emaili', 'invalid-email'); await click('Xodimni saqlash');
  await waitFor(`document.querySelector('input[aria-label="Xodim emaili"]')?.getAttribute('aria-invalid') === 'true'`, 'inline email validation');
  await fill('Xodim emaili', 'worker@example.invalid');
  await click('Omborchi'); await screenshot('employees-permissions'); await click('Xodimni saqlash');
  await waitFor(`document.body.innerText.includes('Xodim ma’lumotlari saqlandi.')`, 'confirmed profile/permission write');
  const write = await browser.evaluate(`window.__parityQa.requests.find(row => row.method === 'PATCH')`);
  assert.equal(write.body.email, 'worker@example.invalid'); assert.ok(write.body.permission_ids.length > 0);
  assert.equal(write.body.role, undefined); assert.equal(write.body.phone_number, undefined);
  await click('Menyu'); await click('Tun'); await click('Menyuni yopish');
  await browser.resize(320, 740); await pause(400); await screenshot('employees-dark-320');
  assert.ok(await browser.evaluate('document.documentElement.scrollWidth <= 320'));
  await click('Menyu'); await click('Chiqish');
  await waitFor(`document.body.innerText.includes('Taklif orqali hisobni faollashtirish')`, 'logout returns to entry');
  await click('Taklif orqali hisobni faollashtirish');
  await waitFor(`document.querySelector('input[aria-label="Taklif yoki tiklash havolasi"]')`, 'native activation route');
  const link = 'https://ilbi.uz/setup-account?token=controlled-invitation-abcdef123456789';
  await fill('Taklif yoki tiklash havolasi', link); await click('Havolani tekshirish');
  await waitFor(`document.querySelector('input[aria-label="Yangi parol"]')`, 'verified native invitation form');
  await click('Parolni saqlash va davom etish');
  assert.equal(await browser.evaluate(`document.querySelector('input[aria-label="Yangi parol"]').getAttribute('aria-invalid')`), 'true');
  await screenshot('invitation-inline-validation');
  await fill('Yangi foydalanuvchi nomi', 'qa-worker'); await fill('Yangi parol', 'Synthetic-new-password'); await fill('Yangi parolni takrorlang', 'Synthetic-new-password');
  await click('Parolni saqlash va davom etish');
  await waitFor(`document.body.innerText.includes('Telegram botni ochish')`, 'setup continues Telegram proof without authenticating');
  await screenshot('invitation-telegram-gate');
  const qa = await browser.evaluate('window.__parityQa');
  assert.deepEqual(qa.unexpected, []);
  assert.deepEqual(browser.errors, []);
  await writeFile(resolve(evidence, 'browser-result.json'), JSON.stringify({ runtime: 'Isolated Chrome + production React Native Web export + controlled API adapter', nativeDeviceAcceptance: false, liveBackend: false, checks: ['sidebar employee route with exactly five tabs', 'actual contract-shaped directory', 'inline email and password validation', 'server-ID permission preset and safe PATCH payload', 'light390/dark320 UI and no horizontal overflow', 'logout and invitation-to-Telegram gate'], passed: true, writes: qa.requests.filter(row => row.method === 'PATCH').length, unexpected: qa.unexpected }, null, 2) + '\n');
  console.log('Employee/invitation browser checks passed (controlled API, no native/live delivery claim).');
} catch (error) {
  await screenshot('browser-failure');
  console.error('Browser runtime errors:', browser.errors);
  throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
