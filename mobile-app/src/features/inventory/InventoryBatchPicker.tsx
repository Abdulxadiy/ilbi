import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { Button } from '../../components/ui/Button';
import { ListState } from '../../components/ui/ListState';
import { Notice } from '../../components/ui/Page';
import { usePagedResource } from '../../hooks/usePagedResource';
import { useTheme } from '../../theme/ThemeContext';
import { positiveId, requiredDecimal, formatAmount } from '../reports/model';
function batchRow(value: any) { return { ...value, id: positiveId(value?.id), quantity: requiredDecimal(value.quantity) }; }
export function InventoryBatchPicker({ variantId, value, disabled, error, onChange }: { variantId: number | null; value: number | null; disabled: boolean; error?: string; onChange: (value: number | null) => void }) {
  const [open, setOpen] = useState(false), { colors } = useTheme();
  const list = usePagedResource(open && variantId ? '/inventory/batches/?product_variant_id=' + variantId : null, batchRow);
  return <>
    <Button title={'Partiya: ' + (value ? '#' + value : 'Avtomatik taqsimlash')} variant="secondary" disabled={disabled || !variantId} aria-invalid={Boolean(error)} style={error ? { borderColor: colors.danger } : undefined} onPress={() => setOpen(true)} />
    {error ? <Notice error>{error}</Notice> : null}
    <BottomSheet visible={open} title="Ombor partiyasini tanlang" onClose={() => setOpen(false)} scrollable>
      <View style={{ gap: 10 }}>
        <Button title="Avtomatik taqsimlash" variant="secondary" onPress={() => { onChange(null); setOpen(false); }} />
        {!list.rows.length && <ListState loading={list.loading} error={list.error} empty onRetry={list.retry} emptyLabel="Qoldiqli partiyalar topilmadi." />}
        {list.rows.map(row => <TouchableOpacity key={row.id} accessibilityRole="button" accessibilityLabel={'Partiya #' + row.id + 'ni tanlash'} onPress={() => { onChange(row.id); setOpen(false); }} style={{ gap: 5, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 10 }}>
          <Text style={{ color: colors.text, fontWeight: '600' }}>{row.batch_code || '#' + row.id} · {formatAmount(row.quantity, 3)} {row.unit}</Text>
          <Notice error={row.expiry_status === 'expired'}>Yaroqlilik: {row.expires_on || 'Ko‘rsatilmagan'}{row.expiry_status === 'expired' ? ' · Muddati o‘tgan' : ''}</Notice>
        </TouchableOpacity>)}
        {list.rows.length > 0 && list.error && <ListState error={list.error} onRetry={list.retry} />}
        {list.hasMore && <Button title="Yana partiyalar" variant="secondary" loading={list.loadingMore} onPress={list.loadMore} />}
      </View>
    </BottomSheet>
  </>;
}
