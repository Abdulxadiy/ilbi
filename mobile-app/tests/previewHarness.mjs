import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchBrowser } from '../../frontend/ilbi/tests/browser/chrome.mjs';

/** Isolated Chrome profile; interacts with the development preview, never ADB or an installed app. */
export async function startPreview(name) {
  const base = process.env.MOBILE_PREVIEW_TEST_URL || 'http://127.0.0.1:8082';
  const evidence = new URL(`../docs/evidence/${name}/`, import.meta.url);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  await mkdir(evidence, { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(base + '/healthz')).ok) break; } catch {}
    if (attempt >= 120) throw Error('Isolated preview health check did not become ready');
    await pause(500);
  }
  const browser = await launchBrowser({ width: 1180, height: 1000 });
  const doc = "document.querySelector('#app')?.contentDocument";
  async function screenshot(filename) {
    // Native-style sheet transitions still animate after the content enters the DOM.
    await pause(450);
    const shot = await browser.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(new URL(filename + '.png', evidence), Buffer.from(shot.data, 'base64'));
  }
  async function waitFor(expression, label, attempts = 140) {
    for (let i = 0; i < attempts; i++) {
      if (await browser.evaluate(`Boolean(${doc}?.body && (${expression}))`)) return;
      await pause(150);
    }
    await screenshot('failure');
    throw Error('Timed out: ' + label + '; body: ' + await browser.evaluate(`${doc}?.body?.innerText.slice(0,1800)`));
  }
  async function click(label, role) {
    await pause(400);
    const point = await browser.evaluate(`(() => {
      const d = ${doc}, selector = ${JSON.stringify(role ? `[role="${role}"]` : 'button,[role="button"],a,[tabindex="0"]')};
      const nodes = [...d.querySelectorAll(selector)];
      const node = nodes.find(el => {
        if (el.innerText?.trim() !== ${JSON.stringify(label)} && el.getAttribute('aria-label') !== ${JSON.stringify(label)}) return false;
        if (el.closest('[aria-hidden="true"],[inert]')) return false;
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && el.contains(d.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
      });
      if (!node) throw Error('Button not found: ' + ${JSON.stringify(label)});
      const r = node.getBoundingClientRect(), frame = document.querySelector('#app').getBoundingClientRect();
      return { x: frame.x+r.x+r.width/2, y: frame.y+r.y+r.height/2 };
    })()`);
    await browser.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await browser.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
  async function fill(label, value) {
    await pause(400);
    await browser.evaluate(`(() => {
      const input = [...${doc}.querySelectorAll('input,textarea')].find(el => el.getAttribute('aria-label')===${JSON.stringify(label)} && !el.closest('[aria-hidden="true"],[inert]'));
      if (!input) throw Error('Input missing: ' + ${JSON.stringify(label)});
      input.focus(); input.select();
    })()`);
    await browser.call('Input.insertText', { text: value });
  }
  try {
    await browser.call('Page.navigate', { url: base + '/preview' });
    await waitFor(`${doc}.body.innerText.includes('Bugungi holat')`, 'preview home', 600);
    if (!await browser.evaluate(`${doc}.body.innerText.includes('DIZAYN PREVIEW')`)) throw Error('Explicit design preview is required');
    return { browser, doc, waitFor, click, fill, screenshot };
  } catch (error) { await browser.close(); throw error; }
}
