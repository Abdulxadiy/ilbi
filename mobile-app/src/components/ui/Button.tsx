import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableOpacityProps,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing, typography } from '../../theme/tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends TouchableOpacityProps {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  iconPosition = 'left',
  fullWidth = false,
  style,
  ...props
}) => {
  const { colors } = useTheme();

  const getContainerStyle = (): ViewStyle => {
    let bg = colors.primaryAction;
    let border = 'transparent';
    let borderWidth = 0;

    if (variant === 'secondary') {
      bg = colors.surface;
      border = colors.border;
      borderWidth = 1;
    } else if (variant === 'ghost') {
      bg = 'transparent';
    } else if (variant === 'danger') {
      bg = colors.danger;
    }

    if (disabled) {
      bg = colors.border;
      border = 'transparent';
    }

    let minHeight = 44;
    let paddingHorizontal = spacing.lg;

    if (size === 'sm') {
      minHeight = 36;
      paddingHorizontal = spacing.md;
    } else if (size === 'lg') {
      minHeight = 52;
      paddingHorizontal = spacing.xl;
    }

    return {
      backgroundColor: bg,
      borderColor: border,
      borderWidth,
      minHeight,
      paddingHorizontal,
      borderRadius: radius.md,
      alignSelf: fullWidth ? 'stretch' : 'auto',
    };
  };

  const getTextColor = () => {
    if (disabled) return colors.textMuted;
    if (variant === 'primary') return colors.primaryActionText;
    if (variant === 'secondary') return colors.text;
    if (variant === 'ghost') return colors.text;
    if (variant === 'danger') return '#FFFFFF';
    return colors.text;
  };

  const getFontSize = () => {
    if (size === 'sm') return typography.size.sm;
    if (size === 'lg') return typography.size.lg;
    return typography.size.md;
  };

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      disabled={disabled || loading}
      style={[styles.base, getContainerStyle(), style]}
      {...props}
      accessibilityRole={props.accessibilityRole || 'button'}
      accessibilityLabel={props.accessibilityLabel || title}
      accessibilityState={{ ...props.accessibilityState, disabled: disabled || loading, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator size="small" color={getTextColor()} />
      ) : (
        <>
          {icon && iconPosition === 'left' && <>{icon}</>}
          <Text
            style={[
              styles.text,
              {
                color: getTextColor(),
                fontSize: getFontSize(),
                marginLeft: icon && iconPosition === 'left' ? spacing.sm : 0,
                marginRight: icon && iconPosition === 'right' ? spacing.sm : 0,
              },
            ]}
          >
            {title}
          </Text>
          {icon && iconPosition === 'right' && <>{icon}</>}
        </>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontWeight: typography.weight.semibold,
    textAlign: 'center',
  },
});
