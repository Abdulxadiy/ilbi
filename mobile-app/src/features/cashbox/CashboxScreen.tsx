import React, { useRef, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { request, assertAuthScope, captureAuthScope } from '../../api/client';
import { getServerScope } from '../../api/environment';
import { confirmFinancialIdentity, getFinancialIntent } from '../../api/financialIdentity';
import { formError } from '../../api/validation';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { useTheme } from '../../theme/ThemeContext';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { usePagedResource } from '../../hooks/usePagedResource';
import { useFormErrors } from '../../hooks/useFormErrors';
import { Page, Notice } from '../../components/ui/Page';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ListState } from '../../components/ui/ListState';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { isIsoDate } from '../../domain/date';
import { parseMoneyMinor } from '../../domain/money';
import { formatAmount, positiveId } from '../reports/model';
import { CashboxAcceptedButUnrecorded, submitCashbox } from './commands';
import { CashboxCategories } from './CashboxCategories';
import { amount, cashboxPermission, parseShift, type CashboxKind, type ShiftStatus } from './model';

const statusPath = '/cashbox/shift/current/?compact=true';
const titles: Record<CashboxKind, string> = { open: 'Smenani ochish', close: 'Smenani yopish', income: 'Kassaga kirim', expense: 'Kassadan xarajat' };
const money = (value: string) => {
  const minor = BigInt(parseMoneyMinor(value));
  return `${minor / 100n}.${(minor % 100n).toString().padStart(2, '0')}`;
};
const parseCapability = (value: any) => value?.cashbox_mutations === 1 && Array.isArray(value.idempotent_operations) && ['open', 'close', 'income', 'expense'].every(kind => value.idempotent_operations.includes(kind));
function parseEntry(value: any) {
  if (!['UZS', 'USD'].includes(value?.currency) || typeof value?.date !== 'string') throw Error('Kassa yozuvi tasdiqlanmadi.');
  return { ...value, id: positiveId(value.id), amount: amount(value.amount) };
}
export const CashboxScreen: React.FC = () => {
  const { user, activeTenant } = useAuth();
  return <CashboxBody key={[getServerScope(), user?.id, activeTenant?.id].join(':')} />;
};
function CashboxBody() {
  const navigation = useAppNavigation(), { can } = usePermissions(), { colors } = useTheme();
  const allowed = can('cashbox.view_cashbox');
  const shift = useScopedQuery(allowed ? statusPath : null, parseShift);
  const capability = useScopedQuery(allowed ? '/cashbox/capabilities/' : null, parseCapability);
  const [tab, setTab] = useState<'income' | 'expenses'>('income');
  const entries = usePagedResource(allowed ? '/cashbox/' + tab + '/' : null, parseEntry);
  const [draft, setDraft] = useState<{ id: string; kind: CashboxKind; shift: ShiftStatus } | null>(null);
  const [message, setMessage] = useState('');
  const open = (kind: CashboxKind) => { if (shift.data) { setMessage(''); setDraft({ id: Crypto.randomUUID(), kind, shift: shift.data }); } };
  const reload = () => { void shift.reload(); void entries.reload(); void capability.reload(); };
  return <Page title="Kassa va smena" onBack={navigation.goBack} scroll={false} insetBottom={false}>
    <FlatList data={entries.rows} keyExtractor={row => String(row.id)} contentContainerStyle={{ padding: 16, gap: 12 }} refreshing={shift.loading || entries.loading} onRefresh={reload}
      ListHeaderComponent={<View style={{ gap: 12, paddingBottom: 12 }}>
        {!allowed && <Notice error>Kassani ko‘rish uchun vakolat berilmagan.</Notice>}
        {allowed && <ListState loading={shift.loading} error={shift.error} onRetry={shift.reload} />}
        {shift.data && <>
          <Text style={{ color: colors.text, fontSize: 21, fontWeight: '700' }}>{shift.data.open ? 'Smena ochiq · #' + shift.data.id : 'Smena yopiq'}</Text>
          {shift.data.startedAt && <Notice>Boshlangan: {shift.data.startedAt}</Notice>}
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>Kutilgan naqd: {formatAmount(shift.data.values.expected_cash_uzs)} UZS / {formatAmount(shift.data.values.expected_cash_usd)} USD</Text>
          {[
            ['opening_cash', 'Boshlang‘ich naqd'], ['total_sale_cash', 'Naqd savdo'], ['total_sale_card', 'Karta savdosi'],
            ['total_sale_debt', 'Qarzga savdo'], ['collected_debt_cash', 'Qarzdan naqd tushum'], ['refund_cash', 'Naqd qaytarish'],
            ['total_extra_income', 'Qo‘shimcha kirim'], ['total_expenses', 'Xarajat'],
          ].map(([field, label]) => <Notice key={field}>{label}: {formatAmount(shift.data!.values[field + '_uzs'])} UZS / {formatAmount(shift.data!.values[field + '_usd'])} USD</Notice>)}
          {capability.data === true ? <View style={{ gap: 8 }}>
            {can('cashbox.manage_shift') && <Button title={titles[shift.data.open ? 'close' : 'open']} onPress={() => open(shift.data!.open ? 'close' : 'open')} />}
            {shift.data.open && (['income', 'expense'] as const).map(kind => can(cashboxPermission(kind)) && <Button key={kind} title={titles[kind]} variant="secondary" onPress={() => open(kind)} />)}
          </View> : <Notice>Server xavfsiz kassa amallarini tasdiqlamaguncha yozish tugmalari ochilmaydi.</Notice>}
          {capability.error && <ListState error={capability.error} onRetry={capability.reload} />}
        </>}
        {message && <Notice>{message}</Notice>}
        <Button title="Z-hisobotlarni ochish" variant="secondary" onPress={() => navigation.navigate('Reports')} disabled={!allowed} />
        <View style={{ flexDirection: 'row', gap: 8 }}><Button title="Kirimlar" variant={tab === 'income' ? 'primary' : 'secondary'} onPress={() => setTab('income')} /><Button title="Xarajatlar" variant={tab === 'expenses' ? 'primary' : 'secondary'} onPress={() => setTab('expenses')} /></View>
      </View>}
      ListEmptyComponent={allowed ? <ListState loading={entries.loading} error={entries.error} empty onRetry={entries.retry} emptyLabel="Kassa yozuvlari topilmadi." /> : undefined}
      ListFooterComponent={<>{entries.rows.length > 0 && entries.error && <ListState error={entries.error} onRetry={entries.retry} />}{entries.hasMore && <Button title="Yana kassa yozuvlari" variant="secondary" loading={entries.loadingMore} onPress={entries.loadMore} />}</>}
      renderItem={({ item }) => <View style={{ padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 5 }}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>{item.source || item.category}</Text><Text style={{ color: colors.text }}>{formatAmount(item.amount)} {item.currency}</Text><Notice>{item.date} · {item.recorded_by_name || '—'}</Notice>{item.note ? <Notice>{item.note}</Notice> : null}
      </View>} />
    {draft && <CashboxForm key={draft.id} draft={draft} onDismiss={() => setDraft(null)} onComplete={() => { setDraft(null); setMessage('Kassa amali serverda tasdiqlandi. Ma’lumotlar serverdan yangilanmoqda.'); reload(); }} />}
  </Page>;
}

function CashboxForm({ draft, onDismiss, onComplete }: { draft: { id: string; kind: CashboxKind; shift: ShiftStatus }; onDismiss: () => void; onComplete: () => void }) {
  const { user, activeTenant } = useAuth(), navigation = useAppNavigation(), fields = useFormErrors();
  const [live, setLive] = useState(draft.shift), [uzs, setUzs] = useState(draft.kind === 'open' ? draft.shift.values.suggested_opening_cash_uzs : ''), [usd, setUsd] = useState(draft.kind === 'open' ? draft.shift.values.suggested_opening_cash_usd : '');
  const [sum, setSum] = useState(''), [currency, setCurrency] = useState<'UZS' | 'USD'>('UZS'), [reason, setReason] = useState(''), [note, setNote] = useState('');
  // Cashbook dates use the same Asia/Tashkent business day as the backend.
  const [date, setDate] = useState(() => new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false), [locked, setLocked] = useState(false), [error, setError] = useState(''), [accepted, setAccepted] = useState<CashboxAcceptedButUnrecorded | null>(null);
  const submitting = useRef(false), done = useRef(false), frozen = useRef<object | null>(null);
  const operation = 'cashbox:' + draft.kind + ':' + draft.id;
  const submit = async () => {
    if (submitting.current || done.current || !user || !activeTenant) return;
    submitting.current = true; setBusy(true); setError(''); fields.clear();
    const scope = captureAuthScope(user.id, activeTenant.id);
    try {
      assertAuthScope(scope);
      if (accepted) {
        await confirmFinancialIdentity(operation, user.id, activeTenant.id, accepted.key, accepted.result);
        assertAuthScope(scope); done.current = true; onComplete(); return;
      }
      let payload = frozen.current;
      if (!payload) {
        const errors: Record<string, string> = {};
        if (draft.kind === 'open' || draft.kind === 'close') {
          try { money(uzs); } catch { errors.actual_cash_uzs = 'UZS summasini to‘g‘ri kiriting.'; }
          try { money(usd); } catch { errors.actual_cash_usd = 'USD summasini to‘g‘ri kiriting.'; }
        } else {
          try { if (parseMoneyMinor(sum) <= 0) throw Error(); } catch { errors.amount = 'Musbat summani to‘g‘ri kiriting.'; }
          if (!reason.trim()) errors.reason = 'Kirim manbasi yoki xarajat turini yozing.';
          if (!isIsoDate(date)) errors.date = 'Haqiqiy sana kiriting: YYYY-MM-DD.';
        }
        if (Object.keys(errors).length) throw formError(errors);
        const current = parseShift(await request(statusPath)); assertAuthScope(scope);
        if (current.id !== live.id || current.open !== live.open || draft.kind === 'open' && current.lastReportId !== live.lastReportId) throw Error('Smena o‘zgargan. Oynani yopib, kassa holatini yangilang.');
        if (draft.kind === 'close' && ['uzs', 'usd'].some(code => current.values['expected_cash_' + code] !== live.values['expected_cash_' + code])) {
          setLive(current); throw Error('Kassa yig‘indisi o‘zgardi. Yangilangan kutilgan naqdni solishtirib, yana tasdiqlang.');
        }
        payload = draft.kind === 'open' ? { opening_cash_uzs: money(uzs), opening_cash_usd: money(usd), expected_report_id: live.lastReportId }
          : draft.kind === 'close' ? { shift_id: live.id, expected_cash_uzs: live.values.expected_cash_uzs, expected_cash_usd: live.values.expected_cash_usd, actual_cash_uzs: money(uzs), actual_cash_usd: money(usd), discrepancy_reason: reason.trim(), staff_notes: note.trim() }
          : { amount: money(sum), currency, [draft.kind === 'income' ? 'source' : 'category']: reason.trim(), date, note: note.trim(), expected_shift_id: live.id };
        frozen.current = payload; setLocked(true);
      }
      await submitCashbox(operation, payload, user, activeTenant);
      assertAuthScope(scope); done.current = true; onComplete();
    } catch (failure: any) {
      try { assertAuthScope(scope); } catch { return; }
      if (failure instanceof CashboxAcceptedButUnrecorded) setAccepted(failure);
      else {
        try {
          const intent = await getFinancialIntent(operation, user.id, activeTenant.id);
          assertAuthScope(scope);
          if (!intent || intent.status === 'rejected') { frozen.current = null; setLocked(false); }
        } catch { /* Unknown local storage outcome retains the immutable draft. */ }
      }
      fields.capture(failure); setError(failure.message || 'Kassa amali tasdiqlanmadi.');
    } finally { submitting.current = false; setBusy(false); }
  };
  const disabled = busy || locked;
  return <BottomSheet visible title={titles[draft.kind]} scrollable onClose={() => { if (!busy) onDismiss(); }}><View style={{ gap: 12 }}>
    {accepted ? <Notice>Amal serverda saqlandi. Quyidagi tugma faqat qurilmadagi tasdiqni saqlaydi.</Notice> : <>
      {(draft.kind === 'open' || draft.kind === 'close') ? <>
        {draft.kind === 'close' && <Notice>Kutilgan naqd: {formatAmount(live.values.expected_cash_uzs)} UZS / {formatAmount(live.values.expected_cash_usd)} USD. Kassadagi pulni sanab kiriting.</Notice>}
        {(fields.errors.expected_cash_uzs || fields.errors.expected_cash_usd) && <Notice error>{fields.errors.expected_cash_uzs || fields.errors.expected_cash_usd}</Notice>}
        <Input label={draft.kind === 'open' ? 'Boshlang‘ich naqd UZS' : 'Sanalgan naqd UZS'} value={uzs} keyboardType="decimal-pad" editable={!disabled} error={fields.errors.actual_cash_uzs || fields.errors.opening_cash_uzs} onChangeText={value => { setUzs(value); fields.clear('actual_cash_uzs'); fields.clear('opening_cash_uzs'); }} />
        <Input label={draft.kind === 'open' ? 'Boshlang‘ich naqd USD' : 'Sanalgan naqd USD'} value={usd} keyboardType="decimal-pad" editable={!disabled} error={fields.errors.actual_cash_usd || fields.errors.opening_cash_usd} onChangeText={value => { setUsd(value); fields.clear('actual_cash_usd'); fields.clear('opening_cash_usd'); }} />
      </> : <>
        <Input label="Kassa summasi" value={sum} keyboardType="decimal-pad" editable={!disabled} error={fields.errors.amount} onChangeText={value => { setSum(value); fields.clear('amount'); }} />
        <View style={{ flexDirection: 'row', gap: 8 }}>{(['UZS', 'USD'] as const).map(code => <Button key={code} title={code} disabled={disabled} variant={currency === code ? 'primary' : 'secondary'} onPress={() => setCurrency(code)} />)}</View>
        <Input label="Kassa sanasi" placeholder="YYYY-MM-DD" value={date} maxLength={10} editable={!disabled} error={fields.errors.date} onChangeText={value => { setDate(value); fields.clear('date'); }} />
      </>}
      {draft.kind !== 'open' && <Input label={draft.kind === 'close' ? 'Tafovut sababi (agar bo‘lsa)' : draft.kind === 'income' ? 'Kirim manbasi' : 'Xarajat turi'} value={reason} editable={!disabled} maxLength={draft.kind === 'close' ? 2000 : 255} error={fields.errors.reason || fields.errors.source || fields.errors.category || fields.errors.discrepancy_reason} onChangeText={value => { setReason(value); ['reason', 'source', 'category', 'discrepancy_reason'].forEach(fields.clear); }} />}
      {(draft.kind === 'income' || draft.kind === 'expense') && user && activeTenant && <CashboxCategories kind={draft.kind} user={user.id} tenant={activeTenant.id} value={reason} disabled={disabled} onSelect={value => { setReason(value); fields.clear('reason'); fields.clear('source'); fields.clear('category'); }} />}
      {draft.kind !== 'open' && <Input label="Kassa eslatmasi" value={note} editable={!disabled} maxLength={2000} error={fields.errors.note || fields.errors.staff_notes} onChangeText={value => { setNote(value); fields.clear('note'); fields.clear('staff_notes'); }} />}
    </>}
    {locked && !accepted && <Notice>Amal yuborildi. Natija noma’lum bo‘lsa asl kalit va shu ma’lumotlar bilan tekshiriladi; yangi yozuv yaratilmaydi.</Notice>}
    {error && <Notice error>{error}</Notice>}
    <Button title={accepted ? 'Mahalliy tasdiqni saqlash' : locked ? 'Asl amalni tekshirish' : titles[draft.kind] + 'ni tasdiqlash'} loading={busy} onPress={submit} />
    {locked && <Button title="Amallar jurnalini ochish" variant="secondary" disabled={busy} onPress={() => { onDismiss(); navigation.navigate('Sync'); }} />}
  </View></BottomSheet>;
}
