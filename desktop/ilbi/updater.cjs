const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const { mkdir, open, rename, rm, stat } = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { join } = require('node:path');
const { OFFICIAL_SERVER } = require('./runtime.cjs');
const { publicReleases } = require('./services.cjs');
const { publicErrorMessage } = require('./public-errors.cjs');
const MAX_PACKAGE = 1024 * 1024 * 1024;
function versionParts(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) throw Error('Yangilanish versiyasi noto‘g‘ri.');
  return value.split('.').map(Number);
}
function candidate(release, current, platform) {
  if (!['win32', 'linux'].includes(platform)) return null;
  const item = release[platform === 'win32' ? 'windows' : 'linux'];
  if (!item) return null;
  const offered = versionParts(item.version), installed = versionParts(current.version);
  if (!/^[a-f0-9]{40}$/.test(item.sourceCommit) || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || item.bytes > MAX_PACKAGE) throw Error('Yangilanish ma’lumotlari tasdiqlanmadi.');
  const name = platform === 'win32' ? `ILBI-Setup-${item.version}-x64.exe` : `ILBI-${item.version}-linux-x64.tar.gz`;
  const url = new URL(item.url, OFFICIAL_SERVER);
  if (url.href !== `${OFFICIAL_SERVER}/downloads/${item.sourceCommit}/${name}`) throw Error('Yangilanish faqat rasmiy ILBI manzilidan olinadi.');
  const comparison = offered.map((n, index) => Math.sign(n - installed[index])).find(Boolean) || 0;
  if (comparison < 0 || item.sourceCommit === current.sourceCommit) return null;
  if (comparison === 0 && current.buildTimestamp && (!Number.isSafeInteger(item.buildTimestamp) || item.buildTimestamp <= current.buildTimestamp)) return null;
  return { version: item.version, sourceCommit: item.sourceCommit, sha256: item.sha256, bytes: item.bytes, url: url.href, name };
}
async function verifyFile(path, release) {
  if ((await stat(path)).size !== release.bytes) throw Error('Yuklangan paket to‘liq emas. Qayta yuklab oling.');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (hash.digest('hex') !== release.sha256) throw Error('Yuklangan paket tekshiruvdan o‘tmadi. Qayta yuklab oling.');
}
class DesktopUpdater extends EventEmitter {
  constructor({ current, cache, platform = process.platform, fetcher = fetch, install }) {
    super(); Object.assign(this, { current, cache, platform, fetcher, apply: install });
    this.state = { phase: 'idle', installedVersion: current.version, installedBuild: current.sourceCommit, progress: null };
  }
  status() { return { ...this.state }; }
  set(values) { this.state = { ...this.state, ...values, ...(values.message !== undefined ? { message: publicErrorMessage(values.message) } : {}) }; this.emit('status', this.status()); }
  async check() {
    if (this.busy || this.checking || this.state.phase === 'installing') return this.status();
    this.checking = true;
    const previous = this.release;
    this.set({ phase: 'checking', message: 'Yangilanish tekshirilmoqda…' });
    try {
      const { release } = await publicReleases(this.fetcher);
      this.release = candidate(release, this.current, this.platform);
      this.set(this.release ? { phase: 'available', version: this.release.version, availableBuild: this.release.sourceCommit, bytes: this.release.bytes, message: this.current.version === this.release.version ? `ILBI v${this.current.version} uchun yangi tuzatishlar chiqdi. Sizdagi nusxani yangilang.` : `Sizda ILBI v${this.current.version}. Yangi v${this.release.version} versiyasi chiqdi.` }
        : { phase: 'current', message: 'ILBI yangilangan.', progress: null });
      if (this.release && this.release.sourceCommit !== previous?.sourceCommit) this.emit('available', this.status());
    } catch (error) {
      this.release = previous;
      this.set({ phase: 'error', message: error.message });
    } finally { this.checking = false; }
    return this.status();
  }
  async update() {
    if (this.busy || this.state.phase === 'installing') return this.status();
    if (!this.release) await this.check();
    if (!this.release) return this.status();
    this.busy = true;
    const release = this.release;
    const path = join(this.cache, release.sourceCommit + '-' + release.name), partial = path + '.part';
    try {
      await mkdir(this.cache, { recursive: true, mode: 0o700 });
      try { await verifyFile(path, release); }
      catch {
        await rm(path, { force: true });
        this.set({ phase: 'downloading', progress: 0, downloaded: 0, message: 'Yangilanish yuklanmoqda. Ishlashda davom etishingiz mumkin.' });
        this.controller = new AbortController();
        const timer = setTimeout(() => this.controller.abort(), 15 * 60 * 1000); timer.unref?.();
        let file, reader;
        try {
          const response = await this.fetcher(release.url, { redirect: 'error', credentials: 'omit', cache: 'no-store', signal: this.controller.signal });
          if (!response.ok || !response.body) throw Error('Yangilanishni yuklab bo‘lmadi. Internetni tekshirib, qayta urinib ko‘ring.');
          file = await open(partial, 'w', 0o600); reader = response.body.getReader();
          let bytes = 0, lastUpdate = 0;
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            bytes += value.byteLength;
            if (bytes > release.bytes) throw Error('Yuklanayotgan paket hajmi noto‘g‘ri.');
            await file.writeFile(Buffer.from(value));
            if (Date.now() - lastUpdate > 150 || bytes === release.bytes) {
              this.set({ downloaded: bytes, progress: Math.min(99, Math.floor(bytes * 100 / release.bytes)) }); lastUpdate = Date.now();
            }
          }
          await file.sync();
        } finally { clearTimeout(timer); await reader?.cancel().catch(() => {}); await file?.close(); }
        this.set({ phase: 'verifying', progress: 100, message: 'Yuklangan paket tekshirilmoqda…' });
        await verifyFile(partial, release);
        await rename(partial, path);
      }
      this.set({ phase: 'preparing', progress: 100, message: 'Davom etayotgan ish tugashi kutilmoqda. So‘ng ILBI qayta ochiladi.' });
      await this.apply(path, release);
      this.set({ phase: 'installing', message: 'O‘rnatish oynasi ochildi. Yangilanishdan so‘ng ILBI avtomatik ochiladi.' });
    } catch (error) {
      await rm(partial, { force: true });
      this.set({ phase: 'error', progress: null, message: error.name === 'AbortError' ? 'Yuklash to‘xtadi. Internet tiklangach qayta urinib ko‘ring.' : error.message });
    } finally { this.busy = false; this.controller = null; }
    return this.status();
  }
  start() { this.initial = setTimeout(() => void this.check(), 8000); this.timer = setInterval(() => void this.check(), 15 * 60 * 1000); this.initial.unref?.(); this.timer.unref?.(); }
  stop() { clearTimeout(this.initial); clearInterval(this.timer); this.controller?.abort(); }
}
module.exports = { DesktopUpdater, candidate, verifyFile };
