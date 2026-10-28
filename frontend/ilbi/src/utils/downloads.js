export function releaseURL(value, origin) {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (!value.startsWith('https://') && !/^\/downloads\/(?:(?:mobile\/)?[a-f0-9]{40}\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) return null;
  try {
    const url = new URL(value, origin);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) return null;
    return url.href;
  } catch { return null; }
}

export function releaseSize(bytes) {
  return Number.isFinite(bytes) && bytes > 0 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : '';
}

export function mobileReleaseURL(value, origin, platform) {
  const resolved = releaseURL(value, origin);
  if (!resolved) return null;
  const url = new URL(resolved);
  if (url.hash) return null;
  if (platform === 'android') {
    if (url.origin === new URL(origin).origin && !url.search && !url.hash && /^\/downloads\/(?:(?:mobile\/)?[a-f0-9]{40}\/)?[A-Za-z0-9][A-Za-z0-9._-]*\.apk$/.test(url.pathname)) return resolved;
    if (url.origin === 'https://play.google.com' && url.pathname === '/store/apps/details' && url.searchParams.get('id') === 'uz.ilbi.mobile') return resolved;
  }
  if (platform === 'ios' && (url.origin === 'https://apps.apple.com' && /^\/(?:[a-z]{2}\/)?app\/(?:[^/]+\/)?id\d+$/.test(url.pathname) || url.origin === 'https://testflight.apple.com' && /^\/join\/[A-Za-z0-9]{8}$/.test(url.pathname))) return resolved;
  return null;
}
