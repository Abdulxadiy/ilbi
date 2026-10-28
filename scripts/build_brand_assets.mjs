// Generate deployable artwork from the same editable paths used by the ILBI intro.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { paths, glyphs } from '../frontend/ilbi/src/components/common/ilbi/logo.js';

const root = new URL('../', import.meta.url);
const target = new URL('frontend/ilbi/public/brand/', root);
await mkdir(target, { recursive: true });
const definitions = `<defs><linearGradient id="blue" x1="90" y1="5" x2="165" y2="266" gradientUnits="userSpaceOnUse"><stop stop-color="#0095ff"/><stop offset=".43" stop-color="#006bff"/><stop offset="1" stop-color="#0049ff"/></linearGradient><clipPath id="ribbon"><path d="${paths.ribbon}"/></clipPath></defs>`;
const mark = (mono = false) => `<g fill="${mono ? '#000' : '#141820'}"><path d="${paths.dot}"/><path d="${paths.stem}"/><path d="${paths.bowl}"/></g><path d="${paths.ribbon}" fill="${mono ? '#000' : 'url(#blue)'}"/>${mono ? '' : `<path d="${paths.ribbonFace}" fill="#006bff" clip-path="url(#ribbon)"/>`}<path d="${paths.ribbonTurn}" fill="${mono ? '#000' : '#0055ff'}"/>`;
const word = (mono = false) => glyphs.map(g => `<path d="${g.d}" transform="translate(${g.x} 0)" fill-rule="evenodd" fill="${mono ? '#000' : g.blue ? '#006bff' : '#141820'}"/>`).join('');
const svg = (viewBox, content) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="ilbi.uz">${definitions}${content}</svg>\n`;
const horizontal = svg('0 0 610 280', mark() + `<g transform="translate(310 103)">${word()}</g>`);
await writeFile(new URL('ilbi-logo.svg', target), horizontal);
await writeFile(new URL('ilbi-logo-mono.svg', target), svg('0 0 610 280', mark(true) + `<g transform="translate(310 103)">${word(true)}</g>`));
const icon = svg('0 0 280 280', mark());
await writeFile(new URL('ilbi-mark.svg', target), icon);
await writeFile(new URL('frontend/ilbi/public/favicon.svg', root), icon);

if (process.argv.includes('--png')) {
  const { launchBrowser } = await import('../branding/ilbi-motion-studio/scripts/browser.mjs');
  const browser = await launchBrowser();
  try {
    for (const [name, content, width, height, background] of [
      ['ilbi-logo-email.png', horizontal, 610, 280, null],
      ['ilbi-icon-512.png', icon, 512, 512, '#ffffff'],
      ['ilbi-icon-180.png', icon, 180, 180, '#ffffff'],
      ['ilbi-bot-avatar.jpg', icon, 512, 512, '#ffffff'],
    ]) {
      const data = await browser.evaluate(`(async () => {
        const svg = ${JSON.stringify(content)};
        const image = new Image();
        image.src = 'data:image/svg+xml;base64,' + btoa(svg);
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = ${width}; canvas.height = ${height};
        const context = canvas.getContext('2d');
        if (${JSON.stringify(background)}) { context.fillStyle = ${JSON.stringify(background)}; context.fillRect(0, 0, canvas.width, canvas.height); }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL(${JSON.stringify(name.endsWith('.jpg') ? 'image/jpeg' : 'image/png')}, 0.94).split(',')[1];
      })()`);
      const png = Buffer.from(data, 'base64');
      await writeFile(new URL(name, target), png);
      if (name === 'ilbi-logo-email.png') {
        const backend = new URL('backend/apps/core/brand/', root);
        await mkdir(backend, { recursive: true });
        await writeFile(new URL(name, backend), png);
      }
    }
  } finally { await browser.close(); }
}
console.log('ILBI brand assets generated:', fileURLToPath(target));
