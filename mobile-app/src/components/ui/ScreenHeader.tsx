import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ArrowLeft, Menu, Plus } from 'lucide-react-native';
import { IlbiLogo } from '../brand/IlbiLogo';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, typography } from '../../theme/tokens';

export interface HeaderAction {
  icon?: string;
  onPress: () => void;
  accessibilityLabel?: string;
}

export interface ScreenHeaderProps {
  title?: string;
  showLogo?: boolean;
  onOpenDrawer?: () => void;
  onGoBack?: () => void;
  leftAction?: HeaderAction | React.ReactNode;
  rightAction?: HeaderAction | React.ReactNode;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  title,
  showLogo,
  onOpenDrawer,
  onGoBack,
  leftAction,
  rightAction,
}) => {
  const { colors } = useTheme();

  const shouldShowLogo = showLogo !== undefined ? showLogo : !title;

  const renderLeft = () => {
    if (leftAction) {
      if (React.isValidElement(leftAction)) {
        return leftAction;
      }
      const act = leftAction as HeaderAction;
      return (
        <TouchableOpacity accessibilityRole="button"
          onPress={act.onPress}
          accessibilityLabel={act.accessibilityLabel || (act.icon === 'back' ? 'Orqaga' : act.icon === 'plus' ? 'Qo‘shish' : 'Menyuni ochish')}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.iconButton}
        >
          {act.icon === 'back' ? (
            <ArrowLeft size={22} color={colors.text} />
          ) : (
            <Menu size={22} color={colors.text} />
          )}
        </TouchableOpacity>
      );
    }

    if (onGoBack) {
      return (
        <TouchableOpacity
          accessibilityLabel="Orqaga"
          accessibilityRole="button"
          onPress={onGoBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.iconButton}
        >
          <ArrowLeft size={22} color={colors.text} />
        </TouchableOpacity>
      );
    }

    if (onOpenDrawer) {
      return (
        <TouchableOpacity
          accessibilityLabel="Menyuni ochish"
          accessibilityRole="button"
          onPress={onOpenDrawer}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.iconButton}
        >
          <Menu size={22} color={colors.text} />
        </TouchableOpacity>
      );
    }

    return <View style={styles.spacer} />;
  };

  const renderRight = () => {
    if (rightAction) {
      if (React.isValidElement(rightAction)) {
        return rightAction;
      }
      const act = rightAction as HeaderAction;
      return (
        <TouchableOpacity accessibilityRole="button"
          onPress={act.onPress}
          accessibilityLabel={act.accessibilityLabel || (act.icon === 'back' ? 'Orqaga' : act.icon === 'plus' ? 'Qo‘shish' : 'Menyuni ochish')}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.iconButton}
        >
          {act.icon === 'plus' ? (
            <Plus size={22} color={colors.text} />
          ) : (
            <Menu size={22} color={colors.text} />
          )}
        </TouchableOpacity>
      );
    }

    return <View style={styles.spacer} />;
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          borderBottomColor: colors.borderSubtle,
        },
      ]}
    >
      <View style={styles.leftContainer}>{renderLeft()}</View>

      <View style={styles.centerContainer}>
        {shouldShowLogo ? (
          <IlbiLogo height={24} />
        ) : title ? (
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {title}
          </Text>
        ) : null}
      </View>

      <View style={styles.rightContainer}>{renderRight()}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
  },
  leftContainer: {
    width: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightContainer: {
    width: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  iconButton: {
    padding: spacing.xs,
  },
  title: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.bold,
  },
  spacer: {
    width: 24,
  },
});
