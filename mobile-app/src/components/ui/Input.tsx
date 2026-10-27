import React from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { X } from 'lucide-react-native';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing, typography } from '../../theme/tokens';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  suffix?: string | React.ReactNode;
  prefix?: string | React.ReactNode;
  onClear?: () => void;
  containerStyle?: ViewStyle;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  suffix,
  prefix,
  value,
  onClear,
  containerStyle,
  accessibilityLabel,
  style,
  ...props
}) => {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      ) : null}
      <View
        style={[
          styles.inputContainer,
          {
            backgroundColor: error ? colors.dangerSurface : colors.surface,
            borderColor: error ? colors.danger : colors.border,
          },
        ]}
      >
        {prefix ? (
          typeof prefix === 'string' ? (
            <Text style={[styles.affix, { color: colors.textMuted }]}>{prefix}</Text>
          ) : (
            <View style={styles.affixContainer}>{prefix}</View>
          )
        ) : null}

        <TextInput
          accessibilityLabel={accessibilityLabel || label || props.placeholder}
          value={value}
          placeholderTextColor={colors.textMuted}
          aria-invalid={Boolean(error)}
          accessibilityHint={error || props.accessibilityHint}
          style={[
            styles.input,
            {
              color: colors.text,
              fontSize: typography.size.md,
            },
            style,
          ]}
          {...props}
        />

        {onClear && value && value.length > 0 ? (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={onClear}
            accessibilityRole="button"
            accessibilityLabel={(label || 'Maydon') + 'ni tozalash'}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.clearButton}
          >
            <X size={16} color={colors.textMuted} />
          </TouchableOpacity>
        ) : null}

        {suffix ? (
          typeof suffix === 'string' ? (
            <Text style={[styles.affix, { color: colors.textSecondary }]}>{suffix}</Text>
          ) : (
            <View style={styles.affixContainer}>{suffix}</View>
          )
        ) : null}
      </View>
      {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
    marginBottom: spacing.xs,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 46,
  },
  input: {
    flex: 1,
    paddingVertical: spacing.sm,
  },
  affix: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  affixContainer: {
    marginRight: spacing.sm,
  },
  clearButton: {
    padding: spacing.xs,
  },
  error: {
    fontSize: typography.size.xs,
    marginTop: spacing.xs,
  },
});
