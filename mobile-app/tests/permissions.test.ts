import { canOpenModule, hasPermission } from '../src/features/auth/permissions';
import type { UserProfile, UserTenant } from '../src/features/auth/AuthContext';
const a: UserTenant = { id: 1, name: 'A', is_owner: false, permissions: ['sales.add_sale', 'sales.record_debt_payment'] };
const b: UserTenant = { id: 2, name: 'B', is_owner: false, permissions: ['analytics.view_dashboard'] };
const user = { id: 1, role: 'staff', terms_accepted: true, tenants: [a, b], permissions: ['*', 'catalog.view_product'] } as UserProfile;
describe('Active-store permissions', () => {
  test('does not union grants from other stores or flattened profile permissions', () => {
    expect(hasPermission(user, a, 'sales.add_sale')).toBe(true);
    expect(hasPermission(user, a, 'analytics.view_dashboard')).toBe(false);
    expect(hasPermission(user, a, 'catalog.view_product')).toBe(false);
    expect(hasPermission(user, b, 'sales.add_sale')).toBe(false);
  });
  test('rejects forged/stale membership and unaccepted terms', () => {
    expect(hasPermission(user, { ...a, id: 99, is_owner: true }, 'sales.add_sale')).toBe(false);
    expect(hasPermission({ ...user, tenants: [] }, a, 'sales.add_sale')).toBe(false);
    expect(hasPermission({ ...user, terms_accepted: false }, a, 'sales.add_sale')).toBe(false);
  });
  test('ownership comes from current membership, not global owner role or passed tenant flag', () => {
    expect(hasPermission({ ...user, role: 'owner' }, a, 'catalog.change_product')).toBe(false);
    expect(hasPermission(user, { ...a, is_owner: true }, 'catalog.change_product')).toBe(false);
    expect(hasPermission({ ...user, tenants: [{ ...a, is_owner: true }] }, a, 'catalog.change_product')).toBe(true);
  });
  test('owner-only grants cannot be assigned to staff', () => {
    const member = { ...a, permissions: ['sales.correct_debt_payment', 'employees.hire_employee'] };
    const staff = { ...user, tenants: [member] };
    expect(hasPermission(staff, member, 'sales.correct_debt_payment')).toBe(false);
    expect(hasPermission(staff, member, 'employees.hire_employee')).toBe(false);
  });
  test('debt recorder can open customer/debt reads without general customer management', () => {
    expect(canOpenModule(user, a, 'Qarz')).toBe(true);
    expect(canOpenModule(user, a, 'Customers')).toBe(true);
    expect(canOpenModule(user, a, 'Tovar')).toBe(false);
  });
  test('platform operator enters administration, with no retail navigation', () => {
    const admin = { ...user, role: 'platform_admin' } as UserProfile;
    expect(canOpenModule(admin, null, 'Admin')).toBe(true);
    expect(canOpenModule(admin, null, 'Savdo')).toBe(false);
    expect(hasPermission(admin, a, 'sales.add_sale')).toBe(false);
  });
  test('cashbox navigation requires the active store read grant', () => {
    const membership = { ...b, permissions: ['cashbox.view_cashbox'] };
    const staff = { ...user, tenants: [a, membership] };
    expect(canOpenModule(staff, a, 'Cashbox')).toBe(false);
    expect(canOpenModule(staff, membership, 'Cashbox')).toBe(true);
    expect(canOpenModule(staff, membership, 'Reports')).toBe(true);
  });
  test('B2B navigation checks the current membership and denies platform operators', () => {
    const membership = { ...b, permissions: ['sales.manage_b2b'] };
    const staff = { ...user, tenants: [a, membership] };
    expect(canOpenModule(staff, a, 'B2B')).toBe(false);
    expect(canOpenModule(staff, membership, 'B2B')).toBe(true);
    expect(canOpenModule({ ...staff, role: 'platform_admin' }, membership, 'B2B')).toBe(false);
  });
});
