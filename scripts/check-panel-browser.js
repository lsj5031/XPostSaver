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
      visibleControls: [...panel.querySelectorAll('button, select')].filter((control) => control.getClientRects().length).map((control) => control.getAttribute('aria-label') || control.textContent),
      storage: window.fixtureStorage, copies: window.copies, scrollY,
    };
  });
  assert.equal(result.expanded, String(expanded));
  const { bounds: r, viewport: v } = result;
  assert.ok(r.x >= 8 && r.y >= 8 && r.right <= v.width - 7 && r.bottom <= v.height - 7, `${name}: panel within viewport`);
  assert.equal(result.visibleControls.length, expanded ? 10 : 1);
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
      await page.evaluate(() => {
        window.expansions = 0;
        new MutationObserver((records) => {
          window.expansions += records.filter((record) => record.oldValue === 'false').length;
        }).observe(document.querySelector('.xps-panel-toggle'), { attributes: true, attributeFilter: ['aria-expanded'], attributeOldValue: true });
      });
      const circle = await toggle().boundingBox();
      const circleStart = { x: circle.x + 18, y: circle.y + 18 };
      await page.mouse.move(circleStart.x, circleStart.y);
      await page.mouse.down();
      await page.mouse.move(circleStart.x - 70, circleStart.y - 100, { steps: 8 });
      const during = await capture(page, `${prefix}-01a-during-circle-drag`, false);
      assert.equal(await page.locator('#xps-panel').getAttribute('data-dragging'), '1');
      assert.equal(during.bounds.x, circle.x - 70);
      assert.equal(during.bounds.y, circle.y - 100);
      await page.mouse.up();
      const circleDragged = await capture(page, `${prefix}-01b-after-circle-drag`, false);
      assert.equal(await page.evaluate(() => window.expansions), 0, 'pointerup must never expand');
      assert.equal(await page.locator('#xps-panel').getAttribute('data-dragging'), null);
      const circleSaved = JSON.parse(circleDragged.storage.xpsPanelPosition);
      assert.deepEqual(circleSaved, { x: circleDragged.bounds.x, y: circleDragged.bounds.y });
      await toggle().click();
      await capture(page, `${prefix}-01c-next-click-expanded`, true);
      assert.equal(await page.evaluate(() => window.expansions), 1);
      await toggle().click();
      await page.close();
      page = await fixture(code, viewport, circleDragged.storage);
      const circleReloaded = await capture(page, `${prefix}-01d-circle-drag-reload`, false);
      assert.equal(circleReloaded.bounds.x, circleSaved.x);
      assert.equal(circleReloaded.bounds.y, circleSaved.y);
      const jitter = await toggle().boundingBox();
      await page.mouse.move(jitter.x + 18, jitter.y + 18);
      await page.mouse.down();
      await page.mouse.move(jitter.x + 21, jitter.y + 20);
      await page.mouse.up();
      await capture(page, `${prefix}-01e-jitter-opens`, true);
      await toggle().click();
      await toggle().focus();
      const beforeArrow = await toggle().boundingBox();
      await page.keyboard.press('ArrowLeft');
      assert.equal(await page.locator('#xps-panel').evaluate((panel) => panel.getBoundingClientRect().x), Math.max(8, beforeArrow.x - 16));
      // Synthetic touch/pen lifecycle coverage, not a claim of physical-device input.
      for (const pointerType of ['touch', 'pen']) {
        for (const ending of ['pointercancel', 'lostpointercapture']) {
          await toggle().evaluate((button, { pointerType, ending }) => {
            const rect = button.getBoundingClientRect();
            const send = (type, x, extra = {}) => button.dispatchEvent(new PointerEvent(type, {
              pointerId: 77, pointerType, isPrimary: true, button: 0,
              clientX: x, clientY: rect.y + 18, bubbles: true, ...extra,
            }));
            // Untrusted events cannot acquire real pointer capture; stub only that API.
            const capture = button.setPointerCapture;
            button.setPointerCapture = () => {};
            send('pointerdown', rect.x + 18, { isPrimary: false });
            send('pointermove', rect.x + 60);
            if (button.parentElement.dataset.dragging) throw new Error('nonprimary drag');
            send('pointerdown', rect.x + 18);
            send('pointermove', rect.x + 28);
            if (button.parentElement.dataset.dragging !== '1') throw new Error('missing synthetic drag');
            send(ending, rect.x + 28);
            if (button.parentElement.dataset.dragging) throw new Error('stuck synthetic drag');
            button.setPointerCapture = capture;
          }, { pointerType, ending });
          assert.equal(await toggle().getAttribute('aria-expanded'), 'false');
        }
      }
      assert.equal(await toggle().evaluate((button) => getComputedStyle(button).touchAction), 'none');
      // Real mouse capture with both viewport extremes.
      for (const [edge, x, y] of [['top-left', -100, -100], ['bottom-right', viewport.width + 100, viewport.height + 100]]) {
        const rect = await toggle().boundingBox();
        await page.mouse.move(rect.x + 18, rect.y + 18);
        await page.mouse.down();
        await page.mouse.move(x, y, { steps: 5 });
        await page.mouse.up();
        const clamped = await capture(page, `${prefix}-01f-${edge}`, false);
        assert.equal(clamped.bounds.x, edge === 'top-left' ? 8 : viewport.width - 44);
        assert.equal(clamped.bounds.y, edge === 'top-left' ? 8 : viewport.height - 44);
      }
      // Collapsed controls cannot receive keyboard focus.
      await toggle().focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('#xps-panel > [hidden]').evaluateAll((controls) => controls.some((control) => control === document.activeElement)), false);
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
