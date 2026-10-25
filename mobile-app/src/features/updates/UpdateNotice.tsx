import { Text, TouchableOpacity, View } from 'react-native';
import { X } from 'lucide-react-native';
import { useTheme } from '../../theme/ThemeContext';
import { Button } from '../../components/ui/Button';
import { useUpdates } from './UpdatesProvider';
import { isDesignPreview } from '../../dev/preview';

/** A dismissible strip above the workspace, never a floating chat or forced restart. */
export function UpdateNotice() {
  const { colors } = useTheme(), updates = useUpdates();
  if (!updates.reminder || !updates.candidate || !updates.installed) return null;
  return <View accessibilityRole="alert" style={{ backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.border, padding: 12, gap: 8 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ flex: 1 }}><Text style={{ color: colors.text, fontWeight: '700' }}>Ilovani yangilang</Text><Text style={{ color: colors.textSecondary }}>Sizda v{updates.installed.version} ({updates.installed.buildNumber}). Yangisi: v{updates.candidate.version} ({updates.candidate.buildNumber}).</Text></View>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Yangilanish eslatmasini bugunga yopish" style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }} onPress={updates.dismiss}><X color={colors.text} size={20} /></TouchableOpacity>
    </View>
    {isDesignPreview ? <Text style={{ color: colors.textSecondary }}>Sinov yangilanishi · haqiqiy paket o‘rnatilmaydi.</Text> : null}
    {updates.actionMessage ? <Text style={{ color: colors.textSecondary }}>{updates.actionMessage}</Text> : null}
    <Button title="Yangilash" loading={updates.opening} onPress={() => { void updates.open(updates.candidate!); }} />
  </View>;
}
