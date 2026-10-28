import assert from 'node:assert/strict';
import { access, chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const driver = process.env.ILBI_BROWSER_DRIVER_PATH ? pathToFileURL(process.env.ILBI_BROWSER_DRIVER_PATH) : new URL('./browser/chrome.mjs', import.meta.url);
const { launchBrowser } = await import(driver);
const candidates = [process.env.CHROME_PATH, '/opt/google/chrome/chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
let executable;
for (const path of candidates) { try { await access(path); executable = path; break; } catch {} }
assert.ok(executable, 'A real Chrome installation is required; these checks cannot be skipped');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const root = await mkdtemp(join(tmpdir(), 'ilbi-browser-launcher-'));
const previousPath = process.env.CHROME_PATH;
let browser;
try {
  for (const scenario of ['exit-once', 'timeout-once', 'exit-always']) {
    const marker = join(root, scenario + '.attempts');
    const shim = join(root, scenario + '.sh');
    await writeFile(shim, `#!/bin/sh
set -eu
profile=''
for arg in "$@"; do case "$arg" in --user-data-dir=*) profile="\${arg#--user-data-dir=}" ;; esac; done
first=false
test -f ${quote(marker)} || first=true
printf '%s\\t%s\\n' "$$" "$profile" >> ${quote(marker)}
if test ${quote(scenario)} = exit-always || { test "$first" = true && test ${quote(scenario)} = exit-once; }; then
  echo 'synthetic Chrome startup failure' >&2
  exit 31
fi
if test "$first" = true && test ${quote(scenario)} = timeout-once; then exec sleep 120; fi
exec ${quote(executable)} "$@"
`);
    await chmod(shim, 0o700);
    process.env.CHROME_PATH = shim;
    if (scenario === 'exit-always') {
      await assert.rejects(launchBrowser({ startupTimeoutMs: 3000 }), error => error.message.includes('after 2 attempts') && error.message.includes('Attempt 1: Chrome exited: 31') && error.message.includes('Attempt 2: Chrome exited: 31') && error.message.includes('synthetic Chrome startup failure'));
    } else {
      browser = await launchBrowser();
      assert.equal(await browser.evaluate('6 * 7'), 42, 'Retry must connect to a real browser');
      await browser.close(); browser = undefined;
    }
    const attempts = (await readFile(marker, 'utf8')).trim().split('\n').map(row => row.split('\t'));
    assert.equal(attempts.length, 2, 'Startup attempts are bounded');
    assert.notEqual(attempts[0][1], attempts[1][1], 'A retry uses a fresh isolated profile');
    for (const [pid, profile] of attempts) {
      await assert.rejects(access(profile), { code: 'ENOENT' }, 'Every profile is removed after failure or close');
      assert.throws(() => process.kill(Number(pid), 0), { code: 'ESRCH' }, 'Only the test browser process must be reaped');
    }
    console.log(`PASS ${scenario}: two attempts, ${scenario === 'exit-always' ? 'persistent failure is reported' : 'recovery connects to real Chrome'}, no test process/profile left behind.`);
  }
  const shim = join(root, 'not-executable');
  await writeFile(shim, '#!/bin/sh\nexit 0\n', { mode: 0o600 });
  process.env.CHROME_PATH = shim;
  await assert.rejects(launchBrowser({ startupTimeoutMs: 3000 }), /after 2 attempts:[\s\S]*EACCES/);
  console.log('PASS spawn failure: a non-executable browser fails with diagnostics, without an unhandled process error.');
} finally {
  await browser?.close();
  if (previousPath === undefined) delete process.env.CHROME_PATH; else process.env.CHROME_PATH = previousPath;
  await rm(root, { recursive: true, force: true });
}
