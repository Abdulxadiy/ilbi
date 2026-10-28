import React from 'react';
import { render, act } from '@testing-library/react-native';
import { darkColors, lightColors, spacing, typography } from '../src/theme/tokens';
import { ThemeProvider, useTheme } from '../src/theme/ThemeContext';

describe('Theme and Design Tokens', () => {
  test('Light theme tokens match monochrome design specifications', () => {
    expect(lightColors.background).toBe('#F0EFEB');
    expect(lightColors.surface).toBe('#FFFFFF');
    expect(lightColors.text).toBe('#0B0909');
    expect(lightColors.primaryAction).toBe('#0B0909');
    expect(lightColors.primaryActionText).toBe('#F0EFEB');
    // Documents/receipts must remain white with dark text
    expect(lightColors.paperBackground).toBe('#FFFFFF');
    expect(lightColors.paperText).toBe('#0B0909');
  });

  test('Dark theme tokens match graphite/dark specifications', () => {
    expect(darkColors.background).toBe('#0B0909');
    expect(darkColors.surface).toBe('#171515');
    expect(darkColors.text).toBe('#F0EFEB');
    expect(darkColors.primaryAction).toBe('#F0EFEB');
    expect(darkColors.primaryActionText).toBe('#0B0909');
    // Paper stays white with dark text even in dark mode!
    expect(darkColors.paperBackground).toBe('#FFFFFF');
    expect(darkColors.paperText).toBe('#0B0909');
  });

  test('Typography scale and spacing scale are consistent', () => {
    expect(spacing.sm).toBe(8);
    expect(spacing.md).toBe(12);
    expect(spacing.lg).toBe(16);
    expect(typography.size.md).toBe(15);
  });

  test('ThemeProvider defaults to light theme and toggles between light and dark', async () => {
    let currentMode: any;
    let isDarkValue: any;
    let toggle: any;

    const TestComponent = () => {
      const { mode, isDark, toggleTheme } = useTheme();
      currentMode = mode;
      isDarkValue = isDark;
      toggle = toggleTheme;
      return null;
    };

    await render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(currentMode).toBe('light');
    expect(isDarkValue).toBe(false);

    await act(async () => {
      await toggle();
    });

    expect(currentMode).toBe('dark');
    expect(isDarkValue).toBe(true);
  });
});
