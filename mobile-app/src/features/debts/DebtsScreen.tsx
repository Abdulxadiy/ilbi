import React, { useCallback, useRef, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { useTheme } from '../../theme/ThemeContext';
import { Page, Notice } from '../../components/ui/Page';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { ListState } from '../../components/ui/ListState';
import { ChoiceField } from '../../components/ui/ChoiceField';
import { usePagedResource, useDebounced } from '../../hooks/usePagedResource';
import { useFormErrors } from '../../hooks/useFormErrors';
import { getServerScope } from '../../api/environment';
import { formatAmount } from '../reports/model';
import { parseCustomer, type Customer } from '../customers/model';
import { acknowledgeDebt, debtPayload, submitDebt, type AcceptedDebt, type DebtPayload } from './commands';
import { fetchDebtQuote, type DebtQuote } from './quote';
import { hasPermission } from '../auth/permissions';
import { DebtAdjustmentSheet } from './DebtAdjustmentSheet';
import { dueOptions, dueStatus, validateDebtPage, type DebtBalance, type DebtDue } from './filters';

export const DebtsScreen: React.FC = () => {
  const { user, activeTenant } = useAuth();
  return <DebtsBody key={[getServerScope(), user?.id, activeTenant?.id].join(':')} />;
};
function DebtsBody() {
  const { user, activeTenant } = useAuth(), { can } = usePermissions(), { colors } = useTheme(), navigation = useAppNavigation();
  const allowed = can('sales.manage_counterparty') || can('sales.record_debt_payment');
  const [search, setSearch] = useState(''), query = useDebounced(search.trim());
  const [balance, setBalance] = useState<DebtBalance>('debtors'), [due, setDue] = useState<DebtDue>(''), [filtersOpen, setFiltersOpen] = useState(false);
  const validatePage = useCallback((value: unknown) => validateDebtPage(value, due), [due]);
  const debts = usePagedResource(allowed ? '/sales/counterparties/?' + new URLSearchParams({ balance_status: balance, search: query, ...(due ? { due_status: due } : {}) }).toString() : null, parseCustomer, undefined, validatePage);
  const [refunding, setRefunding] = useState<Customer | null>(null);
  const [selected, setSelected] = useState<Customer | null>(null), [amount, setAmount] = useState(''), [currency, setCurrency] = useState<'UZS' | 'USD'>('UZS'), [method, setMethod] = useState<'cash' | 'card'>('cash');
  const [paying, setPaying] = useState(false), [locked, setLocked] = useState(false), [draftId, setDraftId] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState(''), [accepted, setAccepted] = useState<AcceptedDebt | null>(null);
  const [quote, setQuote] = useState<DebtQuote | null>(null), [note, setNote] = useState(''), [branchId, setBranchId] = useState('');
  const submitting = useRef(false), completed = useRef(''), currentDialog = useRef(''), frozen = useRef<DebtPayload | null>(null), fields = useFormErrors();
  const acceptedRecord = useRef<AcceptedDebt | null>(null);
  const branches = user?.tenants.filter(tenant => hasPermission(user, tenant, 'sales.record_debt_payment')) || [];
  const invalidateQuote = (field?: string) => { setQuote(null); setError(''); fields.clear(field); };
  const edit = (update: () => void, field?: string) => { if (submitting.current || frozen.current) return; update(); invalidateQuote(field); };
  const open = (item: Customer) => { if (submitting.current) return; const id = Crypto.randomUUID(); currentDialog.current = id; setDraftId(id); frozen.current = null; acceptedRecord.current = null; setLocked(false); fields.clear(); setError(''); setMessage(''); setAccepted(null); setQuote(null); setNote(''); setBranchId(String(activeTenant?.id || '')); setSelected(item); const next = Number(item.debt_balance_uzs) > 0 ? 'UZS' : 'USD'; setCurrency(next); setAmount(next === 'UZS' ? item.debt_balance_uzs : item.debt_balance_usd); setMethod('cash'); };
  const rawPayload = () => debtPayload({ amount, currency, payment_type: method, branch_id: Number(branchId), note });
  const calculate = async () => {
    if (!selected || submitting.current || frozen.current || accepted || !user || !activeTenant || currentDialog.current !== draftId || completed.current === draftId) return;
    submitting.current = true; setPaying(true); fields.clear(); setError(''); setQuote(null);
    try {
      const result = await fetchDebtQuote(selected.id, rawPayload(), user, activeTenant);
      if (currentDialog.current === draftId) setQuote(result);
    } catch (failure: any) {
      if (currentDialog.current === draftId) { fields.capture(failure); setError(failure.message || 'To‘lov hisobi olinmadi.'); }
    } finally { submitting.current = false; setPaying(false); }
  };
  const pay = async () => {
    if (!selected || submitting.current || !user || !activeTenant || currentDialog.current !== draftId || completed.current === draftId) return;
    fields.clear(); setError('');
    submitting.current = true; setPaying(true);
    try {
      if (acceptedRecord.current) await acknowledgeDebt(acceptedRecord.current);
      else {
        if (!frozen.current && !quote) throw Error('Avval to‘lovni hisoblang va serverdagi natijani tekshiring.');
        const payload = frozen.current || debtPayload({ ...rawPayload(), expected_quote: quote!.expected_quote });
        await submitDebt('debt:' + selected.id + ':' + draftId, payload, user, activeTenant, record => { acceptedRecord.current = record; setAccepted(record); }, (pending, recorded) => {
          frozen.current = pending ? recorded || payload : null; setLocked(pending);
          if (!pending) setQuote(null);
        });
      }
      completed.current = draftId;
      if (currentDialog.current === draftId) { setSelected(null); acceptedRecord.current = null; setAccepted(null); setQuote(null); setMessage('To‘lov serverda tasdiqlandi. Qoldiq serverdan yangilandi.'); }
      await debts.reload();
    } catch (failure: any) {
      fields.capture(failure);
      setError(failure.message || 'To‘lov tasdiqlanmadi.');
      if (!frozen.current && !acceptedRecord.current) setQuote(null);
    } finally { submitting.current = false; setPaying(false); }
  };
  const header = <View style={{ gap: 12 }}>
      <Input label="Mijoz qidirish (ism, telefon, izoh)" value={search} onChangeText={setSearch} placeholder="Ism yoki telefon" />
      {debts.summary && <><Text style={{ color: colors.text, fontSize: 22, fontWeight: '700' }}>{formatAmount(debts.summary.total_debt_uzs)} UZS</Text><Notice>{formatAmount(debts.summary.total_debt_usd)} USD · Qarzdorlar: {debts.summary.debtors_count ?? '—'}</Notice></>}
      {debts.summary && <Notice>Mijoz haqqi: {formatAmount(debts.summary.total_credit_uzs)} UZS / {debts.summary.total_credit_usd == null ? '—' : formatAmount(debts.summary.total_credit_usd)} USD · Mijozlar: {debts.summary.credit_count ?? '—'}</Notice>}
      <Button title={filtersOpen ? 'Filtrlarni yopish' : 'Qarz filtrlarini ochish'} variant="ghost" onPress={() => setFiltersOpen(value => !value)} />
      {filtersOpen && <><ChoiceField label="Balans holati" value={balance} onChange={value => { setBalance(value); if (['credit', 'settled'].includes(value)) setDue(''); }} options={[{ value: 'debtors', label: 'Qarzdorlar' }, { value: 'all', label: 'Barchasi' }, { value: 'credit', label: 'Mijoz haqqi' }, { value: 'settled', label: 'Hisobi yopilgan' }]} />
        {['debtors', 'all'].includes(balance) && <><ChoiceField label="Qarz muddati filtri" value={due} onChange={setDue} options={dueOptions} /><Notice>Bugun — serverdagi Toshkent sanasi. 7 kun ichida — ertadan boshlab 7-kungacha.</Notice></>}
      </>}
      {due ? <Notice>Faol muddat: {dueOptions.find(row => row.value === due)?.label}</Notice> : null}
      {(due || balance !== 'debtors') && <Button title="Qarz filtrlarini tozalash" variant="secondary" onPress={() => { setBalance('debtors'); setDue(''); }} />}
      {message ? <Notice>{message}</Notice> : null}
      {!allowed && <Notice error>Qarzlarni ko‘rish uchun vakolat berilmagan.</Notice>}
    </View>;
  return <Page title="Qarzlar" onMenu={navigation.openDrawer} scroll={false} insetBottom={false}>
    <FlatList ListHeaderComponent={header} data={debts.rows} keyExtractor={item => String(item.id)} contentContainerStyle={{ padding: 16, gap: 12 }} refreshing={debts.loading} onRefresh={debts.reload}
      ListEmptyComponent={<ListState loading={debts.loading} error={debts.error} empty onRetry={debts.retry} emptyLabel={balance === 'debtors' ? 'Qarzdorlar topilmadi.' : 'Mijozlar topilmadi.'} />}
      ListFooterComponent={<>{debts.rows.length > 0 && debts.error && <ListState error={debts.error} onRetry={debts.retry} />}{debts.hasMore && <Button title={balance === 'debtors' ? 'Yana qarzdorlar' : 'Yana mijozlar'} variant="secondary" loading={debts.loadingMore} onPress={debts.loadMore} />}</>}
      renderItem={({ item }) => <View style={{ padding: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 14, gap: 8 }}>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{item.name}</Text>
        <Notice>{item.phone_number || 'Telefon ko‘rsatilmagan'}</Notice>
        <Text style={{ color: Number(item.debt_balance_uzs) > 0 || Number(item.debt_balance_usd) > 0 ? colors.danger : colors.text }}>{formatAmount(item.debt_balance_uzs)} UZS / {formatAmount(item.debt_balance_usd)} USD</Text>
        {item.debt_due_date ? <Notice>Qarz muddati: {item.debt_due_date}{(Number(item.debt_balance_uzs) > 0 || Number(item.debt_balance_usd) > 0) && debts.summary?.business_date ? ' · ' + dueOptions.find(row => row.value === dueStatus(item.debt_due_date, debts.summary.business_date))?.label : ''}</Notice> : null}
        {(Number(item.debt_balance_uzs) > 0 || Number(item.debt_balance_usd) > 0) && can('sales.record_debt_payment') && <Button title="To‘lov qabul qilish" variant="secondary" onPress={() => open(item)} />}
        {(Number(item.debt_balance_uzs) < 0 || Number(item.debt_balance_usd) < 0) && user?.role === 'owner' && can('sales.correct_debt_payment') && <Button title={item.name + ': mijoz haqqini qaytarish'} variant="secondary" onPress={() => setRefunding(item)} />}
        <Button title={item.name + ': ko‘chirma'} variant="ghost" onPress={() => navigation.navigate('Customer', { id: String(item.id) })} />
      </View>} />
    <BottomSheet visible={selected !== null} title={selected?.name || 'Qarz to‘lovi'} scrollable onClose={() => { if (!submitting.current && !paying) { currentDialog.current = ''; setSelected(null); } }}>
      <View style={{ gap: 12 }}>
        {accepted ? <Notice>Server to‘lovni qabul qildi. Mahalliy tasdiq saqlanishi kutilmoqda; yangi to‘lov yuborilmaydi.</Notice> : <>
          <View style={{ flexDirection: 'row', gap: 8 }}>{(['UZS', 'USD'] as const).map(value => <Button key={value} title={value} variant={currency === value ? 'primary' : 'secondary'} disabled={paying || locked} onPress={() => edit(() => { setCurrency(value); const balance = value === 'UZS' ? selected?.debt_balance_uzs : selected?.debt_balance_usd; setAmount(Number(balance) > 0 ? balance! : ''); }, 'amount')} />)}</View>
          <Input label="To‘lov summasi" value={amount} onChangeText={value => edit(() => setAmount(value), 'amount')} error={fields.errors.amount} keyboardType="decimal-pad" editable={!paying && !locked} />
          <View style={{ flexDirection: 'row', gap: 8 }}><Button title="Naqd" variant={method === 'cash' ? 'primary' : 'secondary'} disabled={paying || locked} onPress={() => edit(() => setMethod('cash'))} /><Button title="Karta" variant={method === 'card' ? 'primary' : 'secondary'} disabled={paying || locked} onPress={() => edit(() => setMethod('card'))} /></View>
          <ChoiceField label="To‘lov qabul qiluvchi do‘kon" value={branchId} options={branches.map(branch => ({ value: String(branch.id), label: branch.name }))} disabled={paying || locked} error={fields.errors.branch_id} onChange={value => edit(() => setBranchId(value), 'branch_id')} />
          <Input label="To‘lov izohi" value={note} multiline maxLength={2000} editable={!paying && !locked} error={fields.errors.note} onChangeText={value => edit(() => setNote(value), 'note')} />
          {quote && !locked && <View style={{ padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, gap: 8 }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>Serverdagi to‘lov hisobi</Text>
            <Notice>UZS qarziga: {formatAmount(quote.applied.UZS)} UZS</Notice>
            <Notice>USD qarziga: {formatAmount(quote.applied.USD)} USD</Notice>
            <Notice>Qoladigan qarz: {formatAmount(quote.remaining.UZS)} UZS / {formatAmount(quote.remaining.USD)} USD</Notice>
            {quote.exchange_rate ? <Notice>1 USD = {quote.exchange_rate} UZS · {quote.exchange_rate_source === 'cbu' ? 'CBU' : 'Do‘kon ichki kursi'}{quote.exchange_rate_date ? ' · ' + quote.exchange_rate_date : ''}</Notice> : null}
          </View>}
          {locked && <Notice>Natija asl kalit va asl summa bilan tekshiriladi. Yangi to‘lov yaratilmaydi.</Notice>}
        </>}
        {error ? <Notice error>{error}</Notice> : null}
        <Button title={accepted ? 'Mahalliy tasdiqni saqlash' : locked ? 'Asl to‘lov natijasini tekshirish' : quote ? 'To‘lovni tasdiqlash' : 'To‘lovni hisoblash'} loading={paying} onPress={accepted || locked || quote ? pay : calculate} />
        {error ? <Button title="Amallar jurnalini ochish" variant="secondary" disabled={paying} onPress={() => navigation.navigate('Sync')} /> : null}
      </View>
    </BottomSheet>
    {refunding && <DebtAdjustmentSheet key={refunding.id} customer={refunding} kind="credit_refund" onClose={() => setRefunding(null)} onDone={async () => { setRefunding(null); setMessage('Mijozga haq qaytarish tasdiqlandi.'); await debts.reload(); }} />}
  </Page>;
}
