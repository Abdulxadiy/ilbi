import React, { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { useTheme } from '../../theme/ThemeContext';
import { Page, Notice } from '../../components/ui/Page';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ListState } from '../../components/ui/ListState';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { ChoiceField } from '../../components/ui/ChoiceField';
import { usePagedResource, useDebounced } from '../../hooks/usePagedResource';
import { useApiAction } from '../../hooks/useApiAction';
import { usePermissions } from '../auth/usePermissions';
import { useAuth } from '../auth/AuthContext';
import { getServerScope } from '../../api/environment';
import { assertAuthScope, captureAuthScope, request } from '../../api/client';
import { parseMoneyMinor } from '../../domain/money';
import { formatAmount } from '../reports/model';
import { customerBody, customerDraft, parseCustomer, type Customer, type CustomerDraft } from './model';

export const CustomersScreen: React.FC = () => {
  const { user, activeTenant } = useAuth();
  return <CustomersBody key={[getServerScope(), user?.id, activeTenant?.id].join(':')} />;
};
function CustomersBody() {
  const navigation = useAppNavigation(), { colors } = useTheme(), { can } = usePermissions();
  const { user, activeTenant } = useAuth();
  const allowed = can('sales.manage_counterparty') || can('sales.record_debt_payment');
  const [search, setSearch] = useState(''), [balance, setBalance] = useState(''), [includeArchived, setIncludeArchived] = useState(false);
  const query = useDebounced(search.trim());
  const customers = usePagedResource(allowed ? '/sales/counterparties/?' + new URLSearchParams({ search: query, ...(balance ? { balance_status: balance } : {}), ...(includeArchived ? { active: 'all' } : {}) }).toString() : null, parseCustomer);
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const [draft, setDraft] = useState<CustomerDraft>(customerDraft), [archiving, setArchiving] = useState<Customer | null>(null), [message, setMessage] = useState('');
  const action = useApiAction('sales.manage_counterparty');
  const open = (item: Customer | 'new') => { action.clearError(); setEditing(item); setDraft(customerDraft(item === 'new' ? undefined : item)); };
  const field = (key: keyof CustomerDraft, value: string) => { setDraft(current => ({ ...current, [key]: value })); action.clearField(key); };
  const save = async () => {
    if (!editing) return;
    const result = await action.run(async () => {
      const body = customerBody(draft, editing !== 'new'), scope = captureAuthScope(user?.id, activeTenant?.id);
      assertAuthScope(scope);
      const row = parseCustomer(await request(editing === 'new' ? '/sales/counterparties/' : '/sales/counterparties/' + editing.id + '/', { method: editing === 'new' ? 'POST' : 'PATCH', body }));
      assertAuthScope(scope);
      if (editing !== 'new' && row.id !== editing.id) throw Error('Server so‘ralgan mijozni tasdiqlamadi.');
      return row;
    });
    if (result) { setEditing(null); setMessage('Mijoz ma’lumotlari saqlandi.'); await customers.reload(); }
  };
  const archive = async () => {
    if (!archiving) return;
    const result = await action.run(async () => {
      const scope = captureAuthScope(user?.id, activeTenant?.id); assertAuthScope(scope);
      const row = parseCustomer(await request(`/sales/counterparties/${archiving.id}/`)); assertAuthScope(scope);
      if (row.id !== archiving.id || parseMoneyMinor(row.debt_balance_uzs, true) !== 0 || parseMoneyMinor(row.debt_balance_usd, true) !== 0) throw Error('Avval mijozning qarzi yoki ortiqcha to‘lovini yakunlang.');
      const ack = await request(`/sales/counterparties/${row.id}/`, { method: 'DELETE' }); assertAuthScope(scope);
      if (typeof ack?.detail !== 'string') throw Error('Arxivlash tasdiqlanmadi. Ro‘yxatni yangilang.');
      return true;
    });
    if (result) { setArchiving(null); setMessage('Mijoz arxivlandi. Savdo va to‘lov tarixi saqlandi.'); await customers.reload(); }
  };
  return <Page title="Mijozlar" onBack={navigation.goBack} insetBottom={false} scroll={false}>
    <View style={{ padding: 16, gap: 12 }}>
      {can('sales.manage_counterparty') && <Button title="Yangi mijoz" onPress={() => open('new')} />}
      {can('sales.manage_counterparty') && <Button title="Excel / CSV orqali mijozlarni yuklash" variant="secondary" onPress={() => navigation.navigate('CustomerImport')} />}
      <Input label="Mijoz qidirish" value={search} onChangeText={setSearch} placeholder="Ism yoki telefon" />
      <ChoiceField label="Mijoz balansi" value={balance} options={[{ value: '', label: 'Barchasi' }, { value: 'debtors', label: 'Qarzdorlar' }, { value: 'credit', label: 'Mijoz haqqi' }, { value: 'settled', label: 'Hisobi yopilgan' }]} onChange={setBalance} />
      <Button title={includeArchived ? 'Arxiv ham ko‘rsatilmoqda' : 'Arxivdagilarni ham ko‘rsatish'} variant="ghost" onPress={() => setIncludeArchived(value => !value)} />
      {message ? <Notice>{message}</Notice> : null}
      {customers.summary && <Notice>Jami mijozlar: {customers.summary.total_count ?? '—'} · Nasiya: {formatAmount(customers.summary.total_debt_uzs)} UZS / {formatAmount(customers.summary.total_debt_usd)} USD</Notice>}
      {!allowed && <Notice error>Mijozlar ro‘yxati uchun vakolat berilmagan.</Notice>}
    </View>
    <FlatList data={customers.rows} keyExtractor={item => String(item.id)} contentContainerStyle={{ padding: 16, gap: 12 }} refreshing={customers.loading} onRefresh={customers.reload}
      ListEmptyComponent={<ListState loading={customers.loading} error={customers.error} empty onRetry={customers.retry} emptyLabel="Mijoz topilmadi." />}
      ListFooterComponent={<>{customers.rows.length > 0 && customers.error && <ListState error={customers.error} onRetry={customers.retry} />}{customers.hasMore && <Button title="Yana mijozlar" variant="secondary" loading={customers.loadingMore} onPress={customers.loadMore} />}</>}
      renderItem={({ item }) => <View style={{ padding: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 14, gap: 8 }}>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>{item.name}</Text>
        <Text style={{ color: colors.textSecondary }}>{item.phone_number || 'Telefon ko‘rsatilmagan'}</Text>
        <Text style={{ color: Number(item.debt_balance_uzs) > 0 ? colors.danger : colors.text }}>Balans: {formatAmount(item.debt_balance_uzs)} UZS / {formatAmount(item.debt_balance_usd)} USD</Text>
        {item.note ? <Notice>{item.note}</Notice> : null}
        {item.target_tenant ? <Notice>B2B: {item.target_tenant_name || 'Bog‘langan do‘kon'}</Notice> : null}
        {item.debt_due_date ? <Notice>Qarz muddati: {item.debt_due_date}</Notice> : null}
        {!item.is_active && <Notice>Arxivlangan mijoz</Notice>}
        <Button title={item.name + ': ko‘chirma'} variant="secondary" onPress={() => navigation.navigate('Customer', { id: String(item.id) })} />
        {can('sales.manage_counterparty') && <><Button title={item.name + ': tahrirlash'} variant="ghost" onPress={() => open(item)} />{item.is_active && <Button title={item.name + ': arxivlash'} variant="ghost" disabled={action.busy} onPress={() => { action.clearError(); setArchiving(item); }} />}</>}
      </View>} />
    <BottomSheet visible={editing !== null} title={editing === 'new' ? 'Yangi mijoz' : 'Mijozni tahrirlash'} scrollable onClose={() => { if (!action.busy) setEditing(null); }}>
      <Input label="Mijoz ismi" value={draft.name} maxLength={150} editable={!action.busy} error={action.fields.name} onChangeText={value => field('name', value)} />
      <Input label="Telefon raqami" value={draft.phone_number} keyboardType="phone-pad" maxLength={20} editable={editing === 'new' && !action.busy} error={action.fields.phone_number} onChangeText={value => field('phone_number', value)} />
      {editing === 'new' ? <><Input label="B2B do‘kon kodi (ixtiyoriy)" value={draft.target_tenant_code} maxLength={12} autoCapitalize="characters" editable={!action.busy} error={action.fields.target_tenant_code} onChangeText={value => field('target_tenant_code', value)} /><Notice>Kod boshqa faol do‘konga bog‘laydi. Bu mijozga sotuv B2B qabul qilish jarayonini boshlashi mumkin.</Notice></> : editing?.target_tenant ? <Notice>B2B: {editing.target_tenant_name || 'Bog‘langan do‘kon'}. Bog‘lanish yaratilganidan keyin bu formadan o‘zgarmaydi.</Notice> : null}
      <Input label="Standart qarz muddati (YYYY-MM-DD)" value={draft.debt_due_date} placeholder="2026-12-31" maxLength={10} editable={!action.busy} error={action.fields.debt_due_date} onChangeText={value => field('debt_due_date', value)} />
      <Input label="Mijoz izohi" value={draft.note} multiline editable={!action.busy} error={action.fields.note} onChangeText={value => field('note', value)} />
      {action.error ? <Notice error>{action.error}</Notice> : null}
      <Button title="Mijozni saqlash" loading={action.busy} onPress={save} />
    </BottomSheet>
    <BottomSheet visible={archiving !== null} title="Mijozni arxivlash" onClose={() => { if (!action.busy) setArchiving(null); }}>
      <View style={{ gap: 12 }}><Notice>{archiving?.name} arxivlanadi. Mijozda UZS yoki USD qarz/haq qolgan bo‘lsa, server amalni rad etadi. Savdo va to‘lov tarixi saqlanadi.</Notice>{action.error ? <Notice error>{action.error}</Notice> : null}<Button title="Arxivlashni tasdiqlash" variant="danger" loading={action.busy} onPress={archive} /><Button title="Bekor qilish" variant="secondary" disabled={action.busy} onPress={() => setArchiving(null)} /></View>
    </BottomSheet>
  </Page>;
}
