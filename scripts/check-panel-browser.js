// Optional offline panel fixture. Uses existing local tools, never a live X account.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';

const require = createRequire(import.meta.url);
for (const name of ['XPS_PLAYWRIGHT', 'XPS_CHROMIUM']) {
  if (!process.env[name]) throw new Error(`Set ${name} to an absolute local tool path (see README).`);
}
const { chromium } = require(process.env.XPS_PLAYWRIGHT);
const output = process.env.XPS_EVIDENCE || '/tmp/xps-circle-evidence';
await mkdir(output, { recursive: true });
const source = buildSync({ entryPoints: [new URL('../src/main.js', import.meta.url).pathname], bundle: true, write: false, format: 'iife', loader: { '.css': 'text' } }).outputFiles[0].text;
const bundle = await readFile(new URL('../x-post-saver-enhanced.user.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.XPS_CHROMIUM, headless: true, args: ['--disable-background-networking'] });
const context = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
const requests = [];
await context.route('**/*', async (route) => {
  requests.push(route.request().url());
  await route.abort();
});
const measurements = [];
const initialStorage = {
  xSavedPosts: JSON.stringify([{ id: '123', url: 'https://x.com/person/status/123', text: 'Saved offline fixture' }]),
  xpsFactCheckTemplate: 'Existing custom template',
};
const html = `<base href="https://x.com/"><style>
body{margin:0;background:#f7f9fa;color:#25303a;font:16px sans-serif}
main{max-width:600px;margin:auto;min-height:2400px;background:white;border:1px solid #ddd}
header{padding:24px;border-bottom:1px solid #ddd}article{padding:24px;border-bottom:1px solid #ddd}
</style><main data-testid="primaryColumn"><header>Offline XPostSaver panel fixture</header>
${Array.from({ length: 8 }, (_, i) => `<article tabindex="0" style="min-height:180px"><a href="/person/status/${i + 1}"><time>Fixture post ${i + 1}</time></a><p>Local content, no live account or network actions.</p><div role="group"><button data-testid="reply">Reply</button><button data-testid="like">Like</button></div></article>`).join('')}</main>`;

async function fixture(code, viewport, storage = initialStorage) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.setContent(html);
  await page.evaluate((seed) => {
    window.fixtureStorage = { ...seed };
    window.GM_getValue = (key) => window.fixtureStorage[key];
    window.GM_setValue = (key, value) => { window.fixtureStorage[key] = value; };
    window.copies = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { window.copies.push(text); } } });
  }, storage);
  await page.addScriptTag({ content: code });
  await page.locator('.xps-save-btn').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  return page;
}

async function capture(page, name, expanded) {
  const result = await page.evaluate(() => {
    const panel = document.querySelector('#xps-panel');
    const toggle = panel.querySelector('.xps-panel-toggle');
    const rect = panel.getBoundingClientRect();
    return {
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
      viewport: { width: innerWidth, height: innerHeight },
      expanded: toggle.getAttribute('aria-expanded'), label: toggle.getAttribute('aria-label'),
      focus: document.activeElement.className,
      visibleControls: [...panel.querySelectorAll('button')].filter((button) => button.getClientRects().length).map((button) => button.getAttribute('aria-label') || button.textContent),
      storage: window.fixtureStorage, copies: window.copies, scrollY,
    };
  });
  assert.equal(result.expanded, String(expanded));
  const { bounds: r, viewport: v } = result;
  assert.ok(r.x >= 8 && r.y >= 8 && r.right <= v.width - 7 && r.bottom <= v.height - 7, `${name}: panel within viewport`);
  assert.equal(result.visibleControls.length, expanded ? 8 : 1);
  if (!expanded) {
    assert.equal(r.width, 36);
    assert.equal(r.height, 36);
  }
  assert.equal(result.storage.xSavedPosts, initialStorage.xSavedPosts);
  assert.equal(result.storage.xpsFactCheckTemplate, initialStorage.xpsFactCheckTemplate);
  measurements.push({ name, ...result });
  await page.screenshot({ path: `${output}/${name}.png` });
  return result;
}

try {
  for (const [kind, code] of [['source', source], ['bundle', bundle]]) {
    for (const [layout, viewport] of [['desktop', { width: 1280, height: 800 }], ['narrow', { width: 320, height: 640 }]]) {
      const prefix = `${kind}-${layout}`;
      let page = await fixture(code, viewport);
      const toggle = () => page.locator('.xps-panel-toggle');
      await capture(page, `${prefix}-01-collapsed`, false);
      // Collapsed controls cannot receive keyboard focus.
      await toggle().focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('#xps-panel > button:not(.xps-panel-toggle)').evaluateAll((buttons) => buttons.some((button) => button === document.activeElement)), false);
      await toggle().click();
      await capture(page, `${prefix}-02-expanded`, true);
      await page.getByRole('button', { name: 'Copy URLs', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.copies), ['https://x.com/person/status/123\n']);
      await toggle().click();
      const collapsed = await capture(page, `${prefix}-03-collapsed`, false);
      assert.equal(collapsed.focus, 'xps-panel-toggle');

      await page.keyboard.press('Enter');
      assert.equal(await toggle().getAttribute('aria-expanded'), 'true');
      await page.keyboard.press('Space');
      assert.equal(await toggle().getAttribute('aria-expanded'), 'false');
      await capture(page, `${prefix}-03b-keyboard-focus`, false);
      assert.equal(await toggle().evaluate((button) => getComputedStyle(button).outlineStyle), 'solid');
      await page.keyboard.press('Space');
      assert.equal(await toggle().getAttribute('aria-expanded'), 'true');
      assert.equal(await page.evaluate(() => scrollY), 0, 'toggle Space does not page');
      const grip = await page.getByRole('button', { name: 'Move panel', exact: true }).boundingBox();
      const start = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x - 30, 150, { steps: 8 });
      await page.mouse.up();
      const dragged = await capture(page, `${prefix}-04-keyboard-and-drag`, true);
      const saved = JSON.parse(dragged.storage.xpsPanelPosition);
      assert.equal(saved.x, dragged.bounds.x);
      assert.equal(saved.y, dragged.bounds.y);
      await page.close();
      page = await fixture(code, viewport, dragged.storage);
      const reloaded = await capture(page, `${prefix}-05-reload-position`, false);
      assert.equal(reloaded.bounds.x, saved.x);
      assert.equal(reloaded.bounds.y, saved.y);
      await page.close();

      page = await fixture(code, viewport, { ...initialStorage, xpsPanelPosition: JSON.stringify({ x: viewport.width - 10, y: viewport.height - 10 }) });
      await capture(page, `${prefix}-06-stored-edge-circle`, false);
      await toggle().click();
      await capture(page, `${prefix}-07-stored-edge-expanded`, true);
      await page.setViewportSize({ width: 240, height: 320 });
      await page.waitForTimeout(100);
      await capture(page, `${prefix}-08-resize-expanded`, true);
      await toggle().click();
      await capture(page, `${prefix}-09-resize-collapsed`, false);
      await page.close();
    }
  }
  // Clean side-by-side preview from the actual desktop screenshots, no image dependency.
  const preview = await context.newPage();
  await preview.setViewportSize({ width: 1300, height: 240 });
  const images = await Promise.all(['bundle-desktop-01-collapsed', 'bundle-desktop-02-expanded'].map(async (name) =>
    (await readFile(`${output}/${name}.png`)).toString('base64')));
  await preview.setContent(`<style>body{margin:0;background:#f7f9fa;font:16px sans-serif;display:flex;gap:20px}section{width:640px}h3{margin:16px}div{height:180px;position:relative;overflow:hidden}img{width:1280px;height:800px;position:absolute;right:0;bottom:0}</style>${images.map((image, i) => `<section><h3>${i ? 'Expanded toolbar' : 'Default circle'}</h3><div><img src="data:image/png;base64,${image}"></div></section>`).join('')}`);
  await preview.screenshot({ path: `${output}/preview.png` });
  await writeFile(`${output}/measurements.json`, JSON.stringify({ measurements, blockedRequests: requests }, null, 2));
  console.log(`Passed ${measurements.length} panel captures: source/bundle, desktop/narrow, keyboard, copy, drag/reload, edge and resize. Evidence: ${output}`);
} finally {
  await browser.close();
}
