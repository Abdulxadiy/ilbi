// Minimal CDP driver for isolated camera tests; no real camera permission is granted.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function stopChrome(child, profile) {
  if (child.pid && child.exitCode === null && child.signalCode === null) {
    child.kill();
    for (let i = 0; i < 30 && child.exitCode === null && child.signalCode === null; i++) await delay(50);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await new Promise(resolve => child.once('exit', resolve));
    }
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function startChrome(executable, args, startupTimeoutMs) {
  const failures = [];
  // Retry only browser startup. Never repeat or suppress a page assertion.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const profile = await mkdtemp(join(tmpdir(), 'ilbi-chrome-'));
    const child = spawn(executable, [...args, `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let startupLog = '', spawnError;
    child.on('error', error => { spawnError = error; });
    child.stderr.on('data', data => { startupLog = (startupLog + data.toString()).slice(-4000); });
    try {
      const deadline = Date.now() + startupTimeoutMs;
      while (Date.now() < deadline) {
        if (spawnError) throw spawnError;
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Chrome exited: ${child.exitCode ?? child.signalCode}`);
        let port;
        try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch {}
        if (Number.isInteger(port) && port > 0 && port <= 65535) return { child, profile, port };
        await delay(50);
      }
      throw new Error(`Chrome DevTools did not start within ${startupTimeoutMs}ms`);
    } catch (error) {
      await stopChrome(child, profile);
      failures.push(`Attempt ${attempt}: ${error.message}\n${startupLog}`);
      if (attempt === 1) console.warn(`Chrome startup failed; retrying with a fresh profile. ${error.message}`);
    }
  }
  throw new Error(`Chrome startup failed after 2 attempts:\n${failures.join('\n')}`);
}

export async function launchBrowser({ width = 1920, height = 1080, reducedMotion = false, disableBackForwardCache = false, startupTimeoutMs = 60000 } = {}) {
  if (!Number.isFinite(startupTimeoutMs) || startupTimeoutMs < 100 || startupTimeoutMs > 60000) throw new Error('Invalid Chrome startup timeout');
  const candidates = [process.env.CHROME_PATH, '/opt/google/chrome/chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  let executable;
  for (const path of candidates) { try { await access(path); executable = path; break; } catch {} }
  if (!executable) throw new Error('Chrome/Chromium topilmadi. CHROME_PATH orqali uning manzilini bering.');
  // Each profile is disposable and contains synthetic test data. Avoid OS
  // keyring/first-run services and background downloads on headless CI hosts.
  // https://github.com/GoogleChrome/chrome-launcher/blob/main/docs/chrome-flags-for-tools.md
  const { child, profile, port } = await startChrome(executable, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--disable-sync', '--metrics-recording-only', '--password-store=basic', '--use-mock-keychain', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none', '--remote-debugging-port=0', `--disable-features=MediaRouter,OptimizationHints,NetworkTimeServiceQuerying${disableBackForwardCache ? ',BackForwardCache' : ''}`, `--window-size=${width},${height}`], startupTimeoutMs);
  let socket;
  try {
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let sequence = 0;
    const waiting = new Map();
    const errors = [];
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.id && waiting.has(message.id)) {
        const { resolve, reject, timer } = waiting.get(message.id);
        waiting.delete(message.id); clearTimeout(timer);
        if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
      }
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') errors.push(message.params.entry.text);
      if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) errors.push(`${message.params.response.status} ${message.params.response.url}`);
    });
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
      waiting.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    await call('Page.enable'); await call('Runtime.enable'); await call('Log.enable'); await call('Network.enable');
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    if (reducedMotion) await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    return {
      call, evaluate, errors,
      async resize(width, height) { await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); },
      async close() {
        socket.close();
        for (const { reject, timer } of waiting.values()) { clearTimeout(timer); reject(new Error('Browser closed')); }
        await stopChrome(child, profile);
      },
    };
  } catch (error) {
    socket?.close();
    await stopChrome(child, profile);
    throw error;
  }
}
