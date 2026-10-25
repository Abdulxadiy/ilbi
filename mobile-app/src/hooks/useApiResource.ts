import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { request } from '../api/client';
import { observeResource } from '../api/invalidation';
import { getServerScope } from '../api/environment';
import { useAuth } from '../features/auth/AuthContext';
const identity = <T,>(value: any): T => value;
export function useApiResource<T>(endpoint: string | null, parse: (value: any) => T = identity) {
  const { user, activeTenant } = useAuth();
  const key = [getServerScope(), user?.id, activeTenant?.id, endpoint].join('|');
  const [state, setState] = useState<{ key: string; data: T | null; loading: boolean; error: string }>({ key: '', data: null, loading: false, error: '' });
  const latest = useRef(key), sequence = useRef(0), controller = useRef<AbortController | null>(null);
  useLayoutEffect(() => { latest.current = key; }, [key]);
  const cancel = useCallback(() => { sequence.current++; controller.current?.abort(); }, []);
  const reload = useCallback(async () => {
    if (!endpoint) return null;
    cancel(); const current = sequence.current, abort = new AbortController(); controller.current = abort;
    setState(previous => ({ key, data: previous.key === key ? previous.data : null, loading: true, error: '' }));
    try {
      const value = parse(await request(endpoint, { signal: abort.signal }));
      if (latest.current !== key || current !== sequence.current || abort.signal.aborted) return null;
      setState({ key, data: value, loading: false, error: '' }); return value;
    } catch (error: any) {
      if (latest.current === key && current === sequence.current && !abort.signal.aborted) setState(previous => ({ ...previous, key, loading: false, error: error.message || 'Ma’lumotlar yuklanmadi.' }));
      return null;
    }
  }, [endpoint, key, parse, cancel]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) return reload(); });
    const unsubscribe = observeResource(endpoint, () => { void reload(); });
    return () => { active = false; cancel(); unsubscribe(); };
  }, [endpoint, reload, cancel]);
  return { ...(state.key === key ? state : { key, data: null, loading: Boolean(endpoint), error: '' }), reload };
}
