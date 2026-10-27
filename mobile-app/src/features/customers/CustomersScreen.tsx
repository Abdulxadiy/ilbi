import React, { useState } from 'react';
import { FlatList, Text, TouchableOpacity, View } from 'react-native';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { useTheme } from '../../theme/ThemeContext';
import { Page, Notice } from '../../components/ui/Page';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ListState } from '../../components/ui/ListState';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { usePagedResource, useDebounced } from '../../hooks/usePagedResource';
import { useApiAction } from '../../hooks/useApiAction';
import { usePermissions } from '../auth/usePermissions';
import { useAuth } from '../auth/AuthContext';
import { getServerScope } from '../../api/environment';
import { request } from '../../api/client';
import { formError } from '../../api/validation';
import { formatAmount } from '../reports/model';
import { parseCustomer, type Customer } from './model';

export const CustomersScreen: React.FC = () => {
  const { user, activeTenant } = useAuth();
  return <CustomersBody key={[getServerScope(), user?.id, activeTenant?.id].join(':')} />;
};
function CustomersBody() {
  const navigation = useAppNavigation(), { colors } = useTheme(), { can } = usePermissions();
  const allowed = can('sales.manage_counterparty') || can('sales.record_debt_payment');
  const [search, setSearch] = useState(''), [debtors, setDebtors] = useState(false);
  const query = useDebounced(search.trim());
  const customers = usePagedResource(allowed ? '/sales/counterparties/?' + new URLSearchParams({ search: query, ...(debtors ? { balance_status: 'debtors' } : {}) }).toString() : null, parseCustomer);
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const [name, setName] = useState(''), [phone, setPhone] = useState(''), [note, setNote] = useState('');
  const action = useApiAction('sales.manage_counterparty');
  const open = (item: Customer | 'new') => { action.clearError(); setEditing(item); setName(item === 'new' ? '' : item.name); setPhone(item === 'new' ? '' : item.phone_number); setNote(item === 'new' ? '' : item.note); };
  const save = async () => {
    if (!editing) return;
    const result = await action.run(async () => {
      const fields: Record<string, string> = {};
      if (!name.trim()) fields.name = 'Mijoz ismini kiriting.';
      if (editing === 'new' && !/^\+?[\d\s()-]{7,20}$/.test(phone.trim())) fields.phone_number = 'Telefon raqamini tekshiring.';
      if (Object.keys(fields).length) throw formError(fields);
      return parseCustomer(await request(editing === 'new' ? '/sales/counterparties/' : '/sales/counterparties/' + editing.id + '/', { method: editing === 'new' ? 'POST' : 'PATCH', body: { name: name.trim(), note: note.trim(), ...(editing === 'new' ? { phone_number: phone.trim() } : {}) } }));
    });
    if (result) { setEditing(null); await customers.reload(); }
  };
  return <Page title="Mijozlar" onMenu={navigation.openDrawer} insetBottom={false} scroll={false}>
    <View style={{ padding: 16, gap: 12 }}>
      {can('sales.manage_counterparty') && <Button title="Yangi mijoz" onPress={() => open('new')} />}
      <Input label="Mijoz qidirish" value={search} onChangeText={setSearch} placeholder="Ism yoki telefon" />
      <Button title={debtors ? 'Qarzdorlar: yoqilgan' : 'Faqat qarzdorlar'} variant="secondary" onPress={() => setDebtors(value => !value)} />
      {customers.summary && <Notice>Jami mijozlar: {customers.summary.total_count ?? '—'} · Nasiya: {formatAmount(customers.summary.total_debt_uzs)} UZS / {formatAmount(customers.summary.total_debt_usd)} USD</Notice>}
      {!allowed && <Notice error>Mijozlar ro‘yxati uchun vakolat berilmagan.</Notice>}
    </View>
    <FlatList data={customers.rows} keyExtractor={item => String(item.id)} contentContainerStyle={{ padding: 16, gap: 12 }} refreshing={customers.loading} onRefresh={customers.reload}
      ListEmptyComponent={<ListState loading={customers.loading} error={customers.error} empty onRetry={customers.retry} emptyLabel="Mijoz topilmadi." />}
      ListFooterComponent={<>{customers.rows.length > 0 && customers.error && <ListState error={customers.error} onRetry={customers.retry} />}{customers.hasMore && <Button title="Yana mijozlar" variant="secondary" loading={customers.loadingMore} onPress={customers.loadMore} />}</>}
      renderItem={({ item }) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={item.name + ': profil'} onPress={() => can('sales.manage_counterparty') ? open(item) : undefined} disabled={!can('sales.manage_counterparty')} style={{ padding: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 14, gap: 6 }}>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>{item.name}</Text>
        <Text style={{ color: colors.textSecondary }}>{item.phone_number || 'Telefon ko‘rsatilmagan'}</Text>
        <Text style={{ color: Number(item.debt_balance_uzs) > 0 ? colors.danger : colors.text }}>Balans: {formatAmount(item.debt_balance_uzs)} UZS / {formatAmount(item.debt_balance_usd)} USD</Text>
        {item.note ? <Notice>{item.note}</Notice> : null}
      </TouchableOpacity>} />
    <BottomSheet visible={editing !== null} title={editing === 'new' ? 'Yangi mijoz' : 'Mijozni tahrirlash'} scrollable onClose={() => { if (!action.busy) setEditing(null); }}>
      <Input label="Mijoz ismi" value={name} maxLength={150} editable={!action.busy} error={action.fields.name} onChangeText={value => { setName(value); action.clearField('name'); }} />
      <Input label="Telefon raqami" value={phone} keyboardType="phone-pad" maxLength={20} editable={editing === 'new' && !action.busy} error={action.fields.phone_number} onChangeText={value => { setPhone(value); action.clearField('phone_number'); }} />
      <Input label="Mijoz izohi" value={note} multiline editable={!action.busy} error={action.fields.note} onChangeText={value => { setNote(value); action.clearField('note'); }} />
      {action.error ? <Notice error>{action.error}</Notice> : null}
      <Button title="Mijozni saqlash" loading={action.busy} onPress={save} />
    </BottomSheet>
  </Page>;
}
