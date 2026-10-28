import { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Notice } from '../../components/ui/Page';
import { teamPresets } from './presets';
import type { PermissionChoice } from './model';

export function PermissionSelector({ choices, selected, onChange, disabled, error }: { choices: PermissionChoice[]; selected: number[]; onChange: (ids: number[]) => void; disabled: boolean; error?: string }) {
  const { colors } = useTheme(), [search, setSearch] = useState('');
  const unknown = selected.filter(id => !choices.some(row => row.id === id));
  const matching = choices.filter(row => (row.name + ' ' + row.code).toLowerCase().includes(search.trim().toLowerCase()));
  const categories = [...new Set(matching.map(row => row.category))];
  return <View style={{ gap: 10, padding: 12, borderWidth: 1, borderColor: error ? colors.danger : colors.border, borderRadius: 12 }}>
    <Text style={{ color: colors.text, fontWeight: '700' }}>Xodim huquqlari · {selected.length}</Text>
    <Notice>Tayyor rol mavjud tanlovni almashtiradi. Faqat shu server ruxsat bergan amallar tanlanadi.</Notice>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {teamPresets.map(preset => <Button key={preset.name} size="sm" variant="secondary" title={preset.name} disabled={disabled} onPress={() => onChange(choices.filter(row => preset.codes.includes(row.code)).map(row => row.id))} />)}
      <Button size="sm" variant="secondary" title="Barcha ruxsat etilgan huquqlar" disabled={disabled} onPress={() => onChange(choices.map(row => row.id))} />
      <Button size="sm" variant="ghost" title="Huquqlarni tozalash" disabled={disabled} onPress={() => onChange([])} />
    </View>
    {unknown.length > 0 && <><Notice error>Server ro‘yxatida yo‘q {unknown.length} ta eski ruxsat bor. Profilni saqlashda o‘zgarmagan huquqlar saqlanadi.</Notice><Button title="Tanilmagan ruxsatlarni olib tashlash" variant="secondary" disabled={disabled} onPress={() => onChange(selected.filter(id => !unknown.includes(id)))} /></>}
    <Input label="Huquq qidirish" value={search} onChangeText={setSearch} editable={!disabled} />
    {categories.map(category => <View key={category} style={{ gap: 4 }}>
      <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>{category}</Text>
      {matching.filter(row => row.category === category).map(row => <TouchableOpacity key={row.id} accessibilityRole="checkbox" accessibilityLabel={row.name} accessibilityState={{ checked: selected.includes(row.id), disabled }} disabled={disabled} onPress={() => onChange(selected.includes(row.id) ? selected.filter(id => id !== row.id) : [...selected, row.id])} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', minHeight: 44, paddingVertical: 8 }}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>{selected.includes(row.id) ? '☑' : '☐'}</Text><Text style={{ color: colors.text, flex: 1 }}>{row.name}</Text>
      </TouchableOpacity>)}
    </View>)}
    {error ? <Notice error>{error}</Notice> : null}
  </View>;
}
