import { claimMobileReminder, updateDay } from '../src/features/updates/reminder';
import { compareVersions, fetchReleaseFeed, parseReleaseFeed, releaseURL, updateCandidate } from '../src/features/updates/releases';
const apk = { version: '1.0.0', buildNumber: '2', url: '/downloads/mobile/' + 'a'.repeat(40) + '/ILBI-1.0.0-android-2.apk', bytes: 100, sha256: 'b'.repeat(64), channel: 'preview' };
const current = { platform: 'android' as const, version: '1.0.0', buildNumber: '1' };
describe('Official mobile releases and daily reminders', () => {
  test('compares numeric versions and native build numbers, including same-version patch builds', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(updateCandidate(parseReleaseFeed({ schema: 1, mobile: { android: apk } }), current)?.buildNumber).toBe('2');
    for (const changes of [{ buildNumber: '1' }, { version: '0.9.9', buildNumber: '50' }, { version: '1.1.0', buildNumber: '1' }]) expect(updateCandidate(parseReleaseFeed({ schema: 1, mobile: { android: { ...apk, ...changes } } }), current)).toBeNull();
    expect(updateCandidate(parseReleaseFeed({ schema: 1, mobile: null }), current)).toBeNull();
    expect(updateCandidate(parseReleaseFeed({ schema: 1, mobile: apk }), current)).toBeTruthy();
    expect(updateCandidate(parseReleaseFeed({ schema: 1, mobile: { ...apk, buildNumber: '2100000000' } }), current)).toBeTruthy();
    for (const buildNumber of ['1.2', '2100000001', '-1']) expect(() => parseReleaseFeed({ schema: 1, mobile: { ...apk, buildNumber } })).toThrow();
  });
  test('iOS opens a published store/TestFlight link and compares its own build', () => {
    const ios = { version: '1.0.1', buildNumber: '1', url: 'https://apps.apple.com/uz/app/ilbi/id123456789' };
    expect(updateCandidate(parseReleaseFeed({ schema: 1, mobile: { ios } }), { platform: 'ios', version: '1.0.0', buildNumber: '99' })?.kind).toBe('store');
    expect(releaseURL('https://testflight.apple.com/join/ABCD1234', 'ios').kind).toBe('store');
  });
  test('rejects executable URLs, foreign downloads, path traversal and inconsistent integrity metadata', () => {
    for (const url of ['javascript:alert(1)', 'http://ilbi.uz/downloads/app.apk', 'https://evil.example/app.apk', '//evil.example/app.apk', 'https://user:pass@ilbi.uz/downloads/app.apk', '/downloads/../app.apk', '/downloads/%2e%2e/app.apk', '/downloads/app.apk?token=private']) expect(() => releaseURL(url, 'android')).toThrow();
    for (const changes of [{ bytes: 0 }, { sha256: 'bad' }, { version: 'garbage' }]) expect(() => parseReleaseFeed({ schema: 1, mobile: { ...apk, ...changes } })).toThrow();
    expect(() => releaseURL('https://play.google.com/store/apps/details?id=other.app', 'android')).toThrow();
  });
  test('public feed requests never reuse private API transport or cookies and reject bad responses', async () => {
    const fetcher = jest.fn(async () => ({ ok: true, text: async () => JSON.stringify({ schema: 1, mobile: apk }) }));
    await fetchReleaseFeed(new AbortController().signal, fetcher as any);
    expect(fetcher).toHaveBeenCalledWith('https://ilbi.uz/downloads/releases.json', expect.objectContaining({ credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json' } }));
    await expect(fetchReleaseFeed(new AbortController().signal, jest.fn(async () => ({ ok: false })) as any)).rejects.toThrow('Qayta tekshiring');
  });
  test('reminders persist per account/installed build/day and serialize simultaneous mounts', async () => {
    const values = new Map<string, string>(), storage = { getItem: async (key: string) => values.get(key) || null, setItem: async (key: string, value: string) => { values.set(key, value); } } as any;
    const offered = parseReleaseFeed({ schema: 1, mobile: apk }).android!;
    expect(await Promise.all([claimMobileReminder(9871, current, offered, '2026-10-25', storage), claimMobileReminder(9871, current, offered, '2026-10-25', storage)])).toEqual([true, false]);
    expect(await claimMobileReminder(9871, current, offered, '2026-10-26', storage)).toBe(true);
    expect(await claimMobileReminder(9872, current, offered, '2026-10-26', storage)).toBe(true);
    expect(updateDay(Date.parse('2026-10-25T19:00:00Z'))).toBe('2026-10-26');
  });
  test('a login/background change during persistence does not consume an unseen reminder', async () => {
    const values = new Map<string, string>(); let valid = true, complete!: () => void;
    const storage = { getItem: async (key: string) => values.get(key) || null, setItem: async (key: string, value: string) => { values.set(key, value); await new Promise<void>(resolve => { complete = resolve; }); }, removeItem: async (key: string) => { values.delete(key); } } as any;
    const offered = parseReleaseFeed({ schema: 1, mobile: apk }).android!;
    const pending = claimMobileReminder(9981, current, offered, '2026-10-25', storage, () => valid);
    await Promise.resolve(); await Promise.resolve(); valid = false; complete();
    expect(await pending).toBe(false); expect(values.size).toBe(0);
  });
});
