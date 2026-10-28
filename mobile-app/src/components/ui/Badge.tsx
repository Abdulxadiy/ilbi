import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing, typography } from '../../theme/tokens';

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  showDot?: boolean;
  dot?: boolean;
  style?: ViewStyle;
}

export const Badge: React.FC<BadgeProps> = ({
  label,
  variant = 'neutral',
  showDot = false,
  dot,
  style,
}) => {
  const hasDot = dot !== undefined ? dot : showDot;
  const { colors } = useTheme();

  const getColors = () => {
    switch (variant) {
      case 'success':
        return {
          bg: colors.successSurface,
          text: colors.success,
          dot: colors.success,
        };
      case 'warning':
        return {
          bg: colors.warningSurface,
          text: colors.warning,
          dot: colors.warning,
        };
      case 'danger':
        return {
          bg: colors.dangerSurface,
          text: colors.danger,
          dot: colors.danger,
        };
      default:
        return {
          bg: colors.surfaceSecondary,
          text: colors.textSecondary,
          dot: colors.textSecondary,
        };
    }
  };

  const current = getColors();

  return (
    <View style={[styles.badge, { backgroundColor: current.bg }, style]}>
      {hasDot ? <View style={[styles.dot, { backgroundColor: current.dot }]} /> : null}
      <Text style={[styles.text, { color: current.text }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  text: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
  },
});
