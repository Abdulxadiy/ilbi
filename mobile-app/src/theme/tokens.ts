export type ThemeMode = 'light' | 'dark';

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceSecondary: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  textMuted: string;
  border: string;
  borderSubtle: string;
  primaryAction: string;
  primaryActionBg: string;
  primaryActionText: string;
  secondaryAction: string;
  secondaryActionText: string;
  danger: string;
  dangerSurface: string;
  success: string;
  successSurface: string;
  warning: string;
  warningSurface: string;
  paperBackground: string;
  paperText: string;
  scrim: string;
  card: string;
}

export const lightColors: ThemeColors = {
  background: '#F0EFEB',
  surface: '#FFFFFF',
  surfaceSecondary: '#F8F8F6',
  text: '#0B0909',
  textSecondary: '#4B5563',
  textTertiary: '#9CA3AF',
  textMuted: '#9CA3AF',
  border: '#E5E7EB',
  borderSubtle: '#F3F4F6',
  primaryAction: '#0B0909',
  primaryActionBg: '#0B0909',
  primaryActionText: '#F0EFEB',
  secondaryAction: '#FFFFFF',
  secondaryActionText: '#0B0909',
  danger: '#EF4444',
  dangerSurface: '#FEE2E2',
  success: '#10B981',
  successSurface: '#D1FAE5',
  warning: '#F59E0B',
  warningSurface: '#FEF3C7',
  paperBackground: '#FFFFFF',
  paperText: '#0B0909',
  scrim: 'rgba(0, 0, 0, 0.45)',
  card: '#FFFFFF',
};

export const darkColors: ThemeColors = {
  background: '#0B0909',
  surface: '#171515',
  surfaceSecondary: '#211F1F',
  text: '#F0EFEB',
  textSecondary: '#9CA3AF',
  textTertiary: '#6B7280',
  textMuted: '#6B7280',
  border: '#2A2727',
  borderSubtle: '#1F1D1D',
  primaryAction: '#F0EFEB',
  primaryActionBg: '#F0EFEB',
  primaryActionText: '#0B0909',
  secondaryAction: '#171515',
  secondaryActionText: '#F0EFEB',
  danger: '#EF4444',
  dangerSurface: '#451A1A',
  success: '#10B981',
  successSurface: '#064E3B',
  warning: '#F59E0B',
  warningSurface: '#78350F',
  paperBackground: '#FFFFFF',
  paperText: '#0B0909',
  scrim: 'rgba(0, 0, 0, 0.75)',
  card: '#171515',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const radius = {
  xs: 4,
  sm: 6,
  md: 10,
  lg: 14,
  full: 9999,
};

export const typography = {
  size: {
    xs: 11,
    sm: 13,
    md: 15,
    lg: 17,
    xl: 20,
    xxl: 24,
    display: 28,
  },
  weight: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
  micro: {
    fontSize: 11,
    fontFamily: 'System',
    lineHeight: 14,
  },
  caption: {
    fontSize: 13,
    fontFamily: 'System',
    lineHeight: 18,
  },
  body: {
    fontSize: 15,
    fontFamily: 'System',
    lineHeight: 22,
  },
  subheading: {
    fontSize: 18,
    fontFamily: 'System',
    lineHeight: 24,
  },
  heading: {
    fontSize: 22,
    fontFamily: 'System',
    lineHeight: 28,
  },
  hero: {
    fontSize: 28,
    fontFamily: 'System',
    lineHeight: 34,
  },
};
