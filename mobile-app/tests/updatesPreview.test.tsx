import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import { UpdatesProvider } from '../src/features/updates/UpdatesProvider';
import { UpdateNotice } from '../src/features/updates/UpdateNotice';
import { ThemeProvider } from '../src/theme/ThemeContext';
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 919191 } }) }));
jest.mock('../src/features/updates/installed', () => ({ installedApp: () => ({ platform: 'android', version: '1.0.0', buildNumber: '1' }) }));
jest.mock('../src/dev/preview', () => ({ isDesignPreview: true }));
jest.mock('expo-linking', () => ({ openURL: jest.fn() }));
test('explicit native update fixture cannot open or install a real package', async () => {
  const old = process.env.EXPO_PUBLIC_UPDATE_PREVIEW; process.env.EXPO_PUBLIC_UPDATE_PREVIEW = '1';
  try {
    const screen = await render(<ThemeProvider><UpdatesProvider><UpdateNotice /></UpdatesProvider></ThemeProvider>);
    await fireEvent.press(await screen.findByText('Yangilash'));
    expect(await screen.findByText('Dizayn rejimida haqiqiy paket yuklanmaydi.')).toBeTruthy();
    expect(Linking.openURL).not.toHaveBeenCalled();
  } finally { if (old === undefined) delete process.env.EXPO_PUBLIC_UPDATE_PREVIEW; else process.env.EXPO_PUBLIC_UPDATE_PREVIEW = old; }
});
