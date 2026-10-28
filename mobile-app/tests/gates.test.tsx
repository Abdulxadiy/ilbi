import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { TermsScreen, StoreSelection, SessionRecovery } from '../src/features/auth/Gates';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { sessionEntry } from '../src/features/auth/routePolicy';
import { router } from 'expo-router';
const mockAccept = jest.fn(async () => {}), mockSelect = jest.fn(async () => {}), mockRefresh = jest.fn(async () => {});
const mockProfile = { id: 1, role: 'owner', terms_accepted: false, tenants: [{ id: 10, name: 'First', is_owner: true, permissions: ['*'] }, { id: 20, name: 'Second', is_owner: false, permissions: [] }] };
jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn(), back: jest.fn(), canGoBack: () => true }, useLocalSearchParams: () => ({}) }));
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ user: mockProfile, acceptTerms: mockAccept, selectTenant: mockSelect, refreshProfile: mockRefresh, logout: jest.fn(async () => {}), sessionError: 'Session unavailable' }) }));
describe('Session and business access gates', () => {
  beforeEach(() => jest.clearAllMocks());
  test('business entry requires accepted terms and an authorized selected store', () => {
    expect(sessionEntry(null, null)).toBe('/login');
    expect(sessionEntry(mockProfile as any, null)).toBe('/terms');
    expect(sessionEntry({ ...mockProfile, terms_accepted: true } as any, null)).toBe('/stores');
    expect(sessionEntry({ ...mockProfile, terms_accepted: true } as any, mockProfile.tenants[0])).toBe('/(app)/(tabs)');
    expect(sessionEntry({ ...mockProfile, role: 'platform_admin', terms_accepted: true } as any, null)).toBe('/(app)/admin');
  });
  test('terms cannot be submitted before explicit consent', async () => {
    const screen = await render(<ThemeProvider><TermsScreen /></ThemeProvider>);
    await fireEvent.press(screen.getByText('Qabul qilish va davom etish'));
    expect(mockAccept).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('checkbox'));
    await fireEvent.press(screen.getByText('Qabul qilish va davom etish'));
    expect(mockAccept).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/');
  });
  test('store choice uses the explicitly pressed store', async () => {
    const screen = await render(<ThemeProvider><StoreSelection /></ThemeProvider>);
    await fireEvent.press(screen.getByText('Second'));
    expect(mockSelect).toHaveBeenCalledWith(20);
  });
  test('session recovery has an actual retry operation', async () => {
    const screen = await render(<ThemeProvider><SessionRecovery /></ThemeProvider>);
    expect(screen.getByText('Session unavailable')).toBeTruthy();
    await fireEvent.press(screen.getByText('Qayta tekshirish'));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});
