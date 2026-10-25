import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Linking from 'expo-linking';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { Button } from '../../components/ui/Button';
import { Loading, Notice } from '../../components/ui/Page';

/** Resolves one exact code; the user explicitly chooses a result before adding it to the cart. */
export function BarcodeScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [focused, setFocused] = useState(false), [foreground, setForeground] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const locked = useRef(false), foregroundNow = useRef(foreground), focusedNow = useRef(false), asking = useRef(false);
  useFocusEffect(useCallback(() => { focusedNow.current = true; locked.current = false; setFocused(true); return () => { focusedNow.current = false; locked.current = true; setFocused(false); }; }, []));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      foregroundNow.current = state === 'active';
      setForeground(state === 'active');
      if (state === 'active') void getPermission().catch(() => setError('Kamera ruxsatini tekshirib bo‘lmadi.'));
    });
    return () => subscription.remove();
  }, [getPermission]);
  const ask = async () => {
    if (asking.current) return;
    asking.current = true; setBusy(true); setError('');
    try { await requestPermission(); } catch { setError('Kamera ruxsatini olishda xato. Kodni qo‘lda kiritishingiz mumkin.'); }
    finally { asking.current = false; setBusy(false); }
  };
  const scanned = ({ data }: BarcodeScanningResult) => {
    if (locked.current || !focusedNow.current || !foregroundNow.current) return;
    if (typeof data !== 'string' || !data.trim() || data.trim().length > 64 || /[\x00-\x1f\x7f]/.test(data)) { setError('Kod o‘qilmadi. Qayta skanerlang yoki qo‘lda kiriting.'); return; }
    locked.current = true; onCode(data.trim()); onClose();
  };
  return <BottomSheet visible={focused} title="Shtrix-kodni skanerlash" onClose={onClose}>
    <Notice>Kodni kamera markazida ushlang. Natijani tekshirgandan keyin tovarni savatga qo‘shasiz.</Notice>
    {!permission ? <Loading /> : !permission.granted ? <>
      <Notice>Kamera uchun ruxsat kerak. Ruxsat bermasangiz ham kodni qo‘lda qidirishingiz mumkin.</Notice>
      {permission.canAskAgain ? <Button title="Kameraga ruxsat berish" loading={busy} onPress={() => { void ask(); }} /> : <Button title="Kamera ruxsatini sozlamalarda ochish" onPress={() => { void Linking.openSettings().catch(() => setError('Sozlamalar ochilmadi. Qurilma sozlamalaridan kamera ruxsatini yoqing.')); }} />}
    </> : !foreground ? <Notice>Ilovaga qaytganingizda kamera qayta ishga tushadi.</Notice> : focused && !error ? <View style={{ height: 290, width: '100%', borderRadius: 12, overflow: 'hidden', marginVertical: 12 }}>
      <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'itf14', 'codabar'] }} onBarcodeScanned={scanned} onMountError={failure => setError(failure.message || 'Kamera ochilmadi.')} />
    </View> : null}
    {error ? <><Notice error>{error}</Notice><Button title="Kamerani qayta tekshirish" variant="secondary" onPress={() => { setError(''); void getPermission().catch(() => setError('Kamera ruxsatini tekshirib bo‘lmadi.')); }} /></> : null}
    <Button title="Kodni qo‘lda kiritish" variant="secondary" onPress={onClose} />
  </BottomSheet>;
}
