import { useAuth } from './AuthContext';
import { canOpenModule, hasPermission } from './permissions';
import { ApiError } from '../../api/errors';
export function usePermissions() {
  const { user, activeTenant } = useAuth();
  const can = (permission: string) => hasPermission(user, activeTenant, permission);
  const canOpen = (module: string) => canOpenModule(user, activeTenant, module);
  const requirePermission = (permission: string) => { if (!can(permission)) throw new ApiError('Bu amal uchun faol do‘konda vakolat berilmagan.', 403); };
  return { can, canOpen, requirePermission, isOwner: Boolean(user?.role !== 'platform_admin' && activeTenant?.is_owner) };
}
