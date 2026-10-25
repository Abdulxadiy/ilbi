import { useRef, useState } from 'react';
import { assertAuthScope, captureAuthScope } from '../api/client';
import { useAuth } from '../features/auth/AuthContext';
import { usePermissions } from '../features/auth/usePermissions';
/** Non-financial catalog/account/settings mutations. Financial and stock writes use durable domain methods. */
export function useApiAction(permission?: string) {
  const { user } = useAuth(), { requirePermission } = usePermissions();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const run = async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    const scope = captureAuthScope();
    try {
      if (!user) throw Error('Avval hisobga kiring.');
      if (permission) requirePermission(permission);
      const result = await action(); assertAuthScope(scope); return result;
    } catch (failure: any) {
      setError((failure.message || 'Amal bajarilmadi.') + (['NETWORK', 'TIMEOUT'].includes(failure.code) ? ' Qayta yaratishdan oldin ro‘yxatdan amal natijasini tekshiring.' : ''));
      return undefined;
    } finally { lock.current = false; setBusy(false); }
  };
  return { busy, error, run, clearError: () => setError('') };
}
