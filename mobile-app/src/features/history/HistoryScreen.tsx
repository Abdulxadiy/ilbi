import React, { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Page, Notice } from '../../components/ui/Page';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ListState } from '../../components/ui/ListState';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { useTheme } from '../../theme/ThemeContext';
import { useAuth } from '../auth/AuthContext';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { useDebounced } from '../../hooks/usePagedResource';
import { positiveId, formatAmount } from '../reports/model';

type Event = { id: string; source: string; object_id: number; title: string; subtitle: string; created_at: string; actor_name: string; amount: string | null; currency: string; sale_id?: number | null; status?: string };
function parseEvent(value: any): Event {
  if (!value || typeof value.source !== 'string' || !/^[a-z_]{1,40}$/.test(value.source) || typeof value.id !== 'string') throw Error('Tarix yozuvi tasdiqlanmadi.');
  return { ...value, object_id: positiveId(value.object_id), title: String(value.title || ''), subtitle: String(value.subtitle || ''), actor_name: String(value.actor_name || ''), created_at: String(value.created_at || ''), amount: value.amount == null ? null : String(value.amount), currency: String(value.currency || '') };
}
function parseHistory(value: any) {
  const raw = Array.isArray(value) ? value : value?.results;
  if (!Array.isArray(raw)) throw Error('Tarix ro‘yxati tasdiqlanmadi.');
  return { rows: raw.map(parseEvent), count: Number(value?.count ?? raw.length), hasMore: Boolean(value?.next) };
}
function parseDetail(value: any) {
  if (!value || !value.details || !Array.isArray(value.details.fields)) throw Error('Tarix tafsilotlari tasdiqlanmadi.');
  return { event: parseEvent(value.event), details: value.details, sale: value.sale || null };
}
const categories = [['all', 'Barchasi'], ['sales', 'Savdolar'], ['inventory', 'Ombor'], ['catalog', 'Tovarlar'], ['finance', 'Moliya'], ['team', 'Jamoa'], ['settings', 'Sozlamalar']] as const;
export const HistoryScreen: React.FC = () => {
  const navigation = useAppNavigation(), { colors } = useTheme(), { user, activeTenant } = useAuth();
  const allowed = user?.role === 'owner' && user.tenants.some(member => member.id === activeTenant?.id && member.is_owner);
  const [search, setSearch] = useState(''), [category, setCategory] = useState('all'), [page, setPage] = useState(1);
  const debounced = useDebounced(search.trim());
  const params = new URLSearchParams({ category, page: String(page), page_size: '30' });
  if (debounced) params.set('search', debounced);
  const history = useScopedQuery(allowed ? '/audit/history/?' + params.toString() : null, parseHistory);
  const [selected, setSelected] = useState<Event | null>(null);
  const detail = useScopedQuery(allowed && selected ? '/audit/history/' + encodeURIComponent(selected.source) + '/' + selected.object_id + '/' : null, parseDetail);
  return <Page title="Tarix" onMenu={navigation.openDrawer} insetBottom={false}>
    {!allowed ? <Notice error>Tarixni faqat faol do‘kon egasi ko‘ra oladi.</Notice> : <>
      <Input label="Tarixdan qidirish" value={search} onChangeText={value => { setSearch(value); setPage(1); }} placeholder="Amal, mijoz yoki hujjat" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {categories.map(([value, label]) => <Button key={value} title={label} size="sm" variant={category === value ? 'primary' : 'secondary'} onPress={() => { setCategory(value); setPage(1); }} />)}
      </ScrollView>
      <ListState loading={history.loading} error={history.error} empty={!history.data?.rows.length} onRetry={history.reload} emptyLabel="Ushbu filtr bo‘yicha tarix topilmadi." />
      {history.data?.rows.map(event => <TouchableOpacity key={event.id} accessibilityRole="button" accessibilityLabel={event.title + ': tafsilotlar'} onPress={() => setSelected(event)} style={{ padding: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 14, gap: 7 }}>
        <Text style={{ color: colors.text, fontWeight: '600' }}>{event.title}</Text>
        {event.subtitle ? <Text style={{ color: colors.textSecondary }}>{event.subtitle}</Text> : null}
        <Text style={{ color: colors.textSecondary }}>{event.created_at ? new Date(event.created_at).toLocaleString('uz-UZ') : '—'} · {event.actor_name || 'Tizim'}</Text>
        {event.amount != null && <Text style={{ color: colors.text }}>{formatAmount(event.amount)} {event.currency}</Text>}
      </TouchableOpacity>)}
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <Button title="Oldingi sahifa" variant="secondary" disabled={page <= 1 || history.loading} onPress={() => setPage(value => value - 1)} />
        <Notice>{page}-sahifa</Notice>
        <Button title="Keyingi sahifa" variant="secondary" disabled={!history.data?.hasMore || history.loading} onPress={() => setPage(value => value + 1)} />
      </View>
    </>}
    <BottomSheet title={selected?.title || 'Tarix tafsilotlari'} visible={Boolean(selected)} onClose={() => setSelected(null)} scrollable>
      <ListState loading={detail.loading} error={detail.error} onRetry={detail.reload} />
      {detail.data && detail.data.event.source === selected?.source && detail.data.event.object_id === selected?.object_id && <View style={{ gap: 14 }}>
        <Notice>{detail.data.event.subtitle}</Notice>
        {detail.data.details.fields.map((row: any, index: number) => <View key={index} style={{ gap: 4 }}><Text style={{ color: colors.textSecondary }}>{String(row.label || row.key || '')}</Text><Text selectable style={{ color: colors.text }}>{typeof row.value === 'object' ? JSON.stringify(row.value) : String(row.value ?? '—')}</Text></View>)}
        {detail.data.details.note ? <Notice>{String(detail.data.details.note)}</Notice> : null}
        {Object.entries(detail.data.details.changes || {}).map(([key, value]) => <View key={key} style={{ gap: 4 }}><Text style={{ color: colors.textSecondary }}>{changeLabel(key)}</Text><Text selectable style={{ color: colors.text }}>{changeValue(value)}</Text></View>)}
        {detail.data.sale && <Button title="Savdo chekini ochish" onPress={() => { const sale = detail.data!.sale; setSelected(null); navigation.navigate('ReceiptView', { sale }); }} />}
      </View>}
    </BottomSheet>
  </Page>;
};

const changeLabels: Record<string, string> = { first_name: 'Ism', last_name: 'Familiya', name: 'Nomi', price_recommended: 'Sotuv narxi', price_partner: 'Ulgurji narx', price_min: 'Minimal narx', quantity: 'Miqdor', note: 'Izoh', status: 'Holat', is_active: 'Faollik', phone_number: 'Telefon', email: 'Email' };
function changeLabel(key: string) { return changeLabels[key] || key.replace(/_/g, ' '); }
function changeValue(value: unknown): string {
  if (value == null) return '—';
  if (Array.isArray(value)) return value.map(changeValue).join(', ');
  if (typeof value === 'object') {
    const row = value as Record<string, unknown>;
    if ('old' in row || 'new' in row) return changeValue(row.old) + ' → ' + changeValue(row.new);
    return Object.entries(row).map(([key, item]) => changeLabel(key) + ': ' + changeValue(item)).join(' · ');
  }
  return typeof value === 'boolean' ? (value ? 'Ha' : 'Yo‘q') : String(value);
}
