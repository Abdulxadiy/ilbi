import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { validBuild, validVersion, type InstalledApp } from './releases';
/** Read the binary itself, never a newer Metro/OTA manifest or the web package version. */
export function installedApp(): InstalledApp | null {
  const platform = Platform.OS, version = Application.nativeApplicationVersion, buildNumber = Application.nativeBuildVersion;
  if (!['android', 'ios'].includes(platform) || Application.applicationId !== 'uz.ilbi.mobile' || !validVersion(version) || !validBuild(buildNumber)) return null;
  return { platform: platform as 'android' | 'ios', version, buildNumber };
}
