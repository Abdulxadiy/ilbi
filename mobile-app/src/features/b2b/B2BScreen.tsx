import { useRef, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { captureAuthScope, assertAuthScope, request } from '../../api/client';
import { getServerScope } from '../../api/environment';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { useTheme } from '../../theme/ThemeContext';
import { Page, Notice } from '../../components/ui/Page';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { ChoiceField } from '../../components/ui/ChoiceField';
import { ListState } from '../../components/ui/ListState';
import { useDebounced, usePagedResource } from '../../hooks/usePagedResource';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { formatQuantity } from '../../domain/quantity';
import { formatAmount } from '../reports/model';
import { b2bHtml, b2bStatus, parseB2BDetail, parseB2BSale, pendingQuantity, type B2BKind, type B2BSale } from './model';
import { B2BActionSheet } from './B2BActionSheet';

export function B2BScreen() { const { user, activeTenant } = useAuth(), params = useLocalSearchParams<{ saleId?: string }>(); return <B2BBody key={[getServerScope(), user?.id, activeTenant?.id, params.saleId || ''].join(':')} />; }
function B2BBody() {
  const { activeTenant } = useAuth(), { can, isOwner } = usePermissions(), navigation = useAppNavigation(), { colors } = useTheme();
  const params = useLocalSearchParams<{ saleId?: string }>();
  const [direction, setDirection] = useState<'incoming' | 'outgoing'>('incoming'), [search, setSearch] = useState(''), [status, setStatus] = useState('');
  const query = useDebounced(search.trim()), allowed = can('sales.manage_b2b');
  const endpoint = '/sales/b2b/' + (direction === 'incoming' ? 'inbox' : 'outgoing') + '/?' + new URLSearchParams({ search: query, all_statuses: 'true', ...(status ? { status } : {}) }).toString();
  const list = usePagedResource(allowed ? endpoint : null, parseB2BSale);
  const parameterId = Number(params.saleId), [selectedId, setSelectedId] = useState<number | null>(() => Number.isSafeInteger(parameterId) && parameterId > 0 ? parameterId : null);
  const detail = useScopedQuery(allowed && selectedId ? `/sales/b2b/${selectedId}/` : null, parseB2BDetail);
  const [action, setAction] = useState<{ sale: B2BSale; kind: B2BKind } | null>(null), [message, setMessage] = useState(''), [shareError, setShareError] = useState(''), [sharing, setSharing] = useState(false);
  const shareLock = useRef(false);
  const share = async () => {
    if (!selectedId || shareLock.current) return;
    shareLock.current = true; setSharing(true); setShareError(''); const scope = captureAuthScope();
    try {
      const latest = parseB2BDetail(await request(`/sales/b2b/${selectedId}/`)); assertAuthScope(scope);
      if (latest.sale.id !== selectedId) throw Error('Server so‘ralgan B2B hujjatini tasdiqlamadi.');
      if (!await Sharing.isAvailableAsync()) throw Error('Ushbu qurilmada fayl ulashish mavjud emas.');
      const { uri } = await Print.printToFileAsync({ html: b2bHtml(latest) }); assertAuthScope(scope);
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'B2B hujjatini ulashish', UTI: 'com.adobe.pdf' });
    } catch (error: any) { setShareError(error.message || 'Hujjat ulashilmadi.'); }
    finally { shareLock.current = false; setSharing(false); }
  };
  const sale = detail.data?.sale, pending = sale && ['b2b_pending', 'b2b_partially_accepted'].includes(sale.status) && sale.items.some(line => pendingQuantity(line) > 0n);
  return <Page title="B2B savdolar" onMenu={navigation.openDrawer} scroll={false} insetBottom={false}>
    <View style={{ padding: 16, gap: 12 }}>
      <ChoiceField label="Yo‘nalish" value={direction} options={[{ value: 'incoming', label: 'Kiruvchi' }, { value: 'outgoing', label: 'Chiquvchi' }]} onChange={setDirection} />
      <Input label="B2B qidirish" value={search} onChangeText={setSearch} placeholder="Hujjat yoki do‘kon nomi" />
      <ChoiceField label="Holat" value={status} options={[{ value: '', label: 'Barchasi' }, { value: 'b2b_pending', label: 'Kutilmoqda' }, { value: 'b2b_return_pending', label: 'Qaytish' }, { value: 'b2b_accepted', label: 'Qabul qilingan' }]} onChange={setStatus} />
      {message ? <Notice>{message}</Notice> : null}
      {!allowed && <Notice error>B2B savdolar uchun vakolat berilmagan.</Notice>}
    </View>
    <FlatList data={list.rows} keyExtractor={row => String(row.id)} contentContainerStyle={{ padding: 16, gap: 12 }} refreshing={list.loading} onRefresh={list.reload}
      ListEmptyComponent={<ListState loading={list.loading} error={list.error} empty onRetry={list.retry} emptyLabel="B2B hujjatlari topilmadi." />}
      ListFooterComponent={<>{list.rows.length > 0 && list.error && <ListState error={list.error} onRetry={list.retry} />}{list.hasMore && <Button title="Yana hujjatlar" variant="secondary" loading={list.loadingMore} onPress={list.loadMore} />}</>}
      renderItem={({ item }) => <View style={{ padding: 16, gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14 }}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>#{item.receipt_number}</Text>
        <Notice>{direction === 'incoming' ? item.source_tenant_name : item.b2b_target_tenant_name} · {b2bStatus(item.status)}</Notice>
        <Text style={{ color: colors.text, fontWeight: '700' }}>{formatAmount(item.net_amount)} {item.currency}</Text>
        <Button title={'Hujjatni ochish: ' + item.receipt_number} variant="secondary" onPress={() => { setSelectedId(item.id); setShareError(''); }} />
      </View>} />
    <BottomSheet visible={selectedId !== null && !action} title="B2B hujjati" scrollable onClose={() => { if (!sharing) setSelectedId(null); }}>
      <View style={{ gap: 12 }}>
        <ListState loading={detail.loading} error={detail.error} onRetry={detail.reload} />
        {sale && <>
          <Text style={{ color: colors.text, fontWeight: '700' }}>#{sale.receipt_number} · {b2bStatus(sale.status)}</Text>
          <Notice>{detail.data?.direction === 'incoming' ? sale.source_tenant_name : sale.b2b_target_tenant_name} · {activeTenant?.name}</Notice>
          <Notice>Jami: {formatAmount(sale.total_amount)} {sale.currency} · Qaytarilgan: {formatAmount(sale.refunded_amount)} {sale.currency}</Notice>
          {sale.b2b_expires_at && <Notice>Qabul muddati: {new Date(sale.b2b_expires_at).toLocaleString('uz-UZ')}</Notice>}
          {sale.items.map(line => <View key={line.id} style={{ gap: 5, borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 10 }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{line.product_name} · {line.product_variant_name}</Text>
            <Notice>Jo‘natilgan: {formatQuantity(line.quantity)} {line.unit} · Narx: {formatAmount(line.unit_price)} {sale.currency}</Notice>
            <Notice>Qabul: {formatQuantity(line.b2b_accepted_quantity)} · Qaytish kutilmoqda: {formatQuantity(line.b2b_return_pending_quantity)}</Notice>
            <Notice>Jismonan qaytgan: {formatQuantity(line.b2b_rejected_quantity)} · Tafovut yopilgan: {formatQuantity(line.b2b_discrepancy_closed_quantity)}</Notice>
          </View>)}
          {shareError ? <Notice error>{shareError}</Notice> : null}
          <Button title="B2B hujjatini ulashish" variant="secondary" loading={sharing} onPress={share} />
          {detail.data?.direction === 'incoming' && pending && <><Button title="Tovarlarni qabul qilish" disabled={sharing} onPress={() => setAction({ sale, kind: 'accept' })} /><Button title="Rad etish" variant="secondary" disabled={sharing} onPress={() => setAction({ sale, kind: 'reject' })} /></>}
          {detail.data?.direction === 'outgoing' && sale.status === 'b2b_return_pending' && <><Button title="Jismonan qaytgan tovarni qabul qilish" disabled={sharing} onPress={() => setAction({ sale, kind: 'receive' })} />{isOwner && <Button title="Qaytish tafovutini yopish" variant="secondary" disabled={sharing} onPress={() => setAction({ sale, kind: 'close_discrepancy' })} />}</>}
        </>}
      </View>
    </BottomSheet>
    {action && <B2BActionSheet key={action.sale.id + ':' + action.kind} sale={action.sale} kind={action.kind} onClose={() => setAction(null)} onDone={async () => { setAction(null); setSelectedId(null); setMessage('B2B amali serverda tasdiqlandi. Ma’lumotlar yangilandi.'); await list.reload(); }} />}
  </Page>;
}
