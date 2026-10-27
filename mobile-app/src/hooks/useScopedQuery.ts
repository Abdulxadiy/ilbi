import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { request } from '../api/client';
import { observeResource } from '../api/invalidation';
import { getServerScope } from '../api/environment';
import { useAuth } from '../features/auth/AuthContext';

type QueryState<T> = { key: string; data: T | null; loading: boolean; error: Error | null };
/** A read response belongs to its server/account/store/query, including while navigating between stores. */
export function useScopedQuery<T>(endpoint: string | null, parse: (value: any) => T) {
  const { user, activeTenant } = useAuth();
  const key = [getServerScope(), user?.id, activeTenant?.id, endpoint].join('|');
  const [state, setState] = useState<QueryState<T>>({ key: '', data: null, loading: false, error: null });
  const currentKey = useRef(key), sequence = useRef(0), controller = useRef<AbortController | null>(null);
  useLayoutEffect(() => { currentKey.current = key; }, [key]);
  const cancel = useCallback(() => { sequence.current++; controller.current?.abort(); }, []);
  const reload = useCallback(async () => {
    cancel();
    if (!endpoint) return;
    const operation = sequence.current, abort = new AbortController(); controller.current = abort;
    const current = () => currentKey.current === key && operation === sequence.current && !abort.signal.aborted;
    setState({ key, data: null, loading: true, error: null });
    try {
      const raw = await request(endpoint, { signal: abort.signal });
      if (current()) setState({ key, data: parse(raw), loading: false, error: null });
    } catch (failure: any) {
      if (current()) setState({ key, data: null, loading: false, error: failure instanceof Error ? failure : Error('Ma’lumot yuklanmadi.') });
    }
  }, [cancel, endpoint, key, parse]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) return reload(); });
    return () => { active = false; cancel(); };
  }, [cancel, reload]);
  useEffect(() => observeResource(endpoint, () => { void reload(); }), [endpoint, reload]);
  const visible = state.key === key && endpoint ? state : { key, data: null, loading: Boolean(endpoint), error: null };
  return { ...visible, reload };
}
