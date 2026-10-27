import { Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
export function ChoiceField<T extends string>({ label, value, options, onChange, disabled = false, error }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; disabled?: boolean; error?: string }) {
  const { colors } = useTheme();
  return <View style={{ gap: 8 }}><Text style={{ color: colors.textSecondary }}>{label}</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
    {options.map(option => <TouchableOpacity key={option.value} accessibilityRole="radio" accessibilityLabel={label + ': ' + option.label} accessibilityState={{ checked: option.value === value, disabled }} aria-invalid={Boolean(error)} disabled={disabled} onPress={() => onChange(option.value)} style={{ minHeight: 44, minWidth: 60, justifyContent: 'center', paddingHorizontal: 14, borderWidth: 1, borderRadius: 10, borderColor: error ? colors.danger : colors.border, backgroundColor: value === option.value ? colors.primaryAction : colors.surface }}><Text style={{ color: value === option.value ? colors.primaryActionText : colors.text }}>{option.label}</Text></TouchableOpacity>)}
  </View>{error ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text> : null}</View>;
}
