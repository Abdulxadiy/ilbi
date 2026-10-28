import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { request } from '../../api/client';
import { getServerScope } from '../../api/environment';
import { useAuth } from '../auth/AuthContext';
import type { CartItem } from '../cart/CartContext';
import { buildRetailQuote, type RetailQuote } from './quote';
export function useRetailQuote(items: CartItem[], partner: boolean) {
  const { user, activeTenant } = useAuth();
  const tenantId = activeTenant?.id;
  const cart = JSON.stringify(items);
  const key = [getServerScope(), user?.id, activeTenant?.id, partner, cart].join('|');
  const [state, setState] = useState<{ key: string; quote: RetailQuote | null; error: string; loading: boolean }>({ key: '', quote: null, error: '', loading: false });
  const latest = useRef(key), sequence = useRef(0), abort = useRef<AbortController | null>(null);
  useLayoutEffect(() => { latest.current = key; }, [key]);
  const reload = useCallback(async () => {
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    const current = ++sequence.current;
    setState(previous => ({ ...previous, key, loading: true, error: '' }));
    try {
      const rows: CartItem[] = JSON.parse(cart), ids = rows.map(row => row.variantId).join(',');
      if (!rows.length || rows.length > 100) throw Error('Chekda 1 tadan 100 tagacha tovar bo‘lishi kerak.');
      const [rawVariants, tenant] = await Promise.all([request('/catalog/variants/?ids=' + ids, { signal: controller.signal }), request('/tenants/current/', { signal: controller.signal })]);
      if (current !== sequence.current || latest.current !== key || controller.signal.aborted) throw Error('Do‘kon yoki savat o‘zgardi.');
      if (tenant?.id !== tenantId) throw Error('Do‘kon sozlamalarining manbasi mos kelmadi.');
      const variants = Array.isArray(rawVariants) ? rawVariants : rawVariants?.results;
      if (!Array.isArray(variants)) throw Error('Qoldiqlar tasdiqlanmadi.');
      const quote = buildRetailQuote(rows, variants, tenant.receipt_settings, partner);
      setState({ key, quote, error: '', loading: false }); return quote;
    } catch (error: any) {
      if (current === sequence.current && latest.current === key && !controller.signal.aborted) setState({ key, quote: null, error: error.message, loading: false });
      throw error;
    }
  }, [tenantId, cart, key, partner]);
  const cancel = useCallback(() => { sequence.current++; abort.current?.abort(); }, []);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active && items.length) return reload().catch(() => {}); });
    return () => { active = false; cancel(); };
  }, [reload, items.length, cancel]);
  return { ...(state.key === key ? state : { quote: null, loading: Boolean(items.length), error: '' }), reload };
}
