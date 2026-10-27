import React, { useRef, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { useTheme } from '../../theme/ThemeContext';
import { Page, Notice } from '../../components/ui/Page';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { ListState } from '../../components/ui/ListState';
import { usePagedResource, useDebounced } from '../../hooks/usePagedResource';
import { useFormErrors } from '../../hooks/useFormErrors';
import { captureAuthScope, assertAuthScope, request } from '../../api/client';
import { getServerScope } from '../../api/environment';
import { withFinancialIdentity, confirmFinancialIdentity, rejectFinancialIdentity } from '../../api/financialIdentity';
import { parseMoneyMinor } from '../../domain/money';
import { formatAmount, positiveId } from '../reports/model';
import { parseCustomer, type Customer } from '../customers/model';

type Accepted = { key: string; operation: string; userId: number; tenantId: number; result: any; scope: ReturnType<typeof captureAuthScope> };
export const DebtsScreen: React.FC = () => {
  const { user, activeTenant } = useAuth();
  return <DebtsBody key={[getServerScope(), user?.id, activeTenant?.id].join(':')} />;
};
function DebtsBody() {
  const { user, activeTenant } = useAuth(), { can, requirePermission } = usePermissions(), { colors } = useTheme(), navigation = useAppNavigation();
  const allowed = can('sales.manage_counterparty') || can('sales.record_debt_payment');
  const [search, setSearch] = useState(''), query = useDebounced(search.trim());
  const debts = usePagedResource(allowed ? '/sales/counterparties/?' + new URLSearchParams({ balance_status: 'debtors', search: query }).toString() : null, parseCustomer);
  const [selected, setSelected] = useState<Customer | null>(null), [amount, setAmount] = useState(''), [currency, setCurrency] = useState<'UZS' | 'USD'>('UZS'), [method, setMethod] = useState<'cash' | 'card'>('cash');
  const [paying, setPaying] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [accepted, setAccepted] = useState<Accepted | null>(null);
  const submitting = useRef(false), fields = useFormErrors();
  const open = (item: Customer) => { fields.clear(); setError(''); setMessage(''); setAccepted(null); setSelected(item); const next = Number(item.debt_balance_uzs) > 0 ? 'UZS' : 'USD'; setCurrency(next); setAmount(next === 'UZS' ? item.debt_balance_uzs : item.debt_balance_usd); setMethod('cash'); };
  const settleLocally = async (record: Accepted) => {
    assertAuthScope(record.scope);
    await confirmFinancialIdentity(record.operation, record.userId, record.tenantId, record.key, record.result);
    assertAuthScope(record.scope);
    setSelected(null); setAccepted(null); setMessage('To‘lov serverda tasdiqlandi. Qoldiq serverdan yangilandi.');
    await debts.reload();
  };
  const pay = async () => {
    if (!selected || submitting.current || !user || !activeTenant) return;
    fields.clear(); setError('');
    let minor: number;
    try { minor = parseMoneyMinor(amount); if (minor <= 0) throw Error(); }
    catch { fields.setErrors({ amount: 'To‘lov summasini to‘g‘ri kiriting.' }); return; }
    submitting.current = true; setPaying(true);
    const scope = captureAuthScope(), operation = 'debt-' + selected.id, userId = user.id, tenantId = activeTenant.id;
    let key: string | null = null;
    try {
      requirePermission('sales.record_debt_payment');
      if (accepted) { await settleLocally(accepted); return; }
      const live = parseCustomer(await request('/sales/counterparties/' + selected.id + '/'));
      assertAuthScope(scope);
      if (live.id !== selected.id) throw Error('Server tanlangan mijozni tasdiqlamadi.');
      const balance = currency === 'UZS' ? live.debt_balance_uzs : live.debt_balance_usd;
      if (minor > parseMoneyMinor(balance, true)) { fields.setErrors({ amount: 'To‘lov joriy qarzdan oshmasin: ' + formatAmount(balance) + ' ' + currency }); return; }
      const cents = BigInt(minor), decimalAmount = `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
      const payload = await withFinancialIdentity(operation, { amount: decimalAmount, currency, payment_type: method }, userId, tenantId);
      key = payload.idempotency_key;
      assertAuthScope(scope);
      const result = await request('/sales/counterparties/' + selected.id + '/payments/', { method: 'POST', body: payload });
      assertAuthScope(scope);
      positiveId(result?.id);
      if (Number(result.counterparty) !== selected.id || result.currency !== currency || parseMoneyMinor(result.amount) !== minor) throw Error('Server to‘lov natijasini to‘liq tasdiqlamadi. Amallar jurnalidan tekshiring.');
      const record: Accepted = { key, operation, userId, tenantId, result, scope };
      setAccepted(record);
      // A failed local acknowledgement must only retry this local write, never another payment POST.
      await settleLocally(record);
    } catch (failure: any) {
      fields.capture(failure);
      let detail = failure.message || 'To‘lov tasdiqlanmadi.';
      if (key && [400, 403, 404, 422].includes(failure.status)) {
        try { assertAuthScope(scope); await rejectFinancialIdentity(operation, userId, tenantId, key, detail); }
        catch { detail += ' Mahalliy jurnalni tekshiring; eski amal saqlanadi.'; }
      }
      setError(detail);
    } finally { submitting.current = false; setPaying(false); }
  };
  return <Page title="Qarzlar" onMenu={navigation.openDrawer} scroll={false} insetBottom={false}>
    <View style={{ padding: 16, gap: 12 }}>
      <Input label="Mijoz qidirish (ism, telefon, STIR)" value={search} onChangeText={setSearch} placeholder="Ism yoki telefon" />
      {debts.summary && <><Text style={{ color: colors.text, fontSize: 22, fontWeight: '700' }}>{formatAmount(debts.summary.total_debt_uzs)} UZS</Text><Notice>{formatAmount(debts.summary.total_debt_usd)} USD · Qarzdorlar: {debts.summary.debtors_count ?? '—'}</Notice></>}
      {message ? <Notice>{message}</Notice> : null}
      {!allowed && <Notice error>Qarzlarni ko‘rish uchun vakolat berilmagan.</Notice>}
    </View>
    <FlatList data={debts.rows} keyExtractor={item => String(item.id)} contentContainerStyle={{ padding: 16, gap: 12 }} refreshing={debts.loading} onRefresh={debts.reload}
      ListEmptyComponent={<ListState loading={debts.loading} error={debts.error} empty onRetry={debts.retry} emptyLabel="Qarzdorlar topilmadi." />}
      ListFooterComponent={<>{debts.rows.length > 0 && debts.error && <ListState error={debts.error} onRetry={debts.retry} />}{debts.hasMore && <Button title="Yana qarzdorlar" variant="secondary" loading={debts.loadingMore} onPress={debts.loadMore} />}</>}
      renderItem={({ item }) => <View style={{ padding: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 14, gap: 8 }}>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{item.name}</Text>
        <Notice>{item.phone_number || 'Telefon ko‘rsatilmagan'}</Notice>
        <Text style={{ color: colors.danger }}>{formatAmount(item.debt_balance_uzs)} UZS / {formatAmount(item.debt_balance_usd)} USD</Text>
        {item.debt_due_date ? <Notice>Qarz muddati: {item.debt_due_date}</Notice> : null}
        {can('sales.record_debt_payment') && <Button title="To‘lov qabul qilish" variant="secondary" onPress={() => open(item)} />}
      </View>} />
    <BottomSheet visible={selected !== null} title={selected?.name || 'Qarz to‘lovi'} scrollable onClose={() => { if (!paying) setSelected(null); }}>
      <View style={{ gap: 12 }}>
        {accepted ? <Notice>Server to‘lovni qabul qildi. Mahalliy tasdiq saqlanishi kutilmoqda; yangi to‘lov yuborilmaydi.</Notice> : <>
          <View style={{ flexDirection: 'row', gap: 8 }}>{(['UZS', 'USD'] as const).map(value => <Button key={value} title={value} variant={currency === value ? 'primary' : 'secondary'} disabled={paying} onPress={() => { setCurrency(value); setAmount(value === 'UZS' ? selected?.debt_balance_uzs || '' : selected?.debt_balance_usd || ''); fields.clear('amount'); }} />)}</View>
          <Input label="To‘lov summasi" value={amount} onChangeText={value => { setAmount(value); fields.clear('amount'); }} error={fields.errors.amount} keyboardType="decimal-pad" editable={!paying} />
          <View style={{ flexDirection: 'row', gap: 8 }}><Button title="Naqd" variant={method === 'cash' ? 'primary' : 'secondary'} disabled={paying} onPress={() => setMethod('cash')} /><Button title="Karta" variant={method === 'card' ? 'primary' : 'secondary'} disabled={paying} onPress={() => setMethod('card')} /></View>
        </>}
        {error ? <Notice error>{error}</Notice> : null}
        <Button title={accepted ? 'Mahalliy tasdiqni saqlash' : 'To‘lovni tasdiqlash'} loading={paying} onPress={pay} />
        {error ? <Button title="Amallar jurnalini ochish" variant="secondary" disabled={paying} onPress={() => navigation.navigate('Sync')} /> : null}
      </View>
    </BottomSheet>
  </Page>;
}
