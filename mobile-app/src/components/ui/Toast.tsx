import React, { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Check, CircleAlert, Info, X } from 'lucide-react-native';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing, typography } from '../../theme/tokens';
import { safeDisplayText } from '../../security/presentation';

export interface ToastProps {
  visible?: boolean;
  message: string;
  onDismiss: () => void;
  autoHideDuration?: number;
  type?: 'success' | 'info' | 'error';
  variant?: 'success' | 'info' | 'error';
}

export const Toast: React.FC<ToastProps> = ({
  visible = true,
  message,
  onDismiss,
  autoHideDuration = 3000,
  type = 'info',
  variant,
}) => {
  const actualType = variant || type;
  const duration = actualType === 'error' ? 0 : autoHideDuration;
  const { colors, isDark } = useTheme();

  useEffect(() => {
    if (visible && duration > 0) {
      const timer = setTimeout(() => {
        onDismiss();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [visible, duration, onDismiss]);

  if (!visible) return null;

  const getThemeStyles = () => {
    if (actualType === 'success') {
      return {
        bg: isDark ? '#064E3B' : '#D1FAE5',
        border: isDark ? '#059669' : '#10B981',
        text: isDark ? '#A7F3D0' : '#065F46',
        iconBg: isDark ? '#059669' : '#10B981',
        iconColor: '#FFFFFF',
      };
    }
    if (actualType === 'error') {
      return {
        bg: isDark ? '#451A1A' : '#FEE2E2',
        border: isDark ? '#DC2626' : '#EF4444',
        text: isDark ? '#FECACA' : '#991B1B',
        iconBg: isDark ? '#DC2626' : '#EF4444',
        iconColor: '#FFFFFF',
      };
    }
    return {
      bg: colors.surfaceSecondary,
      border: colors.border,
      text: colors.text,
      iconBg: colors.textSecondary,
      iconColor: colors.surface,
    };
  };

  const styleConfig = getThemeStyles();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: styleConfig.bg,
          borderColor: styleConfig.border,
        },
      ]}
    >
      <View style={[styles.iconWrapper, { backgroundColor: styleConfig.iconBg }]}>
        {actualType === 'success' ? <Check size={14} color={styleConfig.iconColor} /> : actualType === 'error' ? <CircleAlert size={14} color={styleConfig.iconColor} /> : <Info size={14} color={styleConfig.iconColor} />}
      </View>
      <Text accessibilityRole={actualType === 'error' ? 'alert' : undefined} accessibilityLiveRegion="polite" style={[styles.message, { color: styleConfig.text }]}>{safeDisplayText(message)}</Text>
      <TouchableOpacity
        accessibilityLabel="Xabarni yopish"
        accessibilityRole="button"
        onPress={onDismiss}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={styles.closeButton}
      >
        <X size={16} color={styleConfig.text} />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  iconWrapper: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  message: {
    flex: 1,
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  closeButton: {
    padding: spacing.xs,
    marginLeft: spacing.sm,
  },
});
