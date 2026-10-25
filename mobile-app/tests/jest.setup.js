/* eslint-disable no-undef */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('../src/navigation/useAppNavigation', () => ({
  useAppNavigation: () => ({ openDrawer: jest.fn(), navigate: jest.fn(), goBack: jest.fn() }),
  getReceiptSnapshot: () => null,
}));

jest.mock('expo-crypto', () => ({ randomUUID: () => require('node:crypto').randomUUID(), getRandomBytesAsync: async count => require('node:crypto').randomBytes(count) }));

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

// Feature component tests isolate Router; actual route guards and URL transitions run in Chrome.
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  router: { setParams: jest.fn(), navigate: jest.fn(), push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
}));
