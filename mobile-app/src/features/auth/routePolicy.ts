import type { UserProfile, UserTenant } from './AuthContext';
export function sessionEntry(user: UserProfile | null, tenant: UserTenant | null): '/login' | '/terms' | '/stores' | '/(app)/admin' | '/(app)/(tabs)' {
  if (!user) return '/login';
  if (user.terms_accepted !== true) return '/terms';
  if (user.role === 'platform_admin') return '/(app)/admin';
  if (!tenant || !user.tenants.some(member => member.id === tenant.id)) return '/stores';
  return '/(app)/(tabs)';
}
