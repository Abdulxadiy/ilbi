import { Platform } from 'react-native';
import { installedApp } from '../src/features/updates/installed';
let mockVersion = '1.0.0', mockBuild = '1', mockId = 'uz.ilbi.mobile';
jest.mock('expo-application', () => ({ get nativeApplicationVersion() { return mockVersion; }, get nativeBuildVersion() { return mockBuild; }, get applicationId() { return mockId; } }));
describe('Installed binary identity', () => {
  beforeEach(() => { mockVersion = '1.0.0'; mockBuild = '1'; mockId = 'uz.ilbi.mobile'; jest.replaceProperty(Platform, 'OS', 'android'); });
  afterEach(() => jest.restoreAllMocks());
  test('reads actual application version/build rather than a package or update manifest', () => {
    expect(installedApp()).toEqual({ platform: 'android', version: '1.0.0', buildNumber: '1' });
    mockBuild = '42'; expect(installedApp()?.buildNumber).toBe('42');
  });
  test('Expo Go, web and unknown identities cannot be mistaken for an outdated ILBI install', () => {
    mockId = 'host.exp.exponent'; expect(installedApp()).toBeNull();
    mockId = 'uz.ilbi.mobile'; jest.replaceProperty(Platform, 'OS', 'web'); expect(installedApp()).toBeNull();
    jest.replaceProperty(Platform, 'OS', 'android'); mockVersion = ''; expect(installedApp()).toBeNull();
  });
});
