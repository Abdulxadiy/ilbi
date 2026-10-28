import { useRef, useState } from 'react';
import { View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ChoiceField } from '../../components/ui/ChoiceField';
import { Notice } from '../../components/ui/Page';
import { useFormErrors } from '../../hooks/useFormErrors';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { useAuth } from '../auth/AuthContext';
import { hasPermission } from '../auth/permissions';
import { parseMoneyMinor } from '../../domain/money';
import { PendingOperationError } from '../../api/financialIdentity';
import { formatAmount } from '../reports/model';
import type { Customer } from '../customers/model';
import { acknowledgeAdjustment, fetchAdjustmentQuote, submitAdjustment, type AcceptedAdjustment } from './adjustments';
import { adjustmentPayload, type AdjustmentKind, type AdjustmentPayload, type AdjustmentQuote } from './adjustmentModel';

export function DebtAdjustmentSheet({ customer, kind, onClose, onDone }: { customer: Customer; kind: AdjustmentKind; onClose: () => void; onDone: () => void | Promise<void> }) {
  const { user, activeTenant } = useAuth(), navigation = useAppNavigation(), form = useFormErrors();
  const refund = kind === 'credit_refund';
  const [operation] = useState(() => `debt-adjustment:${customer.id}:${Crypto.randomUUID()}`);
  const initialCurrency = refund && parseMoneyMinor(customer.debt_balance_uzs, true) >= 0 ? 'USD' : 'UZS';
  const [currency, setCurrency] = useState<'UZS' | 'USD'>(initialCurrency), [amount, setAmount] = useState(refund ? String(Math.max(0, -parseMoneyMinor(initialCurrency === 'UZS' ? customer.debt_balance_uzs : customer.debt_balance_usd, true)) / 100) : '');
  const [channel, setChannel] = useState<'cash' | 'card' | 'none'>(refund ? 'cash' : 'none');
  const [branch, setBranch] = useState(String(activeTenant?.id || '')), [note, setNote] = useState(refund ? 'Mijozga ortiqcha haq qaytarildi' : '');
  const [quote, setQuote] = useState<AdjustmentQuote | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [locked, setLocked] = useState(false), [accepted, setAccepted] = useState(false), [needsReview, setNeedsReview] = useState(false);
  const processing = useRef(false), completed = useRef(false), frozen = useRef<AdjustmentPayload | null>(null), acceptedRecord = useRef<AcceptedAdjustment | null>(null);
  const branches = user?.tenants.filter(tenant => user.role === 'owner' && hasPermission(user, tenant, 'sales.correct_debt_payment')) || [];
  const edit = (field: string, change: () => void) => { if (processing.current || frozen.current || acceptedRecord.current) return; change(); setQuote(null); setError(''); form.clear(field); };
  const payload = () => adjustmentPayload({ kind, amount, currency, payment_type: channel, branch_id: Number(branch), note });
  const calculate = async () => {
    if (!user || !activeTenant || processing.current || frozen.current || completed.current) return;
    processing.current = true; setBusy(true); setError(''); form.clear(); setQuote(null);
    try { setQuote(await fetchAdjustmentQuote(customer.id, payload(), user, activeTenant)); }
    catch (failure: any) { form.capture(failure); setError(failure.message || 'Tuzatish hisobi olinmadi.'); }
    finally { processing.current = false; setBusy(false); }
  };
  const confirm = async () => {
    if (!user || !activeTenant || processing.current || completed.current) return;
    processing.current = true; setBusy(true); setError(''); form.clear();
    try {
      if (acceptedRecord.current) await acknowledgeAdjustment(acceptedRecord.current);
      else {
        if (!frozen.current && !quote) throw Error('Avval hisobni tekshiring.');
        const body = frozen.current || adjustmentPayload({ ...payload(), expected_quote: quote!.expected_quote });
        await submitAdjustment(operation, body, user, activeTenant,
          record => { acceptedRecord.current = record; setAccepted(true); },
          (pending, body) => { frozen.current = pending ? body : null; setLocked(pending); if (!pending) setQuote(null); });
      }
      completed.current = true;
      await onDone();
    } catch (failure: any) {
      form.capture(failure); setError(failure.message || 'Tuzatish natijasi tasdiqlanmadi.');
      if (failure instanceof PendingOperationError) setNeedsReview(true);
      if (!frozen.current && !acceptedRecord.current) setQuote(null);
    } finally { processing.current = false; setBusy(false); }
  };
  return <BottomSheet visible title={refund ? 'Mijoz haqqini qaytarish' : 'Qarz hisobini tuzatish'} scrollable onClose={() => { if (!processing.current) onClose(); }}>
    <View style={{ gap: 12 }}>
      <Notice>{customer.name} · {activeTenant?.name}</Notice>
      {accepted ? <Notice>Amal qabul qilindi. Telefondagi tasdiqni saqlashni yakunlang.</Notice> : <>
        <Notice>{refund ? 'Bu amal qaytarilgan haqni mijoz hisobida qayd qiladi.' : 'Musbat summa qarzni kamaytiradi; manfiy summa qarzni oshiradi. Faqat tanlangan valyuta o‘zgaradi.'}</Notice>
        <ChoiceField label="Tuzatish valyutasi" value={currency} disabled={busy || locked} onChange={value => edit('currency', () => { setCurrency(value); if (refund) setAmount(String(Math.max(0, -parseMoneyMinor(value === 'UZS' ? customer.debt_balance_uzs : customer.debt_balance_usd, true)) / 100)); })} options={[{ value: 'UZS', label: 'UZS' }, { value: 'USD', label: 'USD' }]} />
        <Input label={refund ? 'Qaytariladigan summa' : 'Tuzatish summasi'} value={amount} keyboardType={refund ? 'decimal-pad' : 'numbers-and-punctuation'} editable={!busy && !locked} error={form.errors.amount} onChangeText={value => edit('amount', () => setAmount(value))} />
        <ChoiceField label="Tuzatish to‘lov turi" value={channel} disabled={busy || locked} error={form.errors.payment_type} onChange={value => edit('payment_type', () => setChannel(value))} options={[{ value: 'cash', label: 'Naqd' }, { value: 'card', label: 'Karta' }, ...(!refund ? [{ value: 'none' as const, label: 'Kassaga ta’sirsiz' }] : [])]} />
        <ChoiceField label="Tuzatish do‘koni" value={branch} disabled={busy || locked} error={form.errors.branch_id} onChange={value => edit('branch_id', () => setBranch(value))} options={branches.map(row => ({ value: String(row.id), label: row.name }))} />
        <Input label="Tuzatish sababi" value={note} multiline maxLength={2000} editable={!busy && !locked} error={form.errors.note} onChangeText={value => edit('note', () => setNote(value))} />
        {quote && !locked && <View style={{ gap: 8 }}><Notice>Tekshirilgan hisob</Notice><Notice>Oldingi balans: {formatAmount(quote.balances.UZS)} UZS / {formatAmount(quote.balances.USD)} USD</Notice><Notice>Yangi balans: {formatAmount(quote.remaining.UZS)} UZS / {formatAmount(quote.remaining.USD)} USD</Notice>{refund ? <Notice>Qaytariladi: {formatAmount(quote.amount)} {quote.currency}</Notice> : <Notice>Tuzatish: {formatAmount(quote.amount)} {quote.currency}</Notice>}</View>}
      </>}
      {locked && !accepted && <Notice>Natija aniqlanmaguncha summa o‘zgarmaydi. Qayta tekshirish aynan shu amalni davom ettiradi.</Notice>}
      {error ? <Notice error>{error}</Notice> : null}
      <Button title={accepted ? 'Tasdiqni telefonga qayta saqlash' : locked ? 'Amal natijasini qayta tekshirish' : quote ? 'Tuzatishni tasdiqlash' : 'Tuzatishni hisoblash'} loading={busy} onPress={accepted || locked || quote ? confirm : calculate} />
      {(locked || needsReview) && <Button title="Amallar jurnalini ochish" variant="secondary" disabled={busy} onPress={() => { onClose(); navigation.navigate('Sync'); }} />}
    </View>
  </BottomSheet>;
}
