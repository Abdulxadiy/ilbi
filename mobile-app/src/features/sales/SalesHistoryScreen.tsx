import React, { useState } from 'react';
import { FlatList, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Page, Notice } from '../../components/ui/Page';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { ChoiceField } from '../../components/ui/ChoiceField';
import { ApiPicker } from '../../components/ui/ApiPicker';
import { ListState } from '../../components/ui/ListState';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { useTheme } from '../../theme/ThemeContext';
import { usePagedResource, useDebounced } from '../../hooks/usePagedResource';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { useFormErrors } from '../../hooks/useFormErrors';
import { getServerScope } from '../../api/environment';
import { formatAmount } from '../reports/model';
import { SaleVoidSheet, type VoidTarget } from './SaleVoidSheet';
import { quantityMilli } from '../../domain/quantity';
import { parseSavedSale, saleStatuses, validDate, type SavedSale } from './model';

type Filters = { status: string; payment_type: string; currency: string; date_from: string; date_to: string; counterparty_id: string; counterparty_name: string };
const parseCapabilities = (value: any) => ({ supported: value?.sale_void_idempotency === 1 });
const emptyFilters: Filters = { status: '', payment_type: '', currency: '', date_from: '', date_to: '', counterparty_id: '', counterparty_name: '' };
export function SalesHistoryScreen() {
  const { user, activeTenant } = useAuth(), params = useLocalSearchParams<{ saleId?: string }>();
  return <SalesHistoryBody key={[getServerScope(), user?.id, activeTenant?.id, params.saleId].join(':')} initialSaleId={params.saleId} />;
}
function SalesHistoryBody({ initialSaleId }: { initialSaleId?: string }) {
  const { colors } = useTheme(), navigation = useAppNavigation(), { can } = usePermissions();
  const [search, setSearch] = useState(''), query = useDebounced(search.trim());
  const [filters, setFilters] = useState<Filters>(emptyFilters), [draft, setDraft] = useState<Filters>(emptyFilters), [showFilters, setShowFilters] = useState(false);
  const validation = useFormErrors();
  const params = new URLSearchParams({ search: query });
  Object.entries(filters).forEach(([key, value]) => { if (value && key !== 'counterparty_name') params.set(key, value); });
  const sales = usePagedResource(can('sales.view_sale') ? '/sales/?' + params.toString() : null, parseSavedSale);
  const parsedId = initialSaleId && /^[1-9]\d*$/.test(initialSaleId) && Number.isSafeInteger(Number(initialSaleId)) ? Number(initialSaleId) : null;
  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null), [notice, setNotice] = useState('');
  const capability = useScopedQuery(can('sales.void_sale') && can('sales.view_sale') ? '/sales/capabilities/' : null, parseCapabilities);
  const [selectedId, setSelectedId] = useState<number | null>(parsedId);
  const detail = useScopedQuery(selectedId && can('sales.view_sale') ? '/sales/' + selectedId + '/' : null, parseSavedSale);
  const closeDetail = () => { setSelectedId(null); if (initialSaleId) router.setParams({ saleId: undefined }); };
  const apply = () => {
    const fields: Record<string, string> = {};
    if (!validDate(draft.date_from)) fields.date_from = 'Boshlanish sanasini YYYY-MM-DD shaklida kiriting.';
    if (!validDate(draft.date_to)) fields.date_to = 'Tugash sanasini YYYY-MM-DD shaklida kiriting.';
    if (!fields.date_from && !fields.date_to && draft.date_from && draft.date_to && draft.date_from > draft.date_to) fields.date_to = 'Tugash sanasi boshlanish sanasidan oldin bo‘lmasin.';
    if (draft.counterparty_id && (!/^[1-9]\d*$/.test(draft.counterparty_id) || !Number.isSafeInteger(Number(draft.counterparty_id)))) fields.counterparty_id = 'Ro‘yxatdan mijozni tanlang.';
    validation.setErrors(fields);
    if (!Object.keys(fields).length) { setFilters({ ...draft }); setShowFilters(false); }
  };
  const selected = detail.data?.id === selectedId ? detail.data : null;
  return <>
    <Page title={selectedId ? 'Savdo tafsilotlari' : 'Savdolar tarixi'} onBack={selectedId ? closeDetail : navigation.goBack} insetBottom={false} scroll={selectedId !== null}>
      {selectedId ? <>
        <ListState loading={detail.loading} error={detail.error} onRetry={detail.reload} />
        {detail.data && !selected && <Notice error>Server boshqa savdo yozuvini qaytardi.</Notice>}
        {notice ? <Notice>{notice}</Notice> : null}
        {selected && <SaleDetails sale={selected} canVoid={can('sales.void_sale')} voidSupported={capability.data?.supported === true} onRetryCapability={capability.reload} onVoid={target => { setNotice(''); setVoidTarget(target); }} />}
      </> : <>
        <View style={{ padding: 16, gap: 12 }}>
          <Input label="Savdolardan qidirish" value={search} onChangeText={setSearch} maxLength={200} placeholder="Chek, mijoz yoki sotuvchi" />
          <View style={{ flexDirection: 'row', gap: 8 }}><Button title="Savdo filtrlari" variant="secondary" onPress={() => { setDraft({ ...filters }); validation.clear(); setShowFilters(true); }} /><Button title="Filtrlarni tozalash" variant="ghost" onPress={() => { setFilters(emptyFilters); setSearch(''); }} /></View>
          <Notice>Jami: {sales.count} ta savdo{filters.date_from ? ' · ' + filters.date_from + ' dan' : ''}{filters.date_to ? ' · ' + filters.date_to + ' gacha' : ''}</Notice>
          {initialSaleId && !parsedId ? <Notice error>Savdo raqami noto‘g‘ri.</Notice> : null}
        </View>
        <FlatList data={sales.rows} keyExtractor={sale => String(sale.id)} contentContainerStyle={{ padding: 16, gap: 12 }} refreshing={sales.loading} onRefresh={sales.reload}
          ListEmptyComponent={<ListState loading={sales.loading} error={sales.error} empty onRetry={sales.retry} emptyLabel="Savdo topilmadi." />}
          ListFooterComponent={<>{sales.rows.length > 0 && sales.error && <ListState error={sales.error} onRetry={sales.retry} />}{sales.hasMore && <Button title="Yana savdolar" variant="secondary" loading={sales.loadingMore} onPress={sales.loadMore} />}</>}
          renderItem={({ item }) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={'Savdo #' + item.receipt_number + ': tafsilotlar'} onPress={() => setSelectedId(item.id)} style={{ padding: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 14, gap: 7 }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>#{item.receipt_number} · {formatAmount(item.net_amount)} {item.currency}</Text>
            <Notice>{item.counterparty_name || 'Umumiy mijoz'} · {item.sold_by_name || '—'}</Notice>
            <Notice>{item.created_at ? new Date(item.created_at).toLocaleString('uz-UZ') : '—'} · {saleStatuses[item.status]}</Notice>
            {Number(item.refunded_amount) > 0 && <Notice>Qaytarilgan: {formatAmount(item.refunded_amount)} {item.currency}</Notice>}
          </TouchableOpacity>} />
      </>}
    </Page>
    {voidTarget && <SaleVoidSheet target={voidTarget} onClose={() => setVoidTarget(null)} onDone={async () => { setVoidTarget(null); setNotice('Qaytarish serverda tasdiqlandi.'); await Promise.all([detail.reload(), sales.reload()]); }} />}
    <BottomSheet title="Savdo filtrlari" visible={showFilters} scrollable onClose={() => setShowFilters(false)}>
      <ChoiceField label="Savdo holati" value={draft.status} error={validation.errors.status} onChange={value => setDraft(previous => ({ ...previous, status: value }))} options={[{ value: '', label: 'Barcha holatlar' }, ...Object.entries(saleStatuses).map(([value, label]) => ({ value, label }))]} />
      <ChoiceField label="To‘lov turi" value={draft.payment_type} onChange={value => setDraft(previous => ({ ...previous, payment_type: value }))} options={[{ value: '', label: 'Barchasi' }, { value: 'cash', label: 'Naqd' }, { value: 'card', label: 'Karta' }, { value: 'debt', label: 'Nasiya' }]} />
      <ChoiceField label="Savdo valyutasi" value={draft.currency} onChange={value => setDraft(previous => ({ ...previous, currency: value }))} options={[{ value: '', label: 'UZS va USD' }, { value: 'UZS', label: 'UZS' }, { value: 'USD', label: 'USD' }]} />
      {can('sales.manage_counterparty') || can('sales.record_debt_payment') ? <ApiPicker label="Savdo mijozi" endpoint="/sales/counterparties/" optional error={validation.errors.counterparty_id} value={draft.counterparty_id ? { id: Number(draft.counterparty_id), name: draft.counterparty_name } : null} onChange={value => { setDraft(previous => ({ ...previous, counterparty_id: value ? String(value.id) : '', counterparty_name: value?.name || '' })); validation.clear('counterparty_id'); }} /> : null}
      <Input label="Boshlanish sanasi" placeholder="YYYY-MM-DD" value={draft.date_from} maxLength={10} error={validation.errors.date_from} onChangeText={value => { setDraft(previous => ({ ...previous, date_from: value })); validation.clear('date_from'); }} />
      <Input label="Tugash sanasi" placeholder="YYYY-MM-DD" value={draft.date_to} maxLength={10} error={validation.errors.date_to} onChangeText={value => { setDraft(previous => ({ ...previous, date_to: value })); validation.clear('date_to'); }} />
      <Button title="Filtrlarni qo‘llash" onPress={apply} />
    </BottomSheet>
  </>;
}
function SaleDetails({ sale, canVoid, voidSupported, onRetryCapability, onVoid }: { sale: SavedSale; canVoid: boolean; voidSupported: boolean; onRetryCapability: () => Promise<void>; onVoid: (target: VoidTarget) => void }) {
  const { colors } = useTheme(), navigation = useAppNavigation();
  const eligible = !sale.b2b_target_tenant && ['completed', 'partially_voided'].includes(sale.status);
  return <>
    <View style={{ padding: 16, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, gap: 10 }}>
      <Text style={{ color: colors.text, fontSize: 22, fontWeight: '700' }}>Chek #{sale.receipt_number}</Text>
      <Notice>{saleStatuses[sale.status]}</Notice>
      <Notice>{sale.counterparty_name || 'Umumiy mijoz'} · {sale.sold_by_name || '—'}</Notice>
      <Text style={{ color: colors.text }}>Jami: {formatAmount(sale.total_amount)} {sale.currency}</Text>
      <Text style={{ color: colors.text }}>Qaytarilgan: {formatAmount(sale.refunded_amount)} {sale.currency}</Text>
      <Text style={{ color: colors.text, fontWeight: '700' }}>Qolgan: {formatAmount(sale.net_amount)} {sale.currency}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button title="Chekni ochish" variant="secondary" size="sm" onPress={() => navigation.navigate('ReceiptView', { sale })} /><Button title="Chekni ulashish" variant="secondary" size="sm" onPress={() => navigation.navigate('ShareSheet', { sale })} /></View>
    </View>
    {canVoid && eligible && !voidSupported ? <View style={{ gap: 10 }}><Notice>Xavfsiz qaytarish uchun serverning yangi talqini talab qilinadi.</Notice><Button title="Qaytarish API holatini tekshirish" variant="secondary" onPress={onRetryCapability} /></View> : null}
    {canVoid && eligible && voidSupported ? <Button title="Savdoni to‘liq qaytarish" variant="danger" onPress={() => onVoid({ sale })} /> : null}
    {sale.items.map(line => <View key={line.id} style={{ padding: 16, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, gap: 8 }}>
      <Text style={{ color: colors.text, fontWeight: '600' }}>{line.product_name}</Text>
      <Notice>{line.product_variant_name || ''} · {line.quantity} {line.unit} × {formatAmount(line.unit_price)} {sale.currency}</Notice>
      <Notice>Qaytarilgan: {line.voided_quantity} {line.unit}</Notice>
      {canVoid && eligible && voidSupported && quantityMilli(line.quantity) > quantityMilli(line.voided_quantity, true) ? <Button title={line.product_name + ': qisman qaytarish'} variant="secondary" size="sm" onPress={() => onVoid({ sale, line })} /> : null}
    </View>)}
  </>;
}
