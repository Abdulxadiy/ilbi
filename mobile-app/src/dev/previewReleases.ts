import { parseReleaseFeed } from '../features/updates/releases';
/** Explicit visual/installed-identity test fixture; UpdatesProvider blocks real opening in preview. */
export function previewReleaseFeed() {
  return parseReleaseFeed(process.env.EXPO_PUBLIC_UPDATE_PREVIEW === '1' ? { schema: 1, mobile: { android: {
    version: '1.0.0', buildNumber: '2', url: '/downloads/mobile/' + '0'.repeat(40) + '/ILBI-1.0.0-android-2.apk',
    bytes: 42000000, sha256: '0'.repeat(64), channel: 'preview',
  } } } : { schema: 1 });
}
