import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Button } from '../../components/ui/Button';
import { ChoiceField } from '../../components/ui/ChoiceField';
import { ListState } from '../../components/ui/ListState';
import { Notice } from '../../components/ui/Page';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { usePagedResource } from '../../hooks/usePagedResource';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { useTheme } from '../../theme/ThemeContext';
import { positiveId, requiredDecimal, formatAmount } from '../reports/model';
import type { InventoryAction } from './commands';
const statusLabels: Record<string, string> = { pending: 'Yo‘lda', delivered: 'Qabul qilingan', delivered_owner: 'Egasi o‘tkazgan', discrepancy: 'Tafovut bor', closed: 'Tafovut yopilgan' };
function transferRow(value: any) {
  if (!value || !Array.isArray(value.items) || !Object.hasOwn(statusLabels, value.status) || !['internal', 'return'].includes(value.kind)) throw Error('Transfer yozuvi tasdiqlanmadi.');
  const row = { ...value, id: positiveId(value.id), source_tenant: positiveId(value.source_tenant), destination_tenant: positiveId(value.destination_tenant) };
  row.items = value.items.map((item: any) => ({ ...item, id: positiveId(item.id), quantity_sent: requiredDecimal(item.quantity_sent), quantity_received: requiredDecimal(item.quantity_received), quantity_returned: requiredDecimal(item.quantity_returned), quantity_return_in_transit: requiredDecimal(item.quantity_return_in_transit) }));
  return row;
}
export function InventoryTransfers({ revision, onOperation }: { revision: number; onOperation: (kind: InventoryAction, source: any) => void }) {
  const { activeTenant } = useAuth(), { isOwner } = usePermissions(), { colors } = useTheme();
  const [status, setStatus] = useState('all'), [selected, setSelected] = useState<any>(null);
  const list = usePagedResource('/inventory/transfers/?revision=' + revision + (status === 'all' ? '' : '&status=' + status), transferRow);
  const operate = (kind: InventoryAction) => { const value = selected; setSelected(null); onOperation(kind, value); };
  return <View style={{ padding: 16, gap: 12 }}>
    <ChoiceField label="Transfer holati" value={status} options={[{ value: 'all', label: 'Barchasi' }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]} onChange={setStatus} />
    <Button title="Transferlarni yangilash" variant="secondary" loading={list.loading} onPress={list.reload} />
    {!list.rows.length && <ListState loading={list.loading} error={list.error} empty onRetry={list.retry} emptyLabel="Transferlar topilmadi." />}
    {list.rows.map(row => <TouchableOpacity key={row.id} accessibilityRole="button" accessibilityLabel={'Transfer #' + row.id} onPress={() => setSelected(row)} style={{ padding: 14, gap: 6, borderWidth: 1, borderRadius: 12, borderColor: colors.border, backgroundColor: colors.surface }}>
      <Text style={{ color: colors.text, fontWeight: '700' }}>#{row.id} · {row.kind === 'return' ? 'Jismoniy qaytish' : 'Ichki transfer'}</Text>
      <Notice>{row.source_tenant_name} → {row.destination_tenant_name}</Notice><Notice>{statusLabels[row.status]} · {row.sent_at}</Notice>
    </TouchableOpacity>)}
    {list.rows.length > 0 && list.error && <ListState error={list.error} onRetry={list.retry} />}
    {list.hasMore && <Button title="Yana transferlar" loading={list.loadingMore} variant="secondary" onPress={list.loadMore} />}
    <BottomSheet visible={Boolean(selected)} title={'Transfer #' + (selected?.id || '')} onClose={() => setSelected(null)} scrollable>
      {selected && <View style={{ gap: 12 }}>
        <Notice>{selected.source_tenant_name} → {selected.destination_tenant_name} · {statusLabels[selected.status]}</Notice>
        {selected.items.map((item: any) => <View key={item.id} style={{ gap: 5, paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.border }}>
          <Text style={{ color: colors.text, fontWeight: '600' }}>{item.source_product_name} · {item.source_variant_name}</Text>
          <Notice>Jo‘natilgan: {formatAmount(item.quantity_sent, 3)} · qabul: {formatAmount(item.quantity_received, 3)}</Notice>
          <Notice>Qaytarilgan: {formatAmount(item.quantity_returned, 3)} · ortga yo‘lda: {formatAmount(item.quantity_return_in_transit, 3)}</Notice>
          {item.discrepancy_reason ? <Notice error>{item.discrepancy_reason}</Notice> : null}
        </View>)}
        {selected.note ? <Notice>{selected.note}</Notice> : null}
        {selected.destination_tenant === activeTenant?.id && selected.status === 'pending' && <Button title="Qabul qilish yoki tafovutni yozish" onPress={() => operate('receive')} />}
        {selected.destination_tenant === activeTenant?.id && selected.kind === 'internal' && selected.status !== 'pending' && <Button title="Jismonan qaytarish" variant="secondary" onPress={() => operate('return')} />}
        {isOwner && selected.source_tenant === activeTenant?.id && selected.status === 'discrepancy' && <Button title="Tafovutni yopish" variant="danger" onPress={() => operate('close-discrepancy')} />}
      </View>}
    </BottomSheet>
  </View>;
}
