import { chooseTenant, validateProfile } from '../src/features/auth/profile';
const member = { id: 10, name: 'Store', is_owner: false, permissions: ['sales.create_sale'] };
describe('Authoritative account membership', () => {
  test('permissions from /auth/me remain intact', () => {
    const profile = validateProfile({ id: 1, role: 'staff', tenants: [member] });
    expect(profile.tenants[0].permissions).toEqual(['sales.create_sale']);
    expect(profile.terms_accepted).toBe(false);
  });
  test('thin tenant metadata is not accepted as proof of membership', () => expect(() => validateProfile({ id: 1, role: 'staff', tenants: [{ id: 10, name: 'Thin' }] })).toThrow());
  test('multiple stores require an explicit choice unless a valid stored choice exists', () => {
    const profile = validateProfile({ id: 1, role: 'staff', tenants: [member, { ...member, id: 20 }] });
    expect(chooseTenant(profile, null)).toBeNull();
    expect(chooseTenant(profile, '20')?.id).toBe(20);
    expect(chooseTenant(profile, '30')).toBeNull();
  });
  test('a single store is selected and admin has no implicit commercial store', () => {
    expect(chooseTenant(validateProfile({ id: 1, role: 'owner', tenants: [{ ...member, is_owner: true }] }), null)?.id).toBe(10);
    expect(chooseTenant(validateProfile({ id: 2, role: 'platform_admin', tenants: [member] }), null)).toBeNull();
  });
});
