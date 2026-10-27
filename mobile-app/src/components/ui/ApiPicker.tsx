import { useState } from 'react';
import { FlatList, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { useDebounced, usePagedResource } from '../../hooks/usePagedResource';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Input } from './Input';
import { ListState } from './ListState';
export interface PickValue { id: number; name: string; currency?: string; [key: string]: any; }
function parsePick(value: any): PickValue { if (!value || typeof value.name !== 'string') throw Error('Tanlov ma’lumotlari tasdiqlanmadi.'); return value; }
export function ApiPicker({ label, endpoint, value, onChange, optional = false, disabled = false, error }: { label: string; endpoint: string; value: PickValue | null; onChange: (value: PickValue | null) => void; optional?: boolean; disabled?: boolean; error?: string }) {
  const [open, setOpen] = useState(false), [search, setSearch] = useState('');
  const { colors } = useTheme(), query = useDebounced(search.trim());
  const resource = usePagedResource<PickValue>(open ? endpoint + (endpoint.includes('?') ? '&' : '?') + 'search=' + encodeURIComponent(query) : null, parsePick);
  return <>
    <Button title={label + ': ' + (value?.name || 'Tanlang')} variant="secondary" disabled={disabled} aria-invalid={Boolean(error)} accessibilityHint={error} style={error ? { borderColor: colors.danger, backgroundColor: colors.dangerSurface } : undefined} onPress={() => setOpen(true)} />
    {error ? <Text accessibilityRole="alert" style={{ color: colors.danger, marginVertical: 4 }}>{error}</Text> : null}
    <BottomSheet visible={open} title={label} onClose={() => setOpen(false)}>
      <Input label={label + ' qidirish'} value={search} onChangeText={setSearch} />
      {optional && <Button title="Tanlovsiz davom etish" variant="ghost" onPress={() => { onChange(null); setOpen(false); }} />}
      <FlatList data={resource.rows} keyExtractor={row => String(row.id)} style={{ maxHeight: 300 }} keyboardShouldPersistTaps="handled" onEndReached={() => { void resource.loadMore(); }}
        ListEmptyComponent={<ListState loading={resource.loading} error={resource.error} empty onRetry={resource.retry} />}
        ListFooterComponent={resource.rows.length ? <><ListState loading={resource.loadingMore} error={resource.error} onRetry={resource.retry} />{resource.hasMore ? <Button title="Yana yuklash" variant="secondary" onPress={() => { void resource.loadMore(); }} /> : null}</> : undefined}
        renderItem={({ item }) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={item.name} onPress={() => { onChange(item); setOpen(false); }} style={{ paddingVertical: 15, borderBottomWidth: 1, borderColor: colors.borderSubtle }}><Text style={{ color: colors.text, fontWeight: '600' }}>{item.name}</Text>{item.currency ? <Text style={{ color: colors.textSecondary }}>{item.currency}</Text> : null}</TouchableOpacity>} />
    </BottomSheet>
  </>;
}
