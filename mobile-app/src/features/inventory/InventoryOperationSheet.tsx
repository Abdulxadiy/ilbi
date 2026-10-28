import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { captureAuthScope, assertAuthScope } from '../../api/client';
import { getFinancialIntent } from '../../api/financialIdentity';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ApiPicker, type PickValue } from '../../components/ui/ApiPicker';
import { ChoiceField } from '../../components/ui/ChoiceField';
import { Notice } from '../../components/ui/Page';
import { useFormErrors } from '../../hooks/useFormErrors';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { formError } from '../../api/validation';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { inventoryDraft, saveInventoryDraft, clearInventoryDraft, type InventoryDraft } from './drafts';
import { executeInventory, confirmAcceptedInventory, InventoryAcknowledgementError, inventoryCommand, type InventoryAction, type AcceptedInventory, inventoryDecimal } from './commands';
import { InventoryBatchPicker } from './InventoryBatchPicker';

export const inventoryLabels: Record<InventoryAction, string> = {
  intake: 'Tovar kirimi', 'batch-intake': 'Tezkor ko‘p qatorli kirim', adjust: 'Qoldiqni tuzatish',
  'customer-return': 'Mijozdan qaytish', 'supplier-return': 'Yetkazib beruvchiga qaytarish', 'write-off': 'Hisobdan chiqarish',
  dispatch: 'Do‘konga jo‘natish', receive: 'Transferni qabul qilish', return: 'Transferni jismonan qaytarish', 'close-discrepancy': 'Tafovutni yopish',
};
const emptyLine = () => ({ product_variant_id: null, source_variant_id: null, quantity: '', cost_price: '', supplier: '', batch_code: '', expires_on: '', note: '' });
const optionsParser = (value: any) => {
  if (!value || !Array.isArray(value.categories) || !Array.isArray(value.targets)) throw Error('Transfer tanlovlari tasdiqlanmadi.');
  for (const item of [...value.categories, ...value.targets]) if (!Number.isSafeInteger(item.id) || item.id < 1 || typeof item.name !== 'string') throw Error('Transfer tanlovi noto‘g‘ri.');
  return value as { categories: { id: number; name: string }[]; targets: { id: number; name: string; categories: { id: number; name: string }[] }[] };
};
function initialBody(kind: InventoryAction, source: any) {
  const item = { ...emptyLine(), product_variant_id: source?.product_variant || null, name: source?.product_name || '' };
  if (kind === 'batch-intake' || kind === 'dispatch') return { items: [item], supplier: '', faktura_number: '', note: '', destination_tenant_id: null };
  if (kind === 'receive') return { items: source.items.map((line: any) => ({ item_id: line.id, received_quantity: line.quantity_sent, destination_variant_id: line.destination_variant || null, destination_category_id: line.destination_category || null, discrepancy_reason: '', name: line.source_product_name + ' · ' + line.source_variant_name, quantity_sent: line.quantity_sent })), transfer_kind: source.kind };
  if (kind === 'return') return { items: source.items.map((line: any) => ({ original_item_id: line.id, quantity: '0', name: line.source_product_name + ' · ' + line.source_variant_name, quantity_received: line.quantity_received, quantity_returned: line.quantity_returned, quantity_return_in_transit: line.quantity_return_in_transit })), note: '' };
  if (kind === 'close-discrepancy') return { reason: '' };
  return { ...item, direction: 'out', batch_id: null };
}

/** Draft and journal must both persist before a stock-changing POST. Closing never discards uncertain work. */
export function InventoryOperationSheet({ kind, source, onClose, onSaved }: { kind: InventoryAction; source?: any; onClose: () => void; onSaved: () => void }) {
  const { user, activeTenant } = useAuth(), { colors } = useTheme();
  const target = ['receive', 'return', 'close-discrepancy'].includes(kind) ? source?.id : null;
  const [draft, setDraft] = useState<InventoryDraft | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [frozen, setFrozen] = useState(false);
  const [accepted, setAccepted] = useState<AcceptedInventory | null>(null), [done, setDone] = useState(false);
  const gate = useRef(false), mounted = useRef(true), form = useFormErrors();
  const choices = useScopedQuery(['dispatch', 'receive'].includes(kind) ? '/inventory/operations/transfer-options/' : null, optionsParser);
  useEffect(() => {
    mounted.current = true; let active = true;
    if (user && activeTenant) {
      const scope = captureAuthScope();
      void inventoryDraft(kind, target, user.id, activeTenant.id, initialBody(kind, source)).then(async value => {
        assertAuthScope(scope);
        const old = await getFinancialIntent(`inventory:${kind}:${target || 'new'}:${value.id}`, user.id, activeTenant.id); assertAuthScope(scope);
        if (active) { setDraft(value); setFrozen(old?.status === 'pending'); setDone(old?.status === 'confirmed'); }
      }).catch(failure => { if (active) setError(failure.message); });
    }
    return () => { active = false; mounted.current = false; };
  }, [activeTenant, kind, source, target, user]);
  const locked = busy || frozen || Boolean(accepted) || done;
  const body = draft?.body || {};
  const edit = (patch: Record<string, any>, field?: string) => {
    if (locked || !draft) return;
    const next = { ...draft, body: { ...draft.body, ...patch } }, scope = captureAuthScope();
    form.clear(field); setError(''); setDraft(next);
    void saveInventoryDraft(next).catch(failure => {
      try { assertAuthScope(scope); if (mounted.current) setError(failure.message); } catch { /* Account changed. */ }
    });
  };
  const editRow = (index: number, patch: Record<string, any>, field: string) => edit({ items: body.items.map((row: any, i: number) => i === index ? { ...row, ...patch } : row) }, `items.${index}.${field}`);
  const finish = async (value: InventoryDraft) => {
    if (mounted.current) { setDone(true); setFrozen(true); setAccepted(null); }
    await clearInventoryDraft(value);
    if (mounted.current) { onSaved(); onClose(); }
  };
  const submit = async () => {
    if (gate.current || !draft || !user || !activeTenant) return;
    gate.current = true; setBusy(true); setError(''); form.clear();
    const scope = captureAuthScope();
    try {
      if (done) { await finish(draft); return; }
      if (accepted) { await confirmAcceptedInventory(accepted); await finish(draft); return; }
      let raw = body;
      if (kind === 'return') {
        const normalized = body.items.map((row: any, index: number) => {
          const quantity = inventoryDecimal(row.quantity, 3, true, `items.${index}.quantity`);
          const units = (value: unknown) => BigInt(inventoryDecimal(value, 3, true).replace('.', ''));
          const available = units(row.quantity_received) - units(row.quantity_returned) - units(row.quantity_return_in_transit);
          if (units(quantity) > available) throw formError({ [`items.${index}.quantity`]: 'Qaytarish miqdori qabul qilingan mavjud qoldiqdan oshmasin.' });
          return { ...row, quantity };
        });
        raw = { ...body, items: normalized.filter((row: any) => row.quantity !== '0.000') };
      }
      if (kind === 'receive') {
        body.items.forEach((row: any, index: number) => {
          const received = inventoryDecimal(row.received_quantity, 3, true, `items.${index}.received_quantity`);
          const sent = inventoryDecimal(row.quantity_sent);
          if (BigInt(received.replace('.', '')) > BigInt(sent.replace('.', ''))) throw formError({ [`items.${index}.received_quantity`]: 'Qabul miqdori jo‘natilganidan oshmasin.' });
          if (received !== sent && !String(row.discrepancy_reason).trim()) throw formError({ [`items.${index}.discrepancy_reason`]: 'Tafovut sababini kiriting.' });
        });
      }
      const command = inventoryCommand(kind, raw, target);
      await saveInventoryDraft(draft); assertAuthScope(scope);
      await executeInventory(command, draft.id, user, activeTenant); assertAuthScope(scope);
      await finish(draft);
    } catch (failure: any) {
      try {
        assertAuthScope(scope);
        if (!mounted.current) return;
        if (failure instanceof InventoryAcknowledgementError) { setAccepted(failure.accepted); setFrozen(true); }
        else {
          form.capture(failure);
          const old = await getFinancialIntent(`inventory:${kind}:${target || 'new'}:${draft.id}`, user.id, activeTenant.id); assertAuthScope(scope);
          if (mounted.current) setFrozen(old?.status === 'pending');
        }
        if (mounted.current) setError(failure.message || 'Ombor amali bajarilmadi.');
      } catch { /* A switched account must never receive a previous account's completion. */ }
    } finally { gate.current = false; if (mounted.current) setBusy(false); }
  };
  const close = async () => {
    if (gate.current) return;
    gate.current = true;
    try { if (draft && !done) await saveInventoryDraft(draft); onClose(); }
    catch (failure: any) { setError(failure.message); }
    finally { gate.current = false; }
  };
  const field = (label: string, name: string, keyboardType: 'default' | 'decimal-pad' = 'default') => <Input key={name} label={label} value={String(body[name] ?? '')} editable={!locked} keyboardType={keyboardType} error={form.errors[name]} onChangeText={value => edit({ [name]: value }, name)} />;
  const product = (row: any, index?: number) => {
    const name = kind === 'dispatch' ? 'source_variant_id' : 'product_variant_id', prefix = index == null ? '' : `items.${index}.`;
    return <ApiPicker label={index == null ? 'Tovar varianti' : `Tovar ${index + 1}`} endpoint="/catalog/variants/" disabled={locked} value={row[name] ? { id: row[name], name: row.name || '#' + row[name] } as PickValue : null} error={form.errors[prefix + name]} onChange={value => index == null ? edit({ [name]: value?.id || null, batch_id: null, name: value?.product_name ? value.product_name + ' · ' + value.name : value?.name || '' }, name) : editRow(index, { [name]: value?.id || null, name: value?.product_name ? value.product_name + ' · ' + value.name : value?.name || '' }, name)} />;
  };
  const category = (index: number, values: { id: number; name: string }[]) => <ChoiceField label={`Qator ${index + 1}: manzil kategoriyasi`} value={String(body.items[index].destination_category_id || '')} disabled={locked} error={form.errors[`items.${index}.destination_category_id`]} options={[{ value: '', label: 'Avtomatik moslash' }, ...values.map(value => ({ value: String(value.id), label: value.name }))]} onChange={value => editRow(index, { destination_category_id: value ? Number(value) : null }, 'destination_category_id')} />;
  return <BottomSheet visible title={inventoryLabels[kind]} onClose={() => { void close(); }} scrollable>
    <View style={{ gap: 14 }}>
      <Notice>Qoralama ushbu hisob va do‘kon uchun saqlanadi. Natija noma’lum bo‘lsa asl amalni qayta tekshiring; yangi qator ochib takrorlamang.</Notice>
      {error ? <Notice error>{error}</Notice> : null}
      {frozen && !accepted && !done ? <Notice error>Asl so‘rovning natijasi tekshirilishi kerak. Maydonlar saqlanadi; yangi amal yaratmay, quyidagi tugma orqali davom eting. «Sinxronlash» oynasida ham tekshirishingiz mumkin.</Notice> : null}
      {choices.error ? <><Notice error>{choices.error.message}</Notice><Button title="Transfer tanlovlarini qayta yuklash" variant="secondary" onPress={() => { void choices.reload(); }} /></> : null}
      {draft && !done && <>
        {kind === 'dispatch' && <ChoiceField label="Manzil do‘kon" value={String(body.destination_tenant_id || '')} disabled={locked} error={form.errors.destination_tenant_id} options={(choices.data?.targets || []).map(item => ({ value: String(item.id), label: item.name }))} onChange={value => edit({ destination_tenant_id: Number(value), items: body.items.map((row: any) => ({ ...row, destination_category_id: null })) }, 'destination_tenant_id')} />}
        {['batch-intake', 'dispatch'].includes(kind) && <>
          {body.items.map((row: any, index: number) => <View key={index} style={{ gap: 10, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12 }}>
            {product(row, index)}
            <Input label={`Qator ${index + 1}: miqdor`} value={row.quantity} editable={!locked} keyboardType="decimal-pad" error={form.errors[`items.${index}.quantity`]} onChangeText={value => editRow(index, { quantity: value }, 'quantity')} />
            {kind === 'batch-intake' ? <>
              <Input label={`Qator ${index + 1}: tannarx`} value={row.cost_price} editable={!locked} keyboardType="decimal-pad" error={form.errors[`items.${index}.cost_price`]} onChangeText={value => editRow(index, { cost_price: value }, 'cost_price')} />
              <Input label={`Qator ${index + 1}: partiya kodi`} value={row.batch_code} editable={!locked} error={form.errors[`items.${index}.batch_code`]} onChangeText={value => editRow(index, { batch_code: value }, 'batch_code')} />
              <Input label={`Qator ${index + 1}: yaroqlilik (YYYY-MM-DD)`} value={row.expires_on} editable={!locked} error={form.errors[`items.${index}.expires_on`]} onChangeText={value => editRow(index, { expires_on: value }, 'expires_on')} />
            </> : category(index, choices.data?.targets.find(item => item.id === body.destination_tenant_id)?.categories || [])}
            {body.items.length > 1 && <Button title={`Qator ${index + 1}ni olib tashlash`} variant="ghost" disabled={locked} onPress={() => edit({ items: body.items.filter((_: any, i: number) => i !== index) }, 'items')} />}
          </View>)}
          {body.items.length < 100 && <Button title="Yana tovar qatori" variant="secondary" disabled={locked} onPress={() => edit({ items: [...body.items, emptyLine()] }, 'items')} />}
          {kind === 'batch-intake' && <>{field('Yetkazib beruvchi', 'supplier')}{field('Faktura raqami', 'faktura_number')}</>}
          {field('Izoh', 'note')}
        </>}
        {['intake', 'adjust', 'customer-return', 'supplier-return', 'write-off'].includes(kind) && <>
          {product(body)}{field('Miqdor', 'quantity', 'decimal-pad')}
          {kind !== 'intake' && <InventoryBatchPicker variantId={body.product_variant_id} value={body.batch_id || null} disabled={locked} error={form.errors.batch_id} onChange={value => edit({ batch_id: value }, 'batch_id')} />}
          {kind === 'intake' && <>{field('Tannarx', 'cost_price', 'decimal-pad')}{field('Yetkazib beruvchi', 'supplier')}{field('Partiya kodi', 'batch_code')}{field('Yaroqlilik (YYYY-MM-DD)', 'expires_on')}</>}
          {kind === 'adjust' && <ChoiceField label="Yo‘nalish" value={body.direction} options={[{ value: 'in', label: 'Kirim' }, { value: 'out', label: 'Chiqim' }]} disabled={locked} error={form.errors.direction} onChange={value => edit({ direction: value }, 'direction')} />}
          {field(kind === 'intake' ? 'Izoh' : 'Amal sababi', 'note')}
        </>}
        {['receive', 'return'].includes(kind) && body.items.map((row: any, index: number) => <View key={row.item_id || row.original_item_id} style={{ gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.border }}>
          <Text style={{ color: colors.text, fontWeight: '600' }}>{row.name}</Text>
          {kind === 'receive' ? <>
            <Notice>Jo‘natilgan: {row.quantity_sent}</Notice>
            <Input label={`Qator ${index + 1}: qabul miqdori`} value={row.received_quantity} editable={!locked} keyboardType="decimal-pad" error={form.errors[`items.${index}.received_quantity`]} onChangeText={value => editRow(index, { received_quantity: value }, 'received_quantity')} />
            {body.transfer_kind !== 'return' && <ApiPicker label={`Qator ${index + 1}: manzil varianti`} endpoint="/catalog/variants/" optional disabled={locked} value={row.destination_variant_id ? { id: row.destination_variant_id, name: row.destination_name || '#' + row.destination_variant_id } : null} error={form.errors[`items.${index}.destination_variant_id`]} onChange={value => editRow(index, { destination_variant_id: value?.id || null, destination_name: value?.name || '' }, 'destination_variant_id')} />}
            {body.transfer_kind !== 'return' && category(index, choices.data?.categories || [])}
            <Input label={`Qator ${index + 1}: tafovut sababi`} value={row.discrepancy_reason} editable={!locked} error={form.errors[`items.${index}.discrepancy_reason`]} onChangeText={value => editRow(index, { discrepancy_reason: value }, 'discrepancy_reason')} />
          </> : <>
            <Notice>Qabul: {row.quantity_received} · qaytarilgan: {row.quantity_returned} · yo‘lda: {row.quantity_return_in_transit}</Notice>
            <Input label={`Qator ${index + 1}: qaytarish miqdori (0 = qaytarmaslik)`} value={row.quantity} editable={!locked} keyboardType="decimal-pad" error={form.errors[`items.${index}.quantity`]} onChangeText={value => editRow(index, { quantity: value }, 'quantity')} />
          </>}
        </View>)}
        {kind === 'return' && field('Qaytarish sababi', 'note')}
        {kind === 'close-discrepancy' && <><Notice error>Tafovutni yopish tovarni ortga ko‘chirmaydi. Jismoniy qaytarish uchun alohida «Transferni jismonan qaytarish» amali bor.</Notice>{field('Tafovutni yopish sababi', 'reason')}</>}
        {form.errors.items ? <Notice error>{form.errors.items}</Notice> : null}
      </>}
      {done ? <Notice>Server amali tasdiqlandi. Qoralamani tozalashni yakunlang.</Notice> : null}
      <Button title={done ? 'Tasdiqlangan qoralamani yopish' : accepted ? 'Telefondagi tasdiqni yakunlash' : frozen ? 'Asl amal natijasini tekshirish' : 'Tasdiqlash va saqlash'} loading={busy} disabled={!draft || (['dispatch', 'receive'].includes(kind) && !choices.data && !accepted && !done)} onPress={() => { void submit(); }} />
    </View>
  </BottomSheet>;
}
