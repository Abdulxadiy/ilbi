import React, { useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import PriceInput from './PriceInput';
import { useAuth } from '../../hooks/useAuth';
import { useTenant } from '../../context/TenantContext';
import { getAuthenticationGeneration } from '../../api/client';
import { safeDisplayText } from '../../utils/safePresentation';
import { validationFields } from '../../utils/formValidation';
import { adjustmentAmount, adjustmentInput } from '../../utils/debtAdjustmentModel';
import { acknowledgeWebAdjustment, captureAdjustmentSession, fetchWebAdjustmentQuote, pendingWebAdjustment, submitWebAdjustment } from '../../utils/debtAdjustmentCommands';
import { PendingAdjustmentError } from '../../utils/debtAdjustmentJournal';

const credit = (customer, currency) => {
  const value = customer?.[currency === 'UZS' ? 'debt_balance_uzs' : 'debt_balance_usd'];
  return typeof value === 'string' && /^-\d+\.\d{2}$/.test(value) ? value.slice(1) : '0.00';
};
function RefundBody({ customer, user, tenant, onClose, onDone }) {
  const [session] = useState(() => captureAdjustmentSession(user, tenant));
  const initialCurrency = credit(customer, 'UZS') !== '0.00' ? 'UZS' : 'USD';
  const [values, setValues] = useState({ kind: 'credit_refund', amount: credit(customer, initialCurrency), currency: initialCurrency, payment_type: 'cash', branch_id: tenant.id, note: 'Mijozga ortiqcha to‘langan haq qaytarildi' });
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [locked, setLocked] = useState(false), [accepted, setAccepted] = useState(false), [done, setDone] = useState(false), [quote, setQuote] = useState(null), [error, setError] = useState(''), [fields, setFields] = useState({});
  const [customerId, setCustomerId] = useState(customer?.id || 0);
  const operation = useRef(crypto.randomUUID()), frozen = useRef(null), received = useRef(null), processing = useRef(false), completed = useRef(false), mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    (async () => {
      try {
        const pending = await pendingWebAdjustment(session);
        if (!mounted.current) return;
        if (pending) { operation.current = pending.operation; frozen.current = pending; setCustomerId(pending.customerId); setValues(pending.payload); setLocked(true); }
        else if (!customer?.id) setError('Kutayotgan qaytarish topilmadi. Ro‘yxatni yangilang.');
      } catch (failure) { if (mounted.current) setError(safeDisplayText(failure.message)); }
      finally { if (mounted.current) setLoading(false); }
    })();
    return () => { mounted.current = false; };
  }, [session, customer?.id]);
  const branches = user.tenants.filter(row => row.is_owner === true);
  const edit = (field, value) => {
    if (processing.current || frozen.current || received.current || completed.current) return;
    setValues(previous => ({ ...previous, [field]: value, ...(field === 'currency' ? { amount: credit(customer, value) } : {}) }));
    setQuote(null); setError(''); setFields(previous => ({ ...previous, [field]: '', ...(field === 'currency' ? { amount: '' } : {}) }));
  };
  const submit = async event => {
    event.preventDefault();
    if (loading || processing.current || completed.current || !customerId) return;
    processing.current = true; setBusy(true); setError(''); setFields({});
    try {
      if (received.current) {
        const result = await acknowledgeWebAdjustment(session, received.current.record, received.current.result);
        completed.current = true;
        if (mounted.current) { setDone(true); await onDone(result); }
      } else if (frozen.current || quote) {
        const body = frozen.current?.payload || adjustmentInput({ ...values, expected_quote: quote.expected_quote });
        const result = await submitWebAdjustment(session, operation.current, customerId, body,
          record => { frozen.current = record; if (mounted.current) { setLocked(Boolean(record)); if (!record) setQuote(null); } },
          (record, result) => { received.current = { record, result }; if (mounted.current) setAccepted(true); });
        completed.current = true;
        if (mounted.current) { setDone(true); await onDone(result); }
      } else {
        const result = await fetchWebAdjustmentQuote(session, customerId, values);
        if (mounted.current) setQuote(result);
      }
    } catch (failure) {
      if (!mounted.current) return;
      setError(safeDisplayText(failure.message)); setFields(failure.fields || validationFields(failure.data));
      if (failure instanceof PendingAdjustmentError && failure.record) {
        const record = failure.record; operation.current = record.operation; frozen.current = record;
        setCustomerId(record.customerId); setValues(record.payload); setLocked(true);
      }
      if (!frozen.current && !received.current) setQuote(null);
    } finally { processing.current = false; if (mounted.current) setBusy(false); }
  };
  const fieldError = name => fields[name] ? <small role="alert" style={{ color: 'var(--accent-rose)' }}>{safeDisplayText(fields[name])}</small> : null;
  const disabled = busy || loading || locked || accepted;
  const label = customerId === customer?.id ? customer.name : `Mijoz #${customerId}`;
  return <Modal isOpen title="Mijoz haqqini qaytarish" maxWidth={540} onClose={() => { if (!processing.current) onClose(); }}>
    <form noValidate onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ margin: 0 }}><strong>{label}</strong> · {tenant.name}</p>
      {loading ? <p role="status">Asl amallar jurnali tekshirilmoqda…</p> : null}
      {done ? <p role="status">Qaytarish serverda tasdiqlandi. Mijoz balansi serverdan yangilanadi.</p> : accepted ? <p>Server qaytarishni qabul qildi. Mahalliy tasdiqni saqlashni yakunlang.</p> : <>
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Faqat tanlangan valyutadagi haq qaytariladi. Avval hisobni tekshiring, keyin tasdiqlang.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          <label>Qaytariladigan summa<PriceInput aria-label="Qaytariladigan summa" data-api-field="amount" value={values.amount} disabled={disabled} aria-invalid={Boolean(fields.amount)} onChange={event => edit('amount', event.target.value)} style={fields.amount ? { borderColor: 'var(--accent-rose)' } : undefined} />{fieldError('amount')}</label>
          <label>Valyuta<select aria-label="Qaytarish valyutasi" className="input-field" data-api-field="currency" aria-invalid={Boolean(fields.currency)} style={fields.currency ? { borderColor: 'var(--accent-rose)' } : undefined} value={values.currency} disabled={disabled} onChange={event => edit('currency', event.target.value)}><option value="UZS">UZS</option><option value="USD">USD</option></select>{fieldError('currency')}</label>
          <label>Qaytarish usuli<select aria-label="Qaytarish usuli" className="input-field" data-api-field="payment_type" aria-invalid={Boolean(fields.payment_type)} style={fields.payment_type ? { borderColor: 'var(--accent-rose)' } : undefined} value={values.payment_type} disabled={disabled} onChange={event => edit('payment_type', event.target.value)}><option value="cash">Naqd</option><option value="card">Karta</option></select>{fieldError('payment_type')}</label>
          <label>Qaytaruvchi do‘kon<select aria-label="Qaytaruvchi do‘kon" className="input-field" data-api-field="branch_id" aria-invalid={Boolean(fields.branch_id)} style={fields.branch_id ? { borderColor: 'var(--accent-rose)' } : undefined} value={values.branch_id} disabled={disabled} onChange={event => edit('branch_id', Number(event.target.value))}>{branches.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>{fieldError('branch_id')}</label>
        </div>
        <label>Qaytarish sababi<input aria-label="Qaytarish sababi" className="input-field" data-api-field="note" maxLength={2000} value={values.note} disabled={disabled} aria-invalid={Boolean(fields.note)} onChange={event => edit('note', event.target.value)} style={fields.note ? { borderColor: 'var(--accent-rose)' } : undefined} />{fieldError('note')}</label>
        {quote && !locked && <div style={{ border: '1px solid var(--border-card)', borderRadius: 12, padding: 14, display: 'grid', gap: 8 }}>
          <strong>Tekshirilgan qaytarish hisobi</strong>
          <span>Oldingi balans: {adjustmentAmount(quote.balances.UZS)} UZS / {adjustmentAmount(quote.balances.USD)} USD</span>
          <span>Yangi balans: {adjustmentAmount(quote.remaining.UZS)} UZS / {adjustmentAmount(quote.remaining.USD)} USD</span>
          <span>Qaytariladi: {adjustmentAmount(quote.amount)} {quote.currency}</span>
        </div>}
      </>}
      {locked && !accepted && !done && <p>Natija aniqlanmaguncha asl summa va so‘rov saqlanadi. Qayta tekshirish aynan shu amalni davom ettiradi.</p>}
      {error ? <div role="alert" style={{ color: 'var(--accent-rose)' }}>{error}</div> : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10 }}>
        <button className="btn btn-secondary" type="button" disabled={busy} onClick={onClose}>Yopish</button>
        {!done && customerId > 0 && <button className="btn btn-success" type="submit" disabled={busy || loading}>{busy ? 'Tekshirilmoqda…' : accepted ? 'Tasdiqni qayta saqlash' : locked ? 'Asl qaytarish natijasini tekshirish' : quote ? 'Qaytarishni tasdiqlash' : 'Qaytarishni hisoblash'}</button>}
      </div>
    </form>
  </Modal>;
}

export default function CreditRefundModal({ state, onClose, onDone }) {
  const { user } = useAuth(), { activeTenant } = useTenant();
  if (!state || user?.role !== 'owner' || user.id !== state.actorId || activeTenant?.id !== state.tenantId || !activeTenant.is_owner || getAuthenticationGeneration() !== state.generation) return null;
  return <RefundBody key={[state.actorId, state.tenantId, state.generation].join(':')} customer={state.customer} user={user} tenant={activeTenant} onClose={onClose} onDone={onDone} />;
}
