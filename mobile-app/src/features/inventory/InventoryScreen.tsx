import React, { useState } from 'react';
import { FlatList, Text, TouchableOpacity, View } from 'react-native';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { useTheme } from '../../theme/ThemeContext';
import { usePermissions } from '../auth/usePermissions';
import { Page, Notice } from '../../components/ui/Page';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { ListState } from '../../components/ui/ListState';
import { usePagedResource, useDebounced } from '../../hooks/usePagedResource';
import { requiredDecimal, formatAmount, positiveId } from '../reports/model';

type Stock = { id: number; product_variant: number; product_name: string; variant_name: string; quantity: string; unit: string; currency: string; last_cost_price?: string; supplier?: string; barcode?: string; sku?: string };
function stockRow(value: any): Stock {
  if (!value || typeof value.product_name !== 'string') throw Error('Ombor qatori tasdiqlanmadi.');
  return { ...value, id: positiveId(value.id), product_variant: positiveId(value.product_variant), quantity: requiredDecimal(value.quantity), unit: String(value.unit || ''), currency: String(value.currency || '') };
}
const detailRow = (value: any) => ({ ...value, id: positiveId(value?.id), quantity: requiredDecimal(value.quantity) });
export const InventoryScreen: React.FC = () => {
  const navigation = useAppNavigation(), { colors } = useTheme(), { can } = usePermissions();
  const allowed = can('inventory.view_stock');
  const [search, setSearch] = useState(''), [sort, setSort] = useState('name_asc'), query = useDebounced(search.trim());
  const stock = usePagedResource(allowed ? '/inventory/stock/?' + new URLSearchParams({ search: query, sort }).toString() : null, stockRow);
  const [selected, setSelected] = useState<Stock | null>(null), [tab, setTab] = useState<'movements' | 'batches'>('movements');
  const details = usePagedResource(allowed && selected ? '/inventory/' + tab + '/?product_variant_id=' + selected.product_variant : null, detailRow);
  return <Page title="Ombor" onMenu={navigation.openDrawer} insetBottom={false} scroll={false}>
    <View style={{ padding: 16, gap: 12 }}>
      <Input label="Ombordan qidirish" value={search} onChangeText={setSearch} placeholder="Tovar, shtrix-kod yoki artikul" />
      <Button title={sort === 'qty_asc' ? 'Qoldiq: kamidan ko‘piga' : 'Qoldiq bo‘yicha saralash'} variant="secondary" onPress={() => setSort(value => value === 'name_asc' ? 'qty_asc' : 'name_asc')} />
      <Notice>Serverdagi qoldiq yozuvlari: {stock.count}. Har bir tovar uchun harakatlar va partiyalarni oching.</Notice>
      {!allowed && <Notice error>Ombor uchun vakolat berilmagan.</Notice>}
    </View>
    <FlatList data={stock.rows} keyExtractor={item => String(item.id)} contentContainerStyle={{ padding: 16, gap: 12 }} refreshing={stock.loading} onRefresh={stock.reload}
      ListEmptyComponent={<ListState loading={stock.loading} error={stock.error} empty onRetry={stock.retry} emptyLabel="Ombor yozuvlari topilmadi." />}
      ListFooterComponent={<>{stock.rows.length > 0 && stock.error && <ListState error={stock.error} onRetry={stock.retry} />}{stock.hasMore && <Button title="Yana ombor qoldiqlari" variant="secondary" loading={stock.loadingMore} onPress={stock.loadMore} />}</>}
      renderItem={({ item }) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={item.product_name + ': ombor tafsilotlari'} onPress={() => { setSelected(item); setTab('movements'); }} style={{ padding: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 14, gap: 7 }}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>{item.product_name}</Text>
        <Notice>{item.variant_name} · {item.sku || item.barcode || '—'}</Notice>
        <Text style={{ color: Number(item.quantity) <= 0 ? colors.danger : colors.text, fontSize: 18, fontWeight: '600' }}>{formatAmount(item.quantity, 3)} {item.unit}</Text>
        {can('catalog.view_cost_price') && item.last_cost_price != null && <Notice>Tannarx: {formatAmount(item.last_cost_price)} {item.currency}</Notice>}
        {can('inventory.view_supplier') && item.supplier ? <Notice>{item.supplier}</Notice> : null}
      </TouchableOpacity>} />
    <BottomSheet visible={selected !== null} title={selected?.product_name || 'Ombor tafsilotlari'} onClose={() => setSelected(null)}>
      <View style={{ gap: 12, maxHeight: 430 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}><Button title="Harakatlar" variant={tab === 'movements' ? 'primary' : 'secondary'} onPress={() => setTab('movements')} /><Button title="Partiyalar" variant={tab === 'batches' ? 'primary' : 'secondary'} onPress={() => setTab('batches')} /></View>
        <FlatList data={details.rows} keyExtractor={item => String(item.id)} contentContainerStyle={{ gap: 14 }} ListEmptyComponent={<ListState loading={details.loading} error={details.error} empty onRetry={details.retry} emptyLabel="Yozuvlar yo‘q." />} ListFooterComponent={details.hasMore ? <Button title="Yana ombor tafsilotlari" loading={details.loadingMore} onPress={details.loadMore} /> : undefined} renderItem={({ item }) => <View style={{ gap: 5, paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.border }}>
          <Text style={{ color: colors.text }}>{formatAmount(item.quantity, 3)} {item.unit || selected?.unit} · {tab === 'movements' ? item.type : item.batch_code || '#' + item.id}</Text>
          <Notice>{tab === 'movements' ? item.created_at : item.received_on}</Notice>
          {tab === 'batches' && <Notice error={item.expiry_status === 'expired'}>Yaroqlilik: {item.expires_on || 'Ko‘rsatilmagan'}{item.expiry_status === 'expired' ? ' · Muddati o‘tgan' : ''}</Notice>}
          {can('catalog.view_cost_price') && item.cost_price != null && <Notice>Tannarx: {formatAmount(item.cost_price)} {item.currency || selected?.currency}</Notice>}
          {can('inventory.view_supplier') && item.supplier ? <Notice>{item.supplier}</Notice> : null}
        </View>} />
      </View>
    </BottomSheet>
  </Page>;
};
