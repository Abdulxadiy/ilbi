import { useCallback, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { getServerScope } from '../../api/environment';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { useTheme } from '../../theme/ThemeContext';
import { Page, Notice } from '../../components/ui/Page';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ChoiceField } from '../../components/ui/ChoiceField';
import { ListState } from '../../components/ui/ListState';
import { useApiResource } from '../../hooks/useApiResource';
import { useDebounced, usePagedResource } from '../../hooks/usePagedResource';
import { formatAmount } from '../reports/model';
import { parseSavedSale, saleStatuses } from '../sales/model';
import { parseCustomer, parseCustomerPayment } from './model';

export function CustomerStatementScreen() {
  const { user, activeTenant } = useAuth(), params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' && /^[1-9]\d*$/.test(params.id) ? Number(params.id) : 0;
  return <CustomerStatement key={[getServerScope(), user?.id, activeTenant?.id, id].join(':')} customerId={Number.isSafeInteger(id) ? id : 0} />;
}
function CustomerStatement({ customerId }: { customerId: number }) {
  const navigation = useAppNavigation(), { can } = usePermissions(), { colors } = useTheme();
  const allowed = Boolean(customerId && (can('sales.manage_counterparty') || can('sales.record_debt_payment')));
  const base = `/sales/counterparties/${customerId}/`;
  const parseProfile = useCallback((value: unknown) => { const row = parseCustomer(value); if (row.id !== customerId) throw Error('Server so‘ralgan mijozni tasdiqlamadi.'); return row; }, [customerId]);
  const profile = useApiResource(allowed ? base : null, parseProfile);
  const [tab, setTab] = useState<'all' | 'debt' | 'payments'>('all'), [search, setSearch] = useState('');
  const query = useDebounced(search.trim());
  const parseSale = useCallback((value: any) => { const row = parseSavedSale(value); if (row.counterparty !== customerId) throw Error('Xarid boshqa mijozga tegishli.'); return row; }, [customerId]);
  const parsePayment = useCallback((value: unknown) => parseCustomerPayment(value, customerId), [customerId]);
  const sales = usePagedResource(allowed && profile.data && tab !== 'payments' ? base + 'sales/?' + new URLSearchParams({ search: query, ...(tab === 'debt' ? { payment_type: 'debt' } : {}) }).toString() : null, parseSale);
  const payments = usePagedResource(allowed && profile.data && tab === 'payments' ? base + 'payments/' : null, parsePayment);
  const date = (value: string) => new Date(value).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' });
  return <Page title="Mijoz ko‘chirmasi" onBack={navigation.goBack} scroll={false} insetBottom={false}>
    <View style={{ padding: 16, gap: 10 }}>
      {!allowed && <Notice error>Mijoz identifikatori yoki faol do‘kon vakolati tasdiqlanmadi.</Notice>}
      <ListState loading={profile.loading} error={profile.error} onRetry={profile.reload} />
      {profile.data && <>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 20 }}>{profile.data.name}</Text>
        <Notice>{profile.data.phone_number}{profile.data.target_tenant ? ' · B2B: ' + (profile.data.target_tenant_name || 'Bog‘langan do‘kon') : ''}</Notice>
        <Text style={{ color: colors.text, fontWeight: '600' }}>Amaldagi balans: {formatAmount(profile.data.debt_balance_uzs)} UZS / {formatAmount(profile.data.debt_balance_usd)} USD</Text>
        <Notice>Musbat — mijoz qarzi; manfiy — mijoz haqqi.</Notice>
        {profile.data.debt_due_date ? <Notice>Qarz muddati: {profile.data.debt_due_date}</Notice> : null}
        <ChoiceField label="Ko‘chirma bo‘limi" value={tab} onChange={setTab} options={[{ value: 'all', label: 'Barcha xaridlar' }, { value: 'debt', label: 'Nasiya xaridlar' }, { value: 'payments', label: 'To‘lovlar' }]} />
        {tab !== 'payments' && <Input label="Xarid qidirish" value={search} onChangeText={setSearch} placeholder="Chek yoki tovar" />}
        {sales.summary && tab !== 'payments' && <Notice>Jami xaridlar: {sales.summary.total_sales_count ?? '—'} · Nasiya: {sales.summary.debt_sales_count ?? '—'} · To‘lov yozuvlari: {sales.summary.payments_count ?? '—'} · Sof xaridlar: {formatAmount(sales.summary.total_spent_uzs)} UZS / {formatAmount(sales.summary.total_spent_usd)} USD</Notice>}
      </>}
    </View>
    {tab === 'payments' ? <FlatList data={payments.rows} keyExtractor={row => String(row.id)} refreshing={payments.loading} onRefresh={async () => { await profile.reload(); await payments.reload(); }} contentContainerStyle={{ padding: 16, gap: 12 }}
      ListEmptyComponent={<ListState loading={payments.loading} error={payments.error} empty onRetry={payments.retry} emptyLabel="To‘lov yozuvlari topilmadi." />}
      ListFooterComponent={<>{payments.rows.length > 0 && payments.error && <ListState error={payments.error} onRetry={payments.retry} />}{payments.hasMore && <Button title="Yana to‘lovlar" loading={payments.loadingMore} variant="secondary" onPress={payments.loadMore} />}</>}
      renderItem={({ item }) => <View style={{ backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 16, gap: 8 }}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>{item.is_correction ? 'Tuzatish / qaytarish' : 'Qabul qilingan to‘lov'} · {formatAmount(item.amount)} {item.currency}</Text>
        <Notice>{date(item.paid_at)} · {item.payment_type === 'cash' ? 'Naqd' : item.payment_type === 'card' ? 'Karta' : 'Kassaga ta’sirsiz tuzatish'}</Notice>
        <Notice>{item.branch_name || 'Filial ko‘rsatilmagan'} · {item.recorded_by_name || '—'}</Notice>
        {item.note ? <Notice>{item.note}</Notice> : null}
        {item.exchange_rate !== null && <Notice>Kurs: {formatAmount(item.exchange_rate)} UZS{item.converted_amount_uzs !== null ? ' · Konvertatsiya: ' + formatAmount(item.converted_amount_uzs) + ' UZS' : ''}</Notice>}
      </View>} /> : <FlatList data={sales.rows} keyExtractor={row => String(row.id)} refreshing={sales.loading} onRefresh={async () => { await profile.reload(); await sales.reload(); }} contentContainerStyle={{ padding: 16, gap: 12 }}
        ListEmptyComponent={<ListState loading={sales.loading} error={sales.error} empty onRetry={sales.retry} emptyLabel="Xaridlar topilmadi." />}
        ListFooterComponent={<>{sales.rows.length > 0 && sales.error && <ListState error={sales.error} onRetry={sales.retry} />}{sales.hasMore && <Button title="Yana xaridlar" loading={sales.loadingMore} variant="secondary" onPress={sales.loadMore} />}</>}
        renderItem={({ item }) => <View style={{ backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 16, gap: 8 }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>#{item.receipt_number} · {formatAmount(item.net_amount)} {item.currency}</Text>
          <Notice>{date(item.created_at)} · {saleStatuses[item.status]} · {item.payment_type === 'debt' ? 'Nasiya' : item.payment_type === 'cash' ? 'Naqd' : 'Karta'}</Notice>
          {Number(item.refunded_amount) > 0 && <Notice>Qaytarilgan: {formatAmount(item.refunded_amount)} {item.currency}</Notice>}
          {can('sales.view_sale') && <Button title={'Chekni ochish: ' + item.receipt_number} variant="secondary" onPress={() => navigation.navigate('ReceiptView', { sale: item })} />}
        </View>} />}
  </Page>;
}
