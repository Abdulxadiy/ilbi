import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { assertAuthScope, captureAuthScope } from '../../api/client';
import { parseMessagePage, SupportMessage } from './model';
import { startSupportPolling } from './polling';
import { SupportSession } from './session';
export function useSupportActivity() {
  const [focused, setFocused] = useState(false), [foreground, setForeground] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => { const subscription = AppState.addEventListener('change', state => setForeground(state === 'active')); return () => subscription.remove(); }, []);
  return focused && foreground;
}
export function useSupportWrite() {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<any>(null), [retryAt, setRetryAt] = useState(0);
  useEffect(() => { if (!retryAt) return; const timer = setTimeout(() => setRetryAt(0), Math.max(0, retryAt - Date.now())); return () => clearTimeout(timer); }, [retryAt]);
  const run = async <T,>(task: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: any }> => {
    if (lock.current || retryAt > Date.now()) return { ok: false, error: null };
    lock.current = true; setBusy(true); setError(null); const scope = captureAuthScope();
    try { const value = await task(); assertAuthScope(scope); return { ok: true, value }; }
    catch (failure: any) { setError(failure); if (failure.retryAfterMs > 0) setRetryAt(Date.now() + failure.retryAfterMs); return { ok: false, error: failure }; }
    finally { lock.current = false; setBusy(false); }
  };
  return { busy, error, run, blocked: retryAt > 0, clearError: () => setError(null) };
}
export const uncertainSupportWrite = (error: any) => error && (!error.status || error.status >= 500 || [408, 409, 425, 429].includes(error.status));
export function useSupportFeed(session: SupportSession, conversation: string, active: boolean) {
  const [messages, setMessages] = useState<SupportMessage[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState<any>(null);
  const [hasOlder, setHasOlder] = useState(false), [loadingOlder, setLoadingOlder] = useState(false);
  const rows = useRef<SupportMessage[]>([]), epoch = useRef(0), abort = useRef<AbortController | null>(null), olderBusy = useRef(false);
  const poll = useRef<ReturnType<typeof startSupportPolling> | null>(null);
  const merge = useCallback((incoming: SupportMessage[]) => {
    rows.current = [...new Map([...rows.current, ...incoming].map(message => [message.id, message])).values()].sort((a, b) => b.id - a.id);
    setMessages(rows.current);
  }, []);
  useEffect(() => {
    if (!active) return;
    const current = ++epoch.current, controller = new AbortController(); abort.current = controller;
    const valid = () => current === epoch.current && !controller.signal.aborted;
    const read = async () => {
      const initial = !rows.current.length;
      if (initial) setLoading(true);
      try {
        let cursor = rows.current[0]?.id || 0;
        for (let page = 0; page < 5; page++) {
          const data = parseMessagePage(await session.call(conversation + '/messages/' + (cursor ? '?after_id=' + cursor : ''), { signal: controller.signal }));
          if (!valid()) return;
          if (initial && page === 0) setHasOlder(data.has_more);
          merge(data.results); setError(null);
          if (!cursor || !data.has_more) break;
          const next = Math.max(cursor, ...data.results.map(message => message.id));
          if (next === cursor) throw Error('Yozishma kursori yangilanmadi.');
          cursor = next;
        }
      } finally { if (valid()) setLoading(false); }
    };
    poll.current = startSupportPolling(read, { onError: failure => { if (valid()) setError(failure); } });
    return () => { epoch.current = current + 1; controller.abort(); poll.current?.stop(); poll.current = null; };
  }, [active, conversation, merge, session]);
  const loadOlder = async () => {
    if (!active || olderBusy.current || !hasOlder || !rows.current.length) return;
    olderBusy.current = true; setLoadingOlder(true); const current = epoch.current;
    try {
      const data = parseMessagePage(await session.call(conversation + '/messages/?before_id=' + rows.current.at(-1)!.id, { signal: abort.current?.signal }));
      if (current === epoch.current && !abort.current?.signal.aborted) { merge(data.results); setHasOlder(data.has_more); setError(null); }
    } catch (failure) { if (current === epoch.current) setError(failure); }
    finally { olderBusy.current = false; setLoadingOlder(false); }
  };
  return { messages, loading, error, hasOlder, loadingOlder, loadOlder, accept: merge, retry: () => poll.current?.retry() };
}
