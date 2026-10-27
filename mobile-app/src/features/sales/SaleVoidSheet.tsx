import { useRef, useState } from 'react';
import { View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Notice } from '../../components/ui/Page';
import { useFormErrors } from '../../hooks/useFormErrors';
import { useAuth } from '../auth/AuthContext';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { quantityMilli } from '../../domain/quantity';
import { formatAmount } from '../reports/model';
import type { SavedSale, SaleLine, VoidDraft } from './model';
import { acknowledgeVoid, submitVoid, type AcceptedVoid } from './void';
export type VoidTarget = { sale: SavedSale; line?: SaleLine };
export function SaleVoidSheet({ target, onClose, onDone }: { target: VoidTarget; onClose: () => void; onDone: () => Promise<void> }) {
  const { user, activeTenant } = useAuth(), navigation = useAppNavigation(), fields = useFormErrors();
  const available = target.line ? quantityMilli(target.line.quantity) - quantityMilli(target.line.voided_quantity, true) : null;
  const [quantity, setQuantity] = useState(available == null ? '' : `${available / 1000n}.${(available % 1000n).toString().padStart(3, '0')}`), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [accepted, setAccepted] = useState<AcceptedVoid | null>(null);
  const [draftId] = useState(() => Crypto.randomUUID()), [pending, setPending] = useState(false);
  const lock = useRef(false), completed = useRef(false), recordedDraft = useRef<VoidDraft | null>(null);
  const submit = async () => {
    if (lock.current || completed.current || !user || !activeTenant) return;
    lock.current = true; setBusy(true); setError(''); fields.clear();
    try {
      if (accepted) await acknowledgeVoid(accepted);
      else {
        const draft = recordedDraft.current || { draftId, saleId: target.sale.id, ...(target.line ? { itemId: target.line.id, quantity } : {}), reason };
        await submitVoid(draft, user, activeTenant, setAccepted, pending => { recordedDraft.current = pending ? draft : null; setPending(pending); });
      }
      completed.current = true;
      await onDone();
    } catch (failure: any) { fields.capture(failure); setError(failure.message || 'Qaytarish tasdiqlanmadi. Asl amal jurnalida saqlandi.'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <BottomSheet visible title={target.line ? 'Tovarni qisman qaytarish' : 'Savdoni to‘liq qaytarish'} scrollable onClose={() => { if (!busy) onClose(); }}>
    <View style={{ gap: 12 }}>
      <Notice>Chek #{target.sale.receipt_number} · {target.sale.counterparty_name || 'Umumiy mijoz'}</Notice>
      {accepted ? <Notice>Server qaytarishni qabul qildi. Endi faqat mahalliy tasdiq saqlanadi; yangi qaytarish yuborilmaydi.</Notice> : <>
        {pending ? <Notice>Asl qaytarish jurnalga saqlandi. Natija aniqlanmaguncha sabab va miqdor o‘zgartirilmaydi.</Notice> : null}
        <Notice>{target.line ? target.line.product_name : 'Savdodagi qolgan barcha tovarlar omborga qaytariladi.'}</Notice>
        <Notice>Qolgan savdo summasi: {formatAmount(target.sale.net_amount)} {target.sale.currency}. Yakuniy qaytarish summasini server hisoblaydi.</Notice>
        {target.line && <Input label="Qaytariladigan miqdor" value={quantity} keyboardType="decimal-pad" editable={!busy && !pending} error={fields.errors.quantity} onChangeText={value => { setQuantity(value); fields.clear('quantity'); }} suffix={target.line.unit} />}
        <Input label="Qaytarish sababi" value={reason} multiline maxLength={1000} editable={!busy && !pending} error={fields.errors.reason} onChangeText={value => { setReason(value); fields.clear('reason'); }} />
      </>}
      {error ? <Notice error>{error}</Notice> : null}
      <Button title={accepted ? 'Mahalliy tasdiqni saqlash' : pending ? 'Asl qaytarish natijasini tekshirish' : 'Qaytarishni tasdiqlash'} loading={busy} onPress={submit} />
      <Button title="Bekor qilish" variant="ghost" disabled={busy} onPress={onClose} />
      {error && <Button title="Asl amalni jurnaldan tekshirish" variant="secondary" disabled={busy} onPress={() => { onClose(); navigation.navigate('Sync'); }} />}
    </View>
  </BottomSheet>;
}
