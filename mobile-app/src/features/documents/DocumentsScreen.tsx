import React, { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { useTheme } from '../../theme/ThemeContext';
import { usePermissions } from '../auth/usePermissions';
import { Page, Notice } from '../../components/ui/Page';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { ListState } from '../../components/ui/ListState';
import { usePagedResource, useDebounced } from '../../hooks/usePagedResource';
import { documentDate } from '../receipts/documentModel';
import { saleStatuses } from '../sales/model';
import { formatAmount, positiveId, requiredDecimal } from '../reports/model';
export function saleRow(value: any) {
  if (!value || typeof value !== 'object') throw Error('Savdo hujjati tasdiqlanmadi.');
  return { ...value, id: positiveId(value.id), total_amount: requiredDecimal(value.total_amount), currency: String(value.currency || 'UZS'), receipt_number: String(value.receipt_number || value.id) };
}
export const DocumentsScreen: React.FC = () => {
  const navigation = useAppNavigation(), { colors } = useTheme(), { can } = usePermissions();
  const [search, setSearch] = useState(''), [filter, setFilter] = useState<'all' | 'cash' | 'card' | 'debt'>('all'), query = useDebounced(search.trim());
  const params = new URLSearchParams({ search: query });
  if (filter !== 'all') params.set('payment_type', filter);
  const sales = usePagedResource(can('sales.view_sale') ? '/sales/?' + params.toString() : null, saleRow);
  const open = (sale: any, mode: 'ReceiptView' | 'ShareSheet' | 'PdfExport' | 'InvoiceA4') => navigation.navigate(mode, { sale });
  return <Page title="Hujjatlar" onMenu={navigation.openDrawer} insetBottom={false} scroll={false}>
    <View style={{ padding: 16, gap: 12 }}>
      <Input label="Hujjat yoki mijoz" placeholder="Chek raqami, ism yoki telefon" value={search} onChangeText={setSearch} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{([['all', 'Barchasi'], ['cash', 'Naqd'], ['card', 'Karta'], ['debt', 'Nasiya']] as const).map(([value, label]) => <Button key={value} title={label} size="sm" variant={filter === value ? 'primary' : 'secondary'} onPress={() => setFilter(value)} />)}</View>
      <Notice>Haqiqiy savdo cheklari va ularning serverda saqlangan nusxalari. Jami: {sales.count}.</Notice>
      {!can('sales.view_sale') && <Notice error>Hujjatlarni ko‘rish uchun vakolat berilmagan.</Notice>}
    </View>
    <FlatList data={sales.rows} keyExtractor={sale => String(sale.id)} contentContainerStyle={{ padding: 16, gap: 12 }} refreshing={sales.loading} onRefresh={sales.reload}
      ListEmptyComponent={<ListState loading={sales.loading} error={sales.error} empty onRetry={sales.retry} emptyLabel="Hujjat topilmadi." />}
      ListFooterComponent={<>{sales.rows.length > 0 && sales.error && <ListState error={sales.error} onRetry={sales.retry} />}{sales.hasMore && <Button title="Yana hujjatlar" variant="secondary" loading={sales.loadingMore} onPress={sales.loadMore} />}</>}
      renderItem={({ item }) => <View style={{ padding: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 14, gap: 9 }}>
        <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>Chek #{item.receipt_number}</Text>
        <Notice>{item.counterparty_name || 'Umumiy mijoz'} · {item.created_at ? documentDate(item.created_at) : '—'}</Notice>
        <Text style={{ color: colors.text, fontWeight: '600' }}>{formatAmount(item.total_amount)} {item.currency}</Text>
        <Notice>{({ cash: 'Naqd', card: 'Karta', debt: 'Nasiya' } as Record<string, string>)[item.payment_type] || item.payment_type} · {saleStatuses[item.status as keyof typeof saleStatuses] || item.status || '—'}</Notice>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button title="Chekni ochish" size="sm" variant="secondary" onPress={() => open(item, 'ReceiptView')} /><Button title="Ulashish" size="sm" variant="secondary" onPress={() => open(item, 'ShareSheet')} /><Button title="A4 faktura" size="sm" variant="secondary" onPress={() => open(item, 'InvoiceA4')} /><Button title="PDF" size="sm" variant="secondary" onPress={() => open(item, 'PdfExport')} /></View>
      </View>} />
  </Page>;
};
