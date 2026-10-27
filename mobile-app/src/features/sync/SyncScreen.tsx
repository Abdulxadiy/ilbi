import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureAuthScope, assertAuthScope } from '../../api/client';
import { cartDraftKey, newDraft } from '../cart/drafts';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Page, Notice, Loading, Retry } from '../../components/ui/Page';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../auth/AuthContext';
import { useCart } from '../cart/CartContext';
import { useTheme } from '../../theme/ThemeContext';
import { listFinancialIntents, acknowledgeLegacySale, type FinancialIntent } from '../../api/financialIdentity';
import { getServerScope } from '../../api/environment';
import { outboxManager } from './outbox';
import { reconcileFinancialIntent } from './reconcile';
import { useAppNavigation } from '../../navigation/useAppNavigation';
export function SyncScreen() {
  const { user, activeTenant } = useAuth();
  return <SyncBody key={[getServerScope(), user?.id, activeTenant?.id].join('|')} />;
}
function SyncBody() {
  const { user, activeTenant } = useAuth(), cart = useCart(), { cartId, clearCart } = cart, { colors } = useTheme();
  const navigation = useAppNavigation();
  const scope = [getServerScope(), user?.id, activeTenant?.id].join('|');
  const [state, setState] = useState<{ scope: string; rows: FinancialIntent[]; legacy: number; error: string; loading: boolean }>({ scope: '', rows: [], legacy: 0, error: '', loading: true });
  const [version, refresh] = useState(0), [busy, setBusy] = useState<string | null>(null), [message, setMessage] = useState('');
  const [confirmed, setConfirmed] = useState<any | null>(null);
  const processing = useRef(false);
  useEffect(() => {
    let active = true;
    (async () => {
      if (!user || !activeTenant) return;
      try {
        const [rows, old] = await Promise.all([listFinancialIntents(user.id, activeTenant.id), outboxManager.getQueue()]);
        if (active) setState({ scope, rows: rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt)), legacy: old.filter(row => row.status !== 'completed').length, error: '', loading: false });
      } catch (error: any) { if (active) setState({ scope, rows: [], legacy: 0, error: error.message, loading: false }); }
    })();
    return () => { active = false; };
  }, [user, activeTenant, scope, version]);
  const check = async (intent: FinancialIntent) => {
    if (!user || !activeTenant || processing.current) return;
    processing.current = true; setBusy(intent.key); setMessage('');
    try {
      const result = await reconcileFinancialIntent(intent, user, activeTenant);
      setConfirmed(result);
      if (intent.operation === 'sale:' + cartId) clearCart();
      setMessage('Server amalni tasdiqladi. Asl qayta so‘rash kaliti saqlandi.');
      refresh(value => value + 1);
    } catch (error: any) { setMessage(error.message || 'Natija hali aniqlanmadi. Asl yozuv saqlandi.'); }
    finally { processing.current = false; setBusy(null); }
  };
  const acknowledge = async (intent: FinancialIntent) => {
    if (!user || !activeTenant || processing.current || !cart.ready) return;
    processing.current = true; setBusy(intent.key);
    const authScope = captureAuthScope(user.id, activeTenant.id);
    try {
      await cart.flushDraft(); assertAuthScope(authScope);
      await AsyncStorage.setItem(cartDraftKey(user.id, activeTenant.id) + ':history:' + cartId, JSON.stringify(newDraft(user.id, activeTenant.id, cart.items, cart.customer, { id: cartId, payment: cart.payment, partner: cart.partner })));
      assertAuthScope(authScope);
      await acknowledgeLegacySale(intent.key, cartId, user.id, activeTenant.id);
      assertAuthScope(authScope); clearCart(); refresh(value => value + 1);
      setMessage('Eski savdo ko‘rib chiqildi. Joriy savat nusxasi saqlanib, yangi savat ochildi.');
    } catch (error: any) { setMessage(error.message); }
    finally { processing.current = false; setBusy(null); }
  };
  const current = state.scope === scope ? state : null;
  return <Page insetBottom={false} title="Amallar va sinxronlash" onBack={() => navigation.goBack()}>
    <Notice>Natijasi noma’lum amal yangi kalit bilan yaratilmaydi. Tekshirish asl kalit va asl ma’lumot bilan serverga qayta so‘rov yuboradi.</Notice>
    <Button title="Jurnalni yangilash" variant="secondary" onPress={() => refresh(value => value + 1)} disabled={Boolean(busy)} />
    {message ? <Notice>{message}</Notice> : null}
    {!current || current.loading ? <Loading /> : current.error ? <Retry error={current.error} retry={() => refresh(value => value + 1)} /> : <>
      <Text style={{ color: colors.text, fontWeight: '700' }}>{current.rows.length} ta amal tekshirishni kutmoqda</Text>
      {current.rows.map(intent => <View key={intent.key} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, gap: 10 }}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>{operationLabel(intent.operation)}</Text>
        <Text style={{ color: colors.textSecondary }}>Vaqt: {intent.createdAt}</Text>
        {(intent.payload as any).items?.map((item: any) => <Text key={item.product_variant_id} style={{ color: colors.text }}>Tovar #{item.product_variant_id} · {item.quantity} × {item.unit_price}</Text>)}
        {intent.operation.startsWith('void-') ? <Notice>Sabab: {String((intent.payload as any).reason || '—')}{(intent.payload as any).quantity ? ' · Miqdor: ' + (intent.payload as any).quantity : ''}</Notice> : null}
        {(intent.payload as any).amount != null ? <Text style={{ color: colors.text }}>{(intent.payload as any).amount} {(intent.payload as any).currency}</Text> : null}
        {intent.reviewRequired && intent.result?.id ? <><Notice>Eski talqindagi savdo serverda tasdiqlangan. Quyidagi amal joriy savatning nusxasini saqlab, uni yopadi va qayta savdo bo‘lishining oldini oladi.</Notice><Text style={{ color: colors.text }}>Chek #{intent.result.receipt_number || intent.result.id}</Text><Button title="Natijani ko‘rdim, joriy savatni yopish" loading={busy === intent.key} onPress={() => { void acknowledge(intent); }} /></> : <Button title="Asl kalit bilan natijani tekshirish" loading={busy === intent.key} disabled={Boolean(busy && busy !== intent.key)} onPress={() => { void check(intent); }} />}
      </View>)}
      {current.legacy ? <Notice error>{current.legacy} ta eski navbat yozuvida server va hisob manbasi yo‘q. Ular saqlandi; boshqa hisob nomidan avtomatik yuborilmaydi. Asl manbani tasdiqlash uchun alohida migratsiya kerak.</Notice> : null}
      {confirmed?.void_operation?.sale_id ? <Button title="Qaytarilgan savdoni ochish" variant="secondary" onPress={() => navigation.navigate('SalesHistory', { saleId: String(confirmed.void_operation.sale_id) })} /> : null}
      {confirmed?.id ? <Text selectable style={{ color: colors.text }}>Tasdiqlangan natija: #{confirmed.receipt_number || confirmed.id}</Text> : null}
    </>}
  </Page>;
}

function operationLabel(operation: string) {
  if (operation.startsWith('void-')) return 'Savdoni qaytarish';
  if (operation.startsWith('inventory:')) return 'Ombor amali';
  if (operation.startsWith('cashbox:')) return 'Kassa amali';
  if (operation.startsWith('b2b:')) return 'B2B amali';
  return operation.startsWith('sale') ? 'Savdo' : 'Qarz to‘lovi';
}
