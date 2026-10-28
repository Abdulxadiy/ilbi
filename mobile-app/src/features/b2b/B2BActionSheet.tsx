import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { Input } from '../../components/ui/Input';
import { ApiPicker, type PickValue } from '../../components/ui/ApiPicker';
import { Button } from '../../components/ui/Button';
import { Notice } from '../../components/ui/Page';
import { useFormErrors } from '../../hooks/useFormErrors';
import { useTheme } from '../../theme/ThemeContext';
import { useAuth } from '../auth/AuthContext';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { quantityMilli } from '../../domain/quantity';
import { formError } from '../../api/validation';
import { decimalQuantity, pendingQuantity, type B2BDraft, type B2BKind, type B2BSale } from './model';
import { acknowledgeB2B, submitB2B, type AcceptedB2B } from './commands';

const labels: Record<B2BKind, string> = { accept: 'Tovarlarni qabul qilish', reject: 'Rad etish va qaytarishni kutish', receive: 'Jismonan qaytgan tovarni qabul qilish', close_discrepancy: 'Qaytish tafovutini yopish' };
type RowDraft = { quantity: string; variant: PickValue | null; category: PickValue | null };
export function B2BActionSheet({ sale, kind, onClose, onDone }: { sale: B2BSale; kind: B2BKind; onClose: () => void; onDone: () => Promise<void> }) {
  const { user, activeTenant } = useAuth(), { colors } = useTheme(), navigation = useAppNavigation(), fields = useFormErrors();
  const available = sale.items.filter(line => kind === 'accept' ? pendingQuantity(line) > 0n : quantityMilli(line.b2b_return_pending_quantity, true) > 0n);
  const [rows, setRows] = useState<Record<number, RowDraft>>(() => Object.fromEntries(available.map(line => [line.id, { quantity: decimalQuantity(kind === 'accept' ? pendingQuantity(line) : quantityMilli(line.b2b_return_pending_quantity, true)), variant: null, category: null }])));
  const [reason, setReason] = useState(''), [draftId] = useState(() => Crypto.randomUUID()), [busy, setBusy] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState(''), [accepted, setAccepted] = useState<AcceptedB2B | null>(null);
  const recorded = useRef<B2BDraft | null>(null), lock = useRef(false), completed = useRef(false);
  const update = (id: number, next: Partial<RowDraft>, index: number) => { setRows(previous => ({ ...previous, [id]: { ...previous[id], ...next } })); fields.clear('items.' + index); fields.clear('items'); };
  const draft = (): B2BDraft => {
    const errors: Record<string, string> = {}, items: NonNullable<B2BDraft['items']> = [];
    if (kind !== 'reject') available.forEach((line, index) => {
      const row = rows[line.id], field = kind === 'accept' ? 'accepted_quantity' : 'quantity';
      let milli = 0n;
      try { milli = quantityMilli(row.quantity, true); const max = kind === 'accept' ? pendingQuantity(line) : quantityMilli(line.b2b_return_pending_quantity, true); if (milli > max) throw Error(); }
      catch { errors[`items.${index}.${field}`] = 'Miqdor mavjud qoldiqdan oshmasin; 3 kasr xonasigacha kiriting.'; }
      if (kind === 'accept' && milli > 0n && quantityMilli(line.b2b_accepted_quantity, true) === 0n && !row.variant && !row.category) errors[`items.${index}.target_variant_id`] = 'Mavjud tovar yoki yangi tovar uchun kategoriya tanlang.';
      if (milli > 0n) items.push({ sale_item_id: line.id, [field]: decimalQuantity(milli), ...(row.variant ? { target_variant_id: row.variant.id } : row.category ? { target_category_id: row.category.id } : {}) });
    });
    if (Object.keys(errors).length) throw formError(errors);
    return { sale_id: sale.id, kind, draftId, ...(kind === 'reject' ? {} : { items }), ...(kind === 'accept' ? {} : { reason }) };
  };
  const submit = async () => {
    if (lock.current || completed.current || !user || !activeTenant) return;
    lock.current = true; setBusy(true); setError(''); fields.clear();
    try {
      if (accepted) await acknowledgeB2B(accepted);
      else {
        const original = recorded.current || draft();
        await submitB2B(original, user, activeTenant, setAccepted, value => { recorded.current = value ? original : null; setPending(value); });
      }
      completed.current = true; await onDone();
    } catch (failure: any) { fields.capture(failure); setError(failure.message || 'B2B amali tasdiqlanmadi.'); }
    finally { lock.current = false; setBusy(false); }
  };
  const disabled = busy || pending;
  return <BottomSheet visible title={labels[kind]} scrollable onClose={() => { if (!busy) onClose(); }}>
    <View style={{ gap: 12 }}>
      <Notice>Hujjat #{sale.receipt_number} · {sale.currency}</Notice>
      {accepted ? <Notice>Server amalni qabul qildi. Faqat mahalliy tasdiq qayta saqlanadi; yangi amal yuborilmaydi.</Notice> : <>
        {pending ? <Notice>Asl amal jurnalga saqlandi. Natija aniqlanmaguncha ma’lumotlar o‘zgartirilmaydi.</Notice> : null}
        {kind === 'reject' && <Notice>Rad etish jo‘natuvchi omboriga tovarni avtomatik qaytarmaydi. Jo‘natuvchi jismonan kelgan tovarni alohida tasdiqlaydi.</Notice>}
        {kind === 'close_discrepancy' && <Notice>Bu miqdor jismonan qaytmagan deb yopiladi. Omborga kirim qilinmaydi; server tegishli moliyaviy tuzatishni hisoblaydi.</Notice>}
        {kind !== 'reject' && available.map((line, index) => <View key={line.id} style={{ gap: 10, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12 }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>{line.product_name} · {line.product_variant_name}</Text>
          <Input label={'Miqdor: ' + line.product_name} value={rows[line.id].quantity} keyboardType="decimal-pad" suffix={line.unit} editable={!disabled} error={fields.errors[`items.${index}.${kind === 'accept' ? 'accepted_quantity' : 'quantity'}`]} onChangeText={value => update(line.id, { quantity: value }, index)} />
          {kind === 'accept' && quantityMilli(line.b2b_accepted_quantity, true) === 0n ? <>
            <ApiPicker label={'Mavjud tovar: ' + line.product_name} endpoint={'/sales/b2b/mapping/variants/?currency=' + sale.currency + '&unit=' + encodeURIComponent(line.unit)} value={rows[line.id].variant} disabled={disabled} optional error={fields.errors[`items.${index}.target_variant_id`]} onChange={value => update(line.id, { variant: value, category: null }, index)} />
            <ApiPicker label={'Yangi tovar kategoriyasi: ' + line.product_name} endpoint={'/sales/b2b/mapping/categories/?currency=' + sale.currency} value={rows[line.id].category} disabled={disabled} optional error={fields.errors[`items.${index}.target_category_id`]} onChange={value => update(line.id, { category: value, variant: null }, index)} />
            <Notice>Mavjud tovar tanlansa o‘sha variantga qo‘shiladi. Kategoriya tanlansa jo‘natilgan tovar nomi va birligi bilan yangi variant yaratiladi.</Notice>
          </> : kind === 'accept' ? <Notice>Avval qabul qilingan tovarning saqlangan varianti ishlatiladi.</Notice> : null}
        </View>)}
        {fields.errors.items ? <Notice error>{fields.errors.items}</Notice> : null}
        {kind !== 'accept' && <Input label="Amal sababi" value={reason} multiline editable={!disabled} maxLength={1000} error={fields.errors.reason} onChangeText={value => { setReason(value); fields.clear('reason'); }} />}
      </>}
      {error ? <Notice error>{error}</Notice> : null}
      <Button title={accepted ? 'Mahalliy tasdiqni saqlash' : pending ? 'Asl B2B natijasini tekshirish' : 'Amalni tasdiqlash'} loading={busy} onPress={submit} />
      <Button title="Yopish" variant="ghost" disabled={busy} onPress={onClose} />
      {error && <Button title="Amallar jurnalini ochish" variant="secondary" disabled={busy} onPress={() => { onClose(); navigation.navigate('Sync'); }} />}
    </View>
  </BottomSheet>;
}
