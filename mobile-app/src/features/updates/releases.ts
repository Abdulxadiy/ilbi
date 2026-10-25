export const RELEASE_ORIGIN = 'https://ilbi.uz';
export type ReleasePlatform = 'windows' | 'linux' | 'android' | 'ios';
export type Release = { platform: ReleasePlatform; version: string; buildNumber: string | null; url: string; bytes: number | null; sha256: string | null; channel: 'preview' | 'stable'; kind: 'file' | 'store' };
export type ReleaseFeed = Record<ReleasePlatform, Release | null>;
export type InstalledApp = { platform: 'android' | 'ios'; version: string; buildNumber: string };
const platforms: ReleasePlatform[] = ['windows', 'linux', 'android', 'ios'];
const parts = (value: unknown) => typeof value === 'string' && /^\d{1,10}(?:\.\d{1,10}){0,2}$/.test(value) ? value.split('.').map(Number) : null;
export const validVersion = (value: unknown): value is string => typeof value === 'string' && value.split('.').length === 3 && Boolean(parts(value));
export const validBuild = (value: unknown): value is string => Boolean(parts(value));
export function compareVersions(a: string, b: string) {
  const left = parts(a), right = parts(b);
  if (!left || !right) throw Error('Ilova versiyasi tasdiqlanmadi.');
  for (let index = 0; index < 3; index++) { const difference = (left[index] || 0) - (right[index] || 0); if (difference) return Math.sign(difference); }
  return 0;
}
export function releaseURL(value: unknown, platform: ReleasePlatform): { url: string; kind: 'file' | 'store' } {
  if (typeof value !== 'string') throw Error('Rasmiy yuklab olish havolasi yo‘q.');
  const url = new URL(value, RELEASE_ORIGIN);
  if (url.username || url.password || url.protocol !== 'https:' || url.hash) throw Error('Yuklab olish havolasi tasdiqlanmadi.');
  const extension = { windows: '\\.exe', linux: '\\.tar\\.gz', android: '\\.apk', ios: '(?!)' }[platform];
  const path = new RegExp('^/downloads/(?:(?:mobile/)?[a-f0-9]{40}/)?[A-Za-z0-9][A-Za-z0-9._-]*' + extension + '$');
  if (url.origin === RELEASE_ORIGIN && !url.search && path.test(url.pathname) && !value.includes('%') && !value.includes('..')) return { url: url.href, kind: 'file' };
  if (platform === 'android' && url.origin === 'https://play.google.com' && url.pathname === '/store/apps/details' && url.searchParams.get('id') === 'uz.ilbi.mobile') return { url: url.href, kind: 'store' };
  if (platform === 'ios' && (url.origin === 'https://apps.apple.com' && /^\/(?:[a-z]{2}\/)?app\/(?:[^/]+\/)?id\d+$/.test(url.pathname) || url.origin === 'https://testflight.apple.com' && /^\/join\/[A-Za-z0-9]{8}$/.test(url.pathname))) return { url: url.href, kind: 'store' };
  throw Error('Yuklama rasmiy ILBI yoki ilovalar do‘koniga tegishli emas.');
}
export function parseReleaseFeed(value: any): ReleaseFeed {
  if (!value || value.schema !== 1) throw Error('Yuklamalar ro‘yxati tasdiqlanmadi.');
  const result = {} as ReleaseFeed;
  for (const platform of platforms) {
    const raw = platform === 'android' ? value.mobile?.android || (value.mobile?.url ? value.mobile : null) : platform === 'ios' ? value.mobile?.ios : value[platform];
    if (!raw) { result[platform] = null; continue; }
    if (!validVersion(raw.version) || raw.buildNumber != null && !validBuild(String(raw.buildNumber))) throw Error('Yuklama versiyasi tasdiqlanmadi.');
    if (platform === 'android' && raw.buildNumber != null && (!/^[1-9][0-9]{0,9}$/.test(String(raw.buildNumber)) || Number(raw.buildNumber) > 2100000000)) throw Error('Android yig‘ilma raqami noto‘g‘ri.');
    const link = releaseURL(raw.url, platform);
    if (link.kind === 'file' && (!Number.isSafeInteger(raw.bytes) || raw.bytes <= 0 || raw.bytes > 2 * 1024 ** 3 || !/^[a-f0-9]{64}$/.test(raw.sha256 || ''))) throw Error('Yuklama hajmi yoki SHA-256 qiymati tasdiqlanmadi.');
    result[platform] = { platform, ...link, version: raw.version, buildNumber: raw.buildNumber == null ? null : String(raw.buildNumber), bytes: link.kind === 'file' ? raw.bytes : null, sha256: link.kind === 'file' ? raw.sha256 : null, channel: raw.channel === 'preview' ? 'preview' : 'stable' };
  }
  return result;
}
export function updateCandidate(feed: ReleaseFeed, installed: InstalledApp | null): Release | null {
  if (!installed || !validVersion(installed.version) || !validBuild(installed.buildNumber)) return null;
  const offered = feed[installed.platform];
  if (!offered?.buildNumber) return null;
  const version = compareVersions(offered.version, installed.version), build = compareVersions(offered.buildNumber, installed.buildNumber);
  if (version < 0 || installed.platform === 'android' && build <= 0) return null;
  return version > 0 || version === 0 && build > 0 ? offered : null;
}
/** Public official feed: no API-session, tenant, cookies or credential-bearing redirects. */
export async function fetchReleaseFeed(signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const response = await fetcher(RELEASE_ORIGIN + '/downloads/releases.json', { headers: { Accept: 'application/json' }, credentials: 'omit', redirect: 'error', cache: 'no-store', signal });
  if (!response.ok) throw Error('Yuklab olish serveriga ulanib bo‘lmadi. Qayta tekshiring.');
  const body = await response.text();
  if (body.length > 1024 * 1024) throw Error('Yuklamalar ro‘yxati hajmi noto‘g‘ri.');
  return parseReleaseFeed(JSON.parse(body));
}
