import type { UserProfile, UserTenant } from './AuthContext';
export const ownerOnly = new Set(['employees.hire_employee', 'employees.fire_employee', 'employees.change_employee_permissions', 'sales.correct_debt_payment']);
/** Match the active membership; never union permissions across stores. Server checks remain authoritative. */
export function hasPermission(user: UserProfile | null, tenant: UserTenant | null, permission: string): boolean {
  if (!user || user.terms_accepted !== true || user.role === 'platform_admin' || !tenant) return false;
  const member = user.tenants.find(item => item.id === tenant.id);
  if (!member) return false;
  if (member.is_owner) return true;
  return !ownerOnly.has(permission) && member.permissions.includes(permission);
}
export const modulePermissions: Record<string, string | string[]> = {
  Product: 'catalog.view_product', NewProduct: 'catalog.add_product', Categories: 'catalog.view_category', Tovar: 'catalog.view_product', Savdo: 'sales.add_sale', Checkout: 'sales.add_sale',
  Qarz: ['sales.manage_counterparty', 'sales.record_debt_payment'], Customers: ['sales.manage_counterparty', 'sales.record_debt_payment'], Customer: ['sales.manage_counterparty', 'sales.record_debt_payment'],
  Documents: 'sales.view_sale', ReceiptView: 'sales.view_sale', ShareSheet: 'sales.view_sale', PdfExport: 'sales.view_sale',
  SalesHistory: 'sales.view_sale',
  Cashbox: 'cashbox.view_cashbox',
  B2B: 'sales.manage_b2b',
  StoreSettings: 'tenants.manage_settings',
  Inventory: 'inventory.view_stock', Reports: ['analytics.view_dashboard', 'cashbox.view_cashbox'],
};
export function canOpenModule(user: UserProfile | null, tenant: UserTenant | null, module: string) {
  if (module === 'Employees') return Boolean(user?.terms_accepted && (user.role === 'platform_admin' || user.role === 'owner' && tenant && user.tenants.some(row => row.id === tenant.id && row.is_owner)));
  if (['Profile', 'Notifications'].includes(module)) return Boolean(user?.terms_accepted && (user.role === 'platform_admin' || tenant && user.tenants.some(row => row.id === tenant.id)));
  if (module === 'History') return Boolean(user?.terms_accepted && user.role === 'owner' && tenant && user.tenants.some(row => row.id === tenant.id && row.is_owner));
  if (module === 'Admin') return user?.role === 'platform_admin';
  if (user?.role === 'platform_admin') return ['Settings', 'Stores', 'Support', 'Downloads'].includes(module);
  const required = modulePermissions[module];
  return !required || (Array.isArray(required) ? required.some(value => hasPermission(user, tenant, value)) : hasPermission(user, tenant, required));
}
