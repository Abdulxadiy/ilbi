import { localStore, sessionStore, markAuthenticationCurrent } from '../utils/brandStorage.js';
import { captureRequestValidation, reportRequestValidation } from '../utils/formValidation.js';
import { redactRequestError, safeApiErrorMessage, safeDisplayText } from '../utils/safePresentation.js';
/**
 * ILBI API Client with JWT Interceptor & Automatic Refresh
 */

const BASE_URL = '/api/v1';
let authenticationGeneration = 0;
export const getAuthenticationGeneration = () => authenticationGeneration;
export const invalidateAuthenticationRequests = () => { authenticationGeneration += 1; };

const queryString = (params = {}) => new URLSearchParams(Object.entries(params).filter(
  ([, value]) => value !== undefined && value !== null && value !== '',
)).toString();

// Token Management
export const isRememberMeActive = () => {
  return localStore.getItem('ilbi_remember_me') !== 'false';
};

export const getAccessToken = () =>
  localStore.getItem('ilbi_access_token') ||
  sessionStore.getItem('ilbi_access_token');

export const getRefreshToken = () =>
  localStore.getItem('ilbi_refresh_token') ||
  sessionStore.getItem('ilbi_refresh_token');

export const setTokens = (access, refresh, remember = null, preserveSession = false) => {
  if (!preserveSession) invalidateAuthenticationRequests();
  const shouldRemember = remember !== null
    ? remember
    : (Boolean(localStore.getItem('ilbi_access_token') || localStore.getItem('ilbi_refresh_token')) || isRememberMeActive());

  if (shouldRemember) {
    if (access) localStore.setItem('ilbi_access_token', access);
    if (refresh) localStore.setItem('ilbi_refresh_token', refresh);
    sessionStore.removeItem('ilbi_access_token');
    sessionStore.removeItem('ilbi_refresh_token');
  } else {
    if (access) sessionStore.setItem('ilbi_access_token', access);
    if (refresh) sessionStore.setItem('ilbi_refresh_token', refresh);
    localStore.removeItem('ilbi_access_token');
    localStore.removeItem('ilbi_refresh_token');
  }
};

export const clearTokens = () => {
  invalidateAuthenticationRequests();
  localStore.removeItem('ilbi_access_token');
  localStore.removeItem('ilbi_refresh_token');
  localStore.removeItem('ilbi_user');
  sessionStore.removeItem('ilbi_access_token');
  sessionStore.removeItem('ilbi_refresh_token');
  sessionStore.removeItem('ilbi_user');
  markAuthenticationCurrent();
};

export const parseJwt = (token) => {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
};

export const isTokenExpired = (token) => {
  if (!token) return true;
  try {
    const payload = parseJwt(token);
    if (!payload || !payload.exp) return true;
    return payload.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
};

export const resolveAvatarUrl = (raw) => {
  if (!raw || typeof raw !== 'string') return null;
  let url = raw.trim();
  url = url.replace(/^https?:\/\/(?:nginx|ilbi|inventra)(?::\d+)?(?=\/|$)/i, '');
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  return url.startsWith('/') ? url : `/${url}`;
};

export const resolveMediaUrl = resolveAvatarUrl;

async function handleResponse(response, responseType, requestBody) {
  if (response.status === 204) {
    return null;
  }
  if (response.ok && responseType === 'blob') return response.blob();

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  let data = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    data = redactRequestError(data, requestBody);
    if (response.status === 423 && typeof window !== 'undefined' && window.ilbiDesktop) window.dispatchEvent(new Event('desktop:locked'));
    let errorMsg = 'Kutilmagan xatolik yuz berdi';

    if (response.status === 429) {
      errorMsg =
        (typeof data === 'object' && (data?.detail || data?.message || data?.error?.message)) ||
        (typeof data === 'object' && data?.retry_after_seconds
          ? `Iltimos, ${data.retry_after_seconds} soniyadan keyin qayta urinib ko'ring.`
          : null) ||
        "So'rovlar soni me'yordan oshib ketdi (429 Too Many Requests). Iltimos, biroz kuting.";
    } else if (data && typeof data === 'object') {
      if (data.error === 'telegram_send_failed') {
        errorMsg = data.detail || 'Telegram bot orqali tasdiqlash kodini yuborib bo‘lmadi. Iltimos, Telegramda @ilbi_bot ga kirib, /start bosing va telefon raqamingizni ulang.';
      } else if (data.error === 'telegram_contact_not_found') {
        errorMsg = data.detail || 'Telefon raqamingiz Telegram botga ulanmagan. Iltimos, Telegramda @ilbi_bot ga kirib, /start bosing va telefon raqamingizni ulang.';
      } else {
        errorMsg =
          data.detail ||
          data.message ||
          (typeof data.error === 'string' ? data.error : data.error?.message) ||
          safeApiErrorMessage(data, response.status);
      }
    } else if (typeof data === 'string') {
      if (data.trim().startsWith('<')) {
        errorMsg = `Server xatoligi (${response.status} ${response.statusText || ''})`.trim();
      } else {
        errorMsg = data;
      }
    }

    const err = new Error(response.status >= 500 ? safeApiErrorMessage(data, response.status) : safeDisplayText(errorMsg));
    err.status = response.status;
    err.data = data;
    err.retryAfterMs = Number(response.headers.get('Retry-After') || 0) * 1000;
    throw err;
  }

  return data;
}

let refreshOperation = null;

export function refreshAccessToken() {
  const refresh = getRefreshToken();
  const generation = getAuthenticationGeneration();
  if (refreshOperation?.refresh === refresh && refreshOperation.generation === generation) return refreshOperation.promise;
  const operation = { refresh, generation };
  operation.promise = (async () => {
    if (!refresh || isTokenExpired(refresh)) {
      const error = new Error('Sessiya muddati tugadi. Qaytadan kiring.');
      error.status = 401;
      throw error;
    }
    const response = await fetch(`${BASE_URL}/auth/token/refresh/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        ...(typeof window !== 'undefined' && window.ilbiDesktop && !parseJwt(refresh)?.desktop_device ? { 'X-ILBI-Cloud-Session': 'true' } : {}) },
      body: JSON.stringify({ refresh }),
    });
    const data = await handleResponse(response, undefined, { refresh });
    if (getAuthenticationGeneration() !== generation || getRefreshToken() !== refresh) throw new Error('Sessiya o‘zgargan.');
    setTokens(data.access, data.refresh || refresh, null, true);
    window.dispatchEvent(new CustomEvent('auth:token', { detail: data.access }));
    return data.access;
  })().catch((error) => {
    if (getAuthenticationGeneration() === generation && getRefreshToken() === refresh && (error.status === 401 || !refresh || isTokenExpired(refresh))) {
      clearTokens();
      window.dispatchEvent(new Event('auth:logout'));
    }
    throw error;
  }).finally(() => { if (refreshOperation === operation) refreshOperation = null; });
  refreshOperation = operation;
  return operation.promise;
}

export async function request(endpoint, options = {}) {
  const validation = captureRequestValidation(options.method, options.body);
  const generation = getAuthenticationGeneration();
  const assertCurrentSession = () => {
    if (getAuthenticationGeneration() !== generation) throw new Error('Sessiya o‘zgargan. Amalni qayta boshlang.');
  };
  const url = `${BASE_URL}${endpoint}`;
  let body = options.body;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body && !isFormData && typeof body === 'object' && !(body instanceof Blob)) {
    body = JSON.stringify(body);
  }
  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {}),
  };

  const userId = parseJwt(getAccessToken())?.user_id;
  const tenantStorageKey = userId ? `ilbi_active_tenant:${userId}` : null;
  const activeTenantId = tenantStorageKey
    ? sessionStore.getItem(tenantStorageKey) || localStore.getItem(tenantStorageKey)
    : null;
  if (activeTenantId && !options.skipTenant && !endpoint.startsWith('/auth/') && !endpoint.startsWith('/tenants/my/')) {
    headers['X-Tenant-ID'] = activeTenantId;
  }

  const token = getAccessToken();
  if (typeof window !== 'undefined' && window.ilbiDesktop && token && !parseJwt(token)?.desktop_device) {
    headers['X-ILBI-Cloud-Session'] = 'true';
  }
  const isPublicAuth = endpoint.startsWith('/auth/admin-login') || endpoint.startsWith('/auth/password-reset') || endpoint.startsWith('/auth/token');
  if (token && !isPublicAuth && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const config = {
    ...options,
    body,
    headers,
  };

  try {
    let response = await fetch(url, config);
    assertCurrentSession();

    const isAuthRoute = endpoint.startsWith('/auth/admin-login')
      || endpoint.startsWith('/auth/token') || endpoint.startsWith('/auth/password-reset');
    if (response.status === 401 && !options._retry && !isAuthRoute) {
      if (String(parseJwt(getAccessToken())?.user_id) !== String(parseJwt(token)?.user_id)) {
        throw new Error('Hisob o‘zgargan. Amalni qayta boshlang.');
      }
      const refreshed = getAccessToken() !== token && !isTokenExpired(getAccessToken())
        ? getAccessToken() : await refreshAccessToken();
      assertCurrentSession();
      headers.Authorization = `Bearer ${refreshed}`;
      response = await fetch(url, { ...config, headers });
      assertCurrentSession();
      if (response.status === 401 && getAccessToken() === refreshed) {
        clearTokens();
        window.dispatchEvent(new Event('auth:logout'));
      }
    }

    const result = await handleResponse(response, options.responseType, options.body);
    assertCurrentSession();
    return result;
  } catch (error) {
    const currentTenant = tenantStorageKey ? sessionStore.getItem(tenantStorageKey) || localStore.getItem(tenantStorageKey) : null;
    if (generation === getAuthenticationGeneration() && currentTenant === activeTenantId) reportRequestValidation(error, validation);
    throw error;
  }
}

// -------------------------------------------------------------
// Specialized API Endpoints (Complete ILBI v0.9 API Coverage)
// -------------------------------------------------------------

export const authApi = {
  adminLogin: (username, password) =>
    request('/auth/admin-login/', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  telegramStatus: (login_ticket) =>
    request('/auth/admin-login/telegram-status/', {
      method: 'POST',
      body: JSON.stringify({ login_ticket }),
    }),

  sendTelegramOtp: (login_ticket) =>
    request('/auth/admin-login/send-otp/', {
      method: 'POST',
      body: JSON.stringify({ login_ticket }),
    }),

  verifyOtp: (login_ticket, verification_code) =>
    request('/auth/admin-login/verify-otp/', {
      method: 'POST',
      body: JSON.stringify({ login_ticket, verification_code }),
    }),

  passwordResetRequest: (identifier) => {
    const ident = (typeof identifier === 'string' ? identifier : identifier?.email || identifier?.login || '').trim();
    const payload = ident.includes('@') ? { email: ident, login: ident } : { login: ident };
    return request('/auth/password-reset/request/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  changePasswordWithOld: ({ login, old_password, new_password }) =>
    request('/auth/password-reset/change-with-old/', {
      method: 'POST',
      body: JSON.stringify({ login, old_password, new_password }),
    }),

  passwordResetVerify: (token) =>
    request('/auth/password-reset/verify/?token=' + encodeURIComponent(token)),

  passwordResetConfirm: (data) =>
    request('/auth/password-reset/confirm/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  passwordResetResume: (token) =>
    request('/auth/password-reset/resume/', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  getProfile: () => request('/auth/me/'),

  updateProfile: (data) =>
    request('/auth/profile/', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  changePassword: (old_password, new_password) =>
    request('/auth/change-password/', {
      method: 'POST',
      body: JSON.stringify({ old_password, new_password }),
    }),

  uploadAvatar: (formData) =>
    request('/auth/profile/avatar/', {
      method: 'POST',
      body: formData,
    }),

  deleteAvatar: () =>
    request('/auth/profile/avatar/', {
      method: 'DELETE',
    }),

  unban: (target_user_id) =>
    request('/auth/unban/', {
      method: 'POST',
      body: JSON.stringify({ target_user_id }),
    }),

  acceptTerms: () =>
    request('/auth/accept-terms/', {
      method: 'POST',
    }),
};

export const docsApi = {
  getDocsList: () => request('/docs/'),
  getDoc: (docKey) => request(`/docs/?doc=${encodeURIComponent(docKey)}`),
  updateDoc: (docKey, content) =>
    request('/docs/', {
      method: 'PUT',
      body: JSON.stringify({ doc: docKey, content }),
    }),
};

export const analyticsApi = {
  getDashboard: (period = 'today', startDate = null, endDate = null, tenantId = null, options = {}) => {
    let q = `?period=${period}`;
    if (period === 'custom' && startDate && endDate) {
      q += `&start_date=${startDate}&end_date=${endDate}`;
    }
    if (tenantId) {
      q += `&tenant_id=${tenantId}`;
    }
    return request(`/analytics/dashboard/${q}`, options);
  },
};

export const tenantApi = {
  getEmployeePermissions: (tenantId) => request(`/tenants/${tenantId}/employees/permissions/`),
  getMyTenants: () => request('/tenants/my/'),
  createMyTenant: (data) => request('/tenants/my/', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  bindMyTenantSellerProfile: (tenantId, sellerProfileId) => request(`/tenants/my/${tenantId}/seller-profile/`, {
    method: 'PATCH',
    body: JSON.stringify({ seller_profile_id: sellerProfileId || null }),
  }),
  getSellerProfiles: () => request('/tenants/seller-profiles/'),
  getSellerProfilesForReview: (params = {}) => {
    const query = new URLSearchParams();
    for (const key of ['status', 'q', 'page', 'page_size']) {
      if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
        query.set(key, String(params[key]));
      }
    }
    return request(`/tenants/seller-profiles/review/${query.size ? `?${query}` : ''}`);
  },
  reviewSellerProfile: (id, data) => request(`/tenants/seller-profiles/${id}/review/`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getTransferTargets: () => request('/tenants/current/transfer-targets/'),
  createSellerProfile: (data) => request('/tenants/seller-profiles/', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  updateSellerProfile: (id, data) => request(`/tenants/seller-profiles/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),
  getTenants: (params = {}, options = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/tenants/${query ? `?${query}` : ''}`, options);
  },
  createTenant: (data) =>
    request('/tenants/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  resendOwnerInvite: (id) => request(`/tenants/${id}/resend-owner-invite/`, {
    method: 'POST',
  }),
  updateTenant: (id, data) =>
    request(`/tenants/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  changeOwner: (id, payload) =>
    request(`/tenants/${id}/change-owner/`, {
      method: 'POST',
      body: JSON.stringify(
        typeof payload === 'object' && payload !== null
          ? payload
          : { new_owner_id: payload }
      ),
    }),
  activateTenant: (id) =>
    request(`/tenants/${id}/activate/`, {
      method: 'POST',
    }),
  deactivateTenant: (id) =>
    request(`/tenants/${id}/deactivate/`, {
      method: 'POST',
    }),
  hireEmployee: (tenantId, data) =>
    request(`/tenants/${tenantId}/employees/hire/`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getEmployees: (tenantId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/tenants/${tenantId}/employees/${query ? `?${query}` : ''}`);
  },
  updateEmployee: (tenantId, employeeId, data) =>
    request(`/tenants/${tenantId}/employees/${employeeId}/`, { method: 'PATCH', body: JSON.stringify(data) }),
  resendEmployeeInvite: (tenantId, employeeId) =>
    request(`/tenants/${tenantId}/employees/${employeeId}/resend-invite/`, { method: 'POST' }),
  setEmployeeBlocked: (tenantId, employeeId, blocked, reason) =>
    request(`/tenants/${tenantId}/employees/${employeeId}/account-status/`, { method: 'POST', body: JSON.stringify({ blocked, reason }) }),
  archiveEmployee: (tenantId, employeeId, reason) =>
    request(`/tenants/${tenantId}/employees/${employeeId}/`, { method: 'DELETE', body: JSON.stringify({ reason }) }),
  restoreEmployee: (tenantId, employeeId, reason) =>
    request(`/tenants/${tenantId}/employees/${employeeId}/restore/`, { method: 'POST', body: JSON.stringify({ reason }) }),
  fireEmployee: (tenantId, targetUserId) =>
    request(`/tenants/${tenantId}/employees/fire/`, {
      method: 'POST',
      body: JSON.stringify({ target_user_id: targetUserId }),
    }),
  getCurrentTenant: (params = {}, options = {}) => {
    const q = params.tenant_id ? `?tenant_id=${params.tenant_id}` : '';
    return request(`/tenants/current/${q}`, {
      ...options,
      ...(params.tenant_id ? { skipTenant: true, headers: { ...options.headers, 'X-Tenant-ID': String(params.tenant_id) } } : {}),
    });
  },
  updateCurrentTenant: (data, params = {}) => {
    const q = params.tenant_id ? `?tenant_id=${params.tenant_id}` : '';
    return request(`/tenants/current/${q}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },
  testTelegram: (data = {}) =>
    request('/tenants/current/test-telegram/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  sendDailyReportNow: (data = {}) =>
    request('/tenants/current/send-report-now/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  sendLowStockReportNow: (data = {}) =>
    request('/tenants/current/send-low-stock-report-now/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

export const catalogApi = {
  getImportTemplate: () => request('/catalog/import/template/', { responseType: 'blob' }),
  previewImport: (body) => request('/catalog/import/preview/', { method: 'POST', body }),
  commitImport: (id) => request(`/catalog/import/${id}/commit/`, { method: 'POST' }),
  generateBarcode: (id, params = {}) =>
    request(`/catalog/variants/${id}/barcode/${params?.force ? '?force=true' : ''}`, {
      method: 'POST',
      body: Object.keys(params).length ? JSON.stringify(params) : undefined,
    }),
  getCategories: () => request('/catalog/categories/'),
  createCategory: (data) =>
    request('/catalog/categories/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateCategory: (id, data) =>
    request(`/catalog/categories/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteCategory: (id) =>
    request(`/catalog/categories/${id}/`, {
      method: 'DELETE',
    }),
  createProduct: (data) =>
    request('/catalog/products/', {
      method: 'POST',
      body: data instanceof FormData ? data : JSON.stringify(data),
    }),
  getProduct: (id) => request(`/catalog/products/${id}/`),
  updateProduct: (id, data) =>
    request(`/catalog/products/${id}/`, {
      method: 'PATCH',
      body: data instanceof FormData ? data : JSON.stringify(data),
    }),
  deleteProduct: (id) =>
    request(`/catalog/products/${id}/`, {
      method: 'DELETE',
    }),
  archiveProduct: (id) =>
    request(`/catalog/products/${id}/archive/`, {
      method: 'POST',
    }),
  unarchiveProduct: (id) =>
    request(`/catalog/products/${id}/unarchive/`, {
      method: 'POST',
    }),
  uploadProductImage: (productId, formData) =>
    request(`/catalog/products/${productId}/images/`, {
      method: 'POST',
      body: formData,
    }),
  deleteProductImage: (productId, imageId) =>
    request(`/catalog/products/${productId}/images/${imageId}/`, {
      method: 'DELETE',
    }),

  createVariant: (productId, data) =>
    request(`/catalog/products/${productId}/variants/`, {
      method: 'POST',
      body: data instanceof FormData ? data : JSON.stringify(data),
    }),
  getVariants: (params = {}, options = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    }
    const qs = query.toString();
    return request(`/catalog/variants/${qs ? `?${qs}` : ''}`, options);
  },
  updateVariant: (id, data) =>
    request(`/catalog/variants/${id}/`, {
      method: 'PATCH',
      body: data instanceof FormData ? data : JSON.stringify(data),
    }),
  archiveVariant: (id) =>
    request(`/catalog/variants/${id}/archive/`, {
      method: 'POST',
    }),
  unarchiveVariant: (id) =>
    request(`/catalog/variants/${id}/unarchive/`, {
      method: 'POST',
    }),
};

export const inventoryApi = {
  getSuppliers: () => request('/inventory/suppliers/'),
  getBatches: (params = {}) => request(`/inventory/batches/?${new URLSearchParams(params)}`),
  getStock: (pageOrParams = 1, search = '', options = {}) => {
    if (typeof pageOrParams === 'object' && pageOrParams !== null) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(pageOrParams)) {
        if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
      }
      const qs = query.toString();
      return request(`/inventory/stock/${qs ? `?${qs}` : ''}`, typeof search === 'object' ? search : options);
    }
    let q = `?page=${pageOrParams}`;
    if (search) q += `&search=${encodeURIComponent(search)}`;
    return request(`/inventory/stock/${q}`);
  },
  getStockDetail: (variantId) => {
    return request(`/inventory/stock/${variantId}/`);
  },
  getMovements: (pageOrParams = 1, options = {}) => {
    const params = typeof pageOrParams === 'object' ? pageOrParams : { page: pageOrParams };
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    }
    return request(`/inventory/movements/?${query}`, options);
  },
  batchStockIntake: (data) =>
    request('/inventory/intake/batch/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  adjustStock: (data) =>
    request('/inventory/adjust/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  customerReturn: (data) =>
    request('/inventory/customer-return/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  supplierReturn: (data) =>
    request('/inventory/supplier-return/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  writeOff: (data) =>
    request('/inventory/write-off/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getDeficits: (search = '') => {
    const q = search ? `?search=${encodeURIComponent(search)}` : '';
    return request(`/inventory/deficits/${q}`);
  },

  // Internal tenant-to-tenant stock movements (separate from B2B sales).
  getTransfers: () => request('/inventory/transfers/'),
  createTransfer: (data) =>
    request('/inventory/transfers/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  acceptTransfer: (id, data) =>
    request(`/inventory/transfers/${id}/receive/`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  returnTransfer: (id, data) =>
    request(`/inventory/transfers/${id}/return/`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  closeTransferDiscrepancy: (id, reason) =>
    request(`/inventory/transfers/${id}/close-discrepancy/`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
};

export const salesApi = {
  getSales: (pageOrParams = 1, search = '', options = {}) => {
    const params = typeof pageOrParams === 'object' ? pageOrParams : { page: pageOrParams, search };
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    }
    return request(`/sales/?${query}`, typeof search === 'object' ? search : options);
  },
  getSaleDetail: (id, options = {}) => request(`/sales/${id}/`, options),
  rotateReceiptToken: (id) => request(`/sales/${id}/receipt-token/rotate/`, { method: 'POST' }),
  getPublicReceipt: (token) =>
    request(`/sales/public/receipt/${encodeURIComponent(token)}/`),
  createSale: (saleData) =>
    request('/sales/', {
      method: 'POST',
      body: JSON.stringify(saleData),
    }),
  voidSale: (saleId, reason) =>
    request(`/sales/${saleId}/void/`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  voidSaleItem: (saleItemId, payload) => {
    const body = typeof payload === 'string' ? { reason: payload, quantity: 1 } : payload;
    return request(`/sales/items/${saleItemId}/void/`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  getCounterparties: (params = {}, options = {}) => request(
    `/sales/counterparties/?${queryString(typeof params === 'string' ? { search: params } : params)}`, options,
  ),
  createCounterparty: (data) =>
    request('/sales/counterparties/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getCounterpartyImportTemplate: () => request('/sales/counterparties/import/template/', { responseType: 'blob' }),
  previewCounterpartyImport: (body) => request('/sales/counterparties/import/preview/', { method: 'POST', body }),
  commitCounterpartyImport: (id) => request(`/sales/counterparties/import/${id}/commit/`, { method: 'POST' }),
  getCounterparty: (id, options = {}) => request(`/sales/counterparties/${id}/`, options),
  updateCounterparty: (id, data) =>
    request(`/sales/counterparties/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteCounterparty: (id) =>
    request(`/sales/counterparties/${id}/`, {
      method: 'DELETE',
    }),

  getCounterpartySales: (counterpartyId, params = {}, options = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/sales/counterparties/${counterpartyId}/sales/${qs ? '?' + qs : ''}`, options);
  },
  getCounterpartyPayments: (id, params = { page: 1 }, options = {}) => request(
    `/sales/counterparties/${id}/payments/?${queryString(typeof params === 'object' ? params : { page: params })}`, options,
  ),
  recordDebtPayment: (counterpartyId, data) =>
    request(`/sales/counterparties/${counterpartyId}/payments/`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  correctDebtPayment: (counterpartyId, data) =>
    request(`/sales/counterparties/${counterpartyId}/payments/correct/`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getB2BInbox: (params = {}, options = {}) => request(`/sales/b2b/inbox/?${queryString(params)}`, options),
  acceptB2B: (saleId, itemsPayload) =>
    request(`/sales/b2b/${saleId}/accept/`, {
      method: 'POST',
      body: JSON.stringify(itemsPayload || { items: [] }),
    }),
  rejectB2B: (saleId, reason) =>
    request(`/sales/b2b/${saleId}/reject/`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  receiveB2BReturn: (saleId, payload) =>
    request(`/sales/b2b/${saleId}/returns/receive/`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  closeB2BReturnDiscrepancy: (saleId, payload) =>
    request(`/sales/b2b/${saleId}/returns/close-discrepancy/`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getNotifications: (params = {}, options = {}) => request(`/sales/notifications/?${queryString(params)}`, options),
  markAllNotificationsRead: () => request('/sales/notifications/read-all/', { method: 'POST' }),
  markNotificationRead: (id) =>
    request(`/sales/notifications/${id}/read/`, {
      method: 'POST',
    }),
  clearAllNotifications: () =>
    request('/sales/notifications/', {
      method: 'DELETE',
    }),
  deleteNotification: (id) =>
    request(`/sales/notifications/${id}/`, {
      method: 'DELETE',
    }),
};

export const cashboxApi = {
  openShift: (data) => request('/cashbox/shift/open/', { method: 'POST', body: data }),
  getCurrentShift: (params = {}, options = {}) => request(`/cashbox/shift/current/?${queryString(typeof params === 'object' ? params : {})}`, options),
  closeShift: (data) =>
    request('/cashbox/shift/close/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getExpenses: (params = {}, options = {}) => request(`/cashbox/expenses/?${queryString(params)}`, options),
  createExpense: (data) =>
    request('/cashbox/expenses/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getIncome: (params = {}, options = {}) => request(`/cashbox/income/?${queryString(params)}`, options),
  createIncome: (data) =>
    request('/cashbox/income/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getReports: (params = { page: 1 }, options = {}) => request(
    `/cashbox/reports/?${queryString(typeof params === 'object' ? params : { page: params })}`, options,
  ),
  getReportDetail: (id) => request(`/cashbox/reports/${id}/`),
};

export const auditApi = {
  getHistory: (params = {}, options = {}) => request(`/audit/history/?${queryString(params)}`, options),
  getHistoryDetail: (source, id, params = {}, options = {}) => request(
    `/audit/history/${encodeURIComponent(source)}/${id}/?${queryString(params)}`, options,
  ),
  getLogs: (params = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.append('page', params.page);
    if (params.action) query.append('action', params.action);
    if (params.actor) query.append('actor', params.actor);
    if (params.target_model) query.append('target_model', params.target_model);
    if (params.tenant_id) query.append('tenant_id', params.tenant_id);
    const qs = query.toString();
    return request(`/audit/logs/${qs ? `?${qs}` : ''}`);
  },
};
