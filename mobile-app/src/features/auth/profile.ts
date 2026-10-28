import type { UserProfile, UserTenant } from './AuthContext';
import { ApiError } from '../../api/errors';

export function validateProfile(value: any): UserProfile {
  if (!value || !Number.isInteger(value.id) || value.id < 1 || !['owner', 'staff', 'platform_admin'].includes(value.role) || !Array.isArray(value.tenants)) throw new ApiError('Server profili tasdiqlanmadi. Qayta urinib ko‘ring.', 502);
  for (const tenant of value.tenants) {
    if (!Number.isInteger(tenant.id) || tenant.id < 1 || typeof tenant.name !== 'string' || typeof tenant.is_owner !== 'boolean' || !Array.isArray(tenant.permissions) || tenant.permissions.some((permission: unknown) => typeof permission !== 'string')) throw new ApiError('Do‘kon vakolatlari tasdiqlanmadi.', 502);
  }
  return { ...value, first_name: value.first_name || '', last_name: value.last_name || '', phone_number: value.phone_number || '', terms_accepted: value.terms_accepted === true };
}
export function chooseTenant(profile: UserProfile, storedId: string | null): UserTenant | null {
  if (profile.role === 'platform_admin') return null;
  return profile.tenants.find(tenant => String(tenant.id) === storedId) || (profile.tenants.length === 1 ? profile.tenants[0] : null);
}
