import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button } from '../../components/ui/Button';
import { Notice } from '../../components/ui/Page';
import { captureAuthScope, assertAuthScope } from '../../api/client';
import { defaultCategories, readCategories, saveCategory, type CategoryKind } from './categories';
export function CashboxCategories({ kind, user, tenant, value, disabled, onSelect }: { kind: CategoryKind; user: number; tenant: number; value: string; disabled: boolean; onSelect: (value: string) => void }) {
  const [custom, setCustom] = useState<string[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void readCategories(kind, user, tenant).then(rows => { if (active) setCustom(rows); }).catch(() => { if (active) setError('Saqlangan nomlar yuklanmadi.'); });
    return () => { active = false; };
  }, [kind, user, tenant]);
  const save = async (remove = false) => {
    if (busy || disabled) return;
    const scope = captureAuthScope(); setBusy(true); setError('');
    try { const rows = await saveCategory(kind, user, tenant, value, remove); assertAuthScope(scope); setCustom(rows); }
    catch (failure: any) { setError(failure.message || 'Nom saqlanmadi.'); }
    finally { setBusy(false); }
  };
  const choices = [...new Set([...defaultCategories[kind], ...custom])];
  return <View style={{ gap: 8 }}>
    <Notice>Tez tanlash · saqlangan nomlar shu qurilma, hisob va do‘konga tegishli.</Notice>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{choices.map(name => <Button key={name} size="sm" title={name} variant="secondary" disabled={disabled || busy} onPress={() => onSelect(name)} />)}</View>
    {value.trim() && !choices.includes(value.trim()) && <Button title="Nomni keyingi safar uchun saqlash" variant="secondary" disabled={disabled} loading={busy} onPress={() => { void save(); }} />}
    {custom.includes(value.trim()) && <Button title="Saqlangan nomni o‘chirish" variant="ghost" disabled={disabled} loading={busy} onPress={() => { void save(true); }} />}
    {error ? <Notice error>{error}</Notice> : null}
  </View>;
}
