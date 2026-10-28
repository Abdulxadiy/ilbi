// Synthetic responses only: this fixture never calls a real API or sends an OTP.
export function installAuthFixture({ saved = true, profileFailure = false, guestHistory = false, role = 'platform_admin', desktop = false, dailyMfa = false } = {}) {
  const tenants = role === 'owner' ? [{ id: 7, name: 'Birinchi do‘kon', is_owner: true, permissions: ['*'] }, { id: 8, name: 'Ikkinchi do‘kon', is_owner: true, permissions: ['*'] }] : [];
  const user = { id: 41, username: 'session_test', first_name: 'Sessiya', last_name: 'Sinov', role, terms_accepted: true, tenants, permissions: ['*'], phone_number: '+998900000041' };
  const jwt = (id, kind) => `fixture.${btoa(JSON.stringify({ user_id: id, exp: Date.now() / 1000 + 3600, token_type: kind }))}.fixture`;
  const tokens = { access: jwt(user.id, 'access'), refresh: jwt(user.id, 'refresh') };
  const conversation = { id: 'private-41', subject: 'Shaxsiy sinov suhbati', name: 'Sinov', status: 'active', operator_id: user.id, unread_count: 0 };
  const message = { id: 101, text: 'PRIVATE_HISTORY_SENTINEL', sender: 'visitor', author_name: 'Sinov', created_at: '2026-10-16T07:00:00Z' };
  window.authQA = { requests: [], user, tokens, profileFailure, dailyMfa, idle:false, holdProfile: false, pendingProfiles: [], holdList: false, pendingLists: [] };
  if (desktop) {
    // In-memory bridge double only. Native acceptance verifies the real encrypted file.
    const vault = new Map();
    authQA.credentialSaves = 0;
    window.ilbiDesktop = {
      version:'qa', getSavedLogin:async kind=>{const saved=vault.get(kind);return saved&&authQA.idle?{username:saved.username,password:'',requiresPassword:true}:saved||null;},
      saveLogin:async (kind,value)=>{ vault.set(kind,value); authQA.credentialSaves++; },
      forgetLogin:async kind=>vault.delete(kind),
    };
  }
  if (tenants.length) localStorage.setItem('ilbi_active_tenant:41', '7');
  if (saved) {
    localStorage.setItem('ilbi_access_token', tokens.access);
    localStorage.setItem('ilbi_refresh_token', tokens.refresh);
    localStorage.setItem('ilbi_user', JSON.stringify(user));
  }
  localStorage.setItem('ilbi_support_guest', 'a'.repeat(64));
  const nativeFetch = window.fetch.bind(window);
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (input, options = {}) => {
    const url = new URL(input, location.origin);
    if (desktop && url.pathname.startsWith('/desktop/')) return json({desktop:true,enrolled:false});
    if (!url.pathname.startsWith('/api/')) return nativeFetch(input, options);
    const path = url.pathname;
    const body = typeof options.body === 'string' ? JSON.parse(options.body) : null;
    authQA.requests.push({ path, method: options.method || 'GET', authorized: Boolean(options.headers?.Authorization) });
    if (path === '/api/v1/auth/me/') {
      if (authQA.holdProfile) await new Promise(resolve => authQA.pendingProfiles.push(resolve));
      if (authQA.profileFailure) throw new TypeError('Synthetic offline response');
      return json(authQA.user);
    }
    if (path === '/api/v1/auth/token/refresh/') return json(authQA.tokens);
    if (path === '/api/v1/auth/admin-login/') {
      if (authQA.rejectCredentials) return json({ detail: 'Username or password incorrect!' }, 401);
      return authQA.dailyMfa?json({...authQA.tokens,password_login:true}):json({ login_ticket: 'synthetic-ticket', telegram_linked: true, phone_hint: '+998 ** *** ** 41' });
    }
    if (path === '/api/v1/auth/admin-login/send-otp/') return json({ otp_sent: true });
    if (path === '/api/v1/auth/admin-login/verify-otp/') return body?.verification_code === '123456' ? json(authQA.tokens) : json({ detail: 'Invalid OTP' }, 401);
    if (path === '/api/v1/tenants/current/') return json({ id: 7, usd_rate: '12800', receipt_settings: { tax_regime: 'aos', vat_enabled: false, vat_rate: '0', vat_price_mode: 'included' } });
    if (path === '/api/v1/catalog/categories/') return json([{ id: 1, name: 'Sinov', kod: '01', currency: 'UZS' }]);
    if (path === '/api/v1/catalog/variants/') return json({ count: 1, results: [{ id: 51, product: 51, product_name: 'Qoralama mahsuloti', name: 'Standart', stock_quantity: '100', price_recommended: '10000', price_min: '9000', cost_price: '5000', currency: 'UZS', unit: 'dona', barcode: '00051', category: 1, expired_batches: [] }] });
    if (path === '/api/v1/cashbox/shift/current/') return json({ id: 1, opened_at: '2026-10-16T07:00:00Z' });
    if (path.includes('/notifications/')) return json({ results: [], unread_count: 0 });
    if (path.includes('/counterparties/')) return json({ results: [], count: 0 });
    if (path === '/api/v1/platform/support-unread/') return json({ unread: 0 });
    if (path === '/api/v1/platform/overview/') return json({ counts: {}, activity: [] });
    if (path === '/api/v1/docs/') return json({ documents: [] });
    if (path === '/api/v1/support/metadata/') return json({ phone: '', telegram_username: '', languages: ['uz'] });
    if (path === '/api/v1/support/guest/') return json({ results: guestHistory && options.headers?.['X-Support-Token'] === 'a'.repeat(64) ? [{ ...conversation, id: 'guest-chat' }] : [], unread_total: 0 });
    if (path.endsWith('/guest/guest-chat/messages/')) return json({ results: [{ ...message, id: 7, text: 'GUEST_HISTORY_SENTINEL' }], has_more: false });
    if (path.endsWith('/guest/guest-chat/')) return json({ ...conversation, id: 'guest-chat' });
    if (path.startsWith('/api/v1/support/guest/')) return json({ detail: 'Not found' }, 404);
    if (path === '/api/v1/support/inbox/' || path === '/api/v1/support/conversations/') {
      if (authQA.holdList) await new Promise(resolve => authQA.pendingLists.push(resolve));
      return json({ results: [conversation], unread_total: 0 });
    }
    if (path.endsWith('/private-41/messages/')) return json({ results: url.searchParams.has('after_id') ? [] : [message], has_more: false });
    if (path.endsWith('/private-41/')) return json(conversation);
    throw new Error(`Unexpected synthetic API request: ${path}`);
  };
}
