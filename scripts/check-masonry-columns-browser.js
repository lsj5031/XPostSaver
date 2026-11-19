// Offline Chrome check. Only XPostSaver owns masonry; the fixture starts one-column.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';

for (const name of ['XPS_PLAYWRIGHT', 'XPS_CHROMIUM']) {
  if (!process.env[name]) throw new Error(`Set ${name} to an absolute local tool path (see README).`);
}
const { chromium } = createRequire(import.meta.url)(process.env.XPS_PLAYWRIGHT);
const output = process.env.XPS_EVIDENCE || '/tmp/xps-columns-evidence';
await mkdir(output, { recursive:true });
const source = buildSync({ entryPoints:[new URL('../src/main.js', import.meta.url).pathname],
  bundle:true, write:false, format:'iife', loader:{ '.css':'text' } }).outputFiles[0].text;
const bundle = await readFile(new URL('../x-post-saver-enhanced.user.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath:process.env.XPS_CHROMIUM, headless:true,
  args:['--disable-background-networking'] });
const fixture = 'http://xps.test/home';
const key = 'xpsMasonryMaxColumns';
const desktop = { width:1440, height:900 };
const results = [];

async function measure(page, expected, name, screenshot = false) {
  await page.waitForFunction((count) => {
    const panel = document.querySelector('#xps-panel').getBoundingClientRect();
    if (panel.left < 7 || panel.right > innerWidth - 7) return false; // wait for resize clamping
    const cards = [...document.querySelectorAll('.timeline > .xps-masonry-item')];
    return count === 0 ? !document.querySelector('.xps-masonry-container') :
      new Set(cards.map((card) => card.getBoundingClientRect().x)).size === count;
  }, expected);
  const result = await page.evaluate(() => {
    const rect = (node) => node.getBoundingClientRect().toJSON();
    const panel = document.querySelector('#xps-panel');
    const timeline = document.querySelector('.timeline');
    const cards = [...timeline.children].map((card) => ({ id:Number(card.dataset.id), ...rect(card) }));
    return { viewport:innerWidth, scrollY, feed:rect(timeline), panel:rect(panel), panelClient:panel.clientWidth,
      panelScroll:panel.scrollWidth, choice:panel.querySelector('select').value,
      columns:[...new Set(cards.map(({ x }) => x))].sort((a, b) => a - b),
      cards, nativeSlice:window.fixture?.slice, refreshes:window.fixture?.refreshes };
  });
  assert.equal(result.columns.length, expected || 1, `${name}: rendered columns`);
  assert.ok(result.panel.x >= 7 && result.panel.right <= result.viewport - 7, `${name}: panel in viewport`);
  assert.equal(result.panelScroll, result.panelClient, `${name}: panel fits without horizontal scrolling`);
  for (const [i, a] of result.cards.entries()) {
    assert.ok(a.right <= result.feed.right + 1, `${name}: card within feed`);
    for (const b of result.cards.slice(i + 1)) {
      assert.ok(Math.min(a.right, b.right) - Math.max(a.x, b.x) < 1 ||
        Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) < 1, `${name}: cards ${a.id} and ${b.id} overlap`);
    }
  }
  if (result.nativeSlice) {
    assert.ok(result.cards.length <= 120, `${name}: mounted list is bounded`);
    assert.equal(result.cards[0].id, result.nativeSlice.start + 1, `${name}: mounted window follows native demand`);
  }
  results.push({ name, ...result, cards:result.cards.length });
  if (screenshot) await page.screenshot({ path:`${output}/${name}.png` });
  return result;
}

try {
  console.log(`Chrome ${browser.version()}; offline fixture, source and built userscript`);
  for (const [kind, code] of [['source', source], ['bundle', bundle]]) {
    for (const mode of ['flow', 'native-scroller']) {
      const prefix = `${kind}-${mode}`;
      const context = await browser.newContext({ viewport:desktop, serviceWorkers:'block', reducedMotion:'reduce' });
      const blocked = [], errors = [];
      await context.route('**/*', async (route) => {
        if (route.request().url() !== fixture) {
          blocked.push(route.request().url());
          return route.abort();
        }
        await route.fulfill({ contentType:'text/html', body:`<!doctype html><meta charset="utf-8">
          <style>
            *{box-sizing:border-box} body{margin:0;background:#0b1017;color:#e7eef7;font:16px system-ui}
            h1{font-size:22px;margin:0;padding:16px 24px;color:#a8c1da}
            main{padding:0 20px}.timeline{position:relative}
            article{width:100%;padding:16px 18px;border:1px solid #334962;border-radius:12px;background:#141f2d}
            article h2{font-size:17px;margin:0} article p{color:#bfcedd} article a{color:#70c5f0}
            article button{color:inherit;background:#20364b;border:1px solid #405d78;border-radius:8px;padding:4px 10px}
          </style><h1>Offline XPostSaver fixture · ${mode}</h1>
          <main data-testid="primaryColumn"><section class="timeline"></section></main>` });
      });
      await context.addInitScript(({ mode, code }) => {
        window.GM_getValue = (name, fallback) => JSON.parse(localStorage.getItem(`fixture:${name}`)) ?? fallback;
        window.GM_setValue = (name, value) => localStorage.setItem(`fixture:${name}`, JSON.stringify(value));
        window.addEventListener('DOMContentLoaded', () => {
          const timeline = document.querySelector('.timeline');
          const native = mode === 'native-scroller';
          // Native single-column slots must also fit the narrowest fixture.
          const rowHeight = 500;
          const entries = Array.from({ length:native ? 180 : 20 }, (_, i) => ({ id:i + 1, position:i * rowHeight, height:rowHeight }));
          const cell = ({ id, position }) => {
            const node = document.createElement('div');
            node.dataset.id = id;
            if (native) node.style.cssText = `position:absolute;left:0;top:0;width:100%;transform:translateY(${position}px)`;
            node.innerHTML = `<article data-testid="tweet" role="article"><h2>Fixture post ${id}</h2>
              <a href="https://x.com/fixture/status/${id}"><time>@fixture · ${id}</time></a>
              <div data-testid="tweetText"><p>${'Local sample text for responsive card geometry. '.repeat(2 + id % 3)}</p></div>
              <div role="group"><button data-testid="reply">Reply</button> <button data-testid="like">Like</button></div></article>`;
            return node;
          };
          if (!native) { timeline.append(...entries.map(cell)); return; }
          const scroller = window.fixture = {
            refreshes:0,
            _getRenderCandidates() {
              const start = Math.max(0, Math.floor((scrollY - timeline.offsetTop) / rowHeight) - 2);
              const end = Math.min(entries.length, start + 12);
              return { allItemsWithPositions:entries, newRenderedItems:entries.slice(start, end), slice:{ start, end } };
            },
            _handleScroll() {
              this.refreshes++;
              const { newRenderedItems, slice } = this._getRenderCandidates();
              if (this.slice?.start === slice.start && this.slice?.end === slice.end) return;
              this.slice = slice;
              const mounted = new Map([...timeline.children].map((node) => [Number(node.dataset.id), node]));
              timeline.replaceChildren(...newRenderedItems.map((entry) => mounted.get(entry.id) ?? cell(entry)));
            },
          };
          timeline.style.height = `${entries.length * rowHeight}px`;
          timeline.__reactFiber$fixture = { stateNode:scroller, memoizedProps:{ onNearBottom() {} } };
          scroller._handleScroll();
          window.addEventListener('scroll', () => scroller._handleScroll(), { passive:true });
        });
        window.addEventListener('DOMContentLoaded', () => {
          const script = document.createElement('script');
          script.textContent = code;
          document.body.append(script);
        });
      }, { mode, code });

      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(fixture);
      const expand = page.getByRole('button', { name:'Expand X Post Saver panel' });
      const collapse = page.getByRole('button', { name:'Collapse X Post Saver panel' });
      const columns = page.getByRole('combobox', { name:'Maximum masonry columns' });
      const loadCount = () => page.evaluate((key) => GM_getValue(key, null), key);
      assert.equal(await columns.count(), 0, 'collapsed control is excluded from the accessibility tree');
      await expand.press('Enter');
      assert.equal(await columns.inputValue(), 'Auto');
      await page.locator('.xps-save-btn').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      const auto = await measure(page, 4, `${prefix}-auto`, true);
      // Reverse Tab from Collapse reaches the adjacent native select.
      await page.keyboard.press('Shift+Tab');
      assert.ok(await columns.evaluate((node) => document.activeElement === node));
      assert.equal(await columns.evaluate((node) => getComputedStyle(node).outlineStyle), 'solid');
      await columns.selectOption('2');
      assert.equal(await columns.inputValue(), '2');
      assert.equal(await loadCount(), 2);
      const capped = await measure(page, 2, `${prefix}-max-2`, true);
      assert.equal(capped.feed.width, auto.feed.width, 'selection reflows a same-width feed');
      assert.equal(capped.panel.x, auto.panel.x, 'changing the select does not move the panel');

      if (mode === 'native-scroller') {
        const demand = async (count, label) => {
          await page.evaluate(() => { window.scrollTo(0, 6000); window.fixture._handleScroll(); });
          const settled = await measure(page, count, `${prefix}-scrolled-${label}`);
          assert.ok(settled.cards.some((card) => card.bottom > 0 && card.y < 900), 'scrolled window must contain visible cards');
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForFunction(() => window.fixture.slice.start === 0);
          return settled.nativeSlice.start;
        };
        const cappedStart = await demand(2, '2');
        await columns.selectOption('Auto');
        await measure(page, 4, `${prefix}-reset`);
        const autoStart = await demand(4, 'auto');
        assert.ok(autoStart > cappedStart + 20, 'native demand reaches later entries at the same scroll depth with more columns');
      }

      await columns.selectOption('3');
      await measure(page, 3, `${prefix}-max-3`);
      await page.setViewportSize({ width:960, height:720 });
      await measure(page, 2, `${prefix}-responsive`);
      assert.equal(await columns.inputValue(), '3');
      assert.equal(await loadCount(), 3);
      await page.setViewportSize({ width:320, height:640 });
      await measure(page, 0, `${prefix}-narrow`, kind === 'bundle' && mode === 'flow');
      for (const width of [265, 264, 241, 240]) {
        await page.setViewportSize({ width, height:640 });
        await measure(page, 0, `${prefix}-${width}`);
      }
      await page.setViewportSize(desktop);
      await measure(page, 3, `${prefix}-wide-again`);

      await page.getByRole('button', { name:'Masonry: On' }).click();
      await measure(page, 0, `${prefix}-off`);
      await columns.selectOption('1');
      assert.equal(await loadCount(), 1);
      assert.equal(await page.getByRole('button', { name:'Masonry: Off' }).count(), 1);
      await collapse.press('Space');
      assert.ok(await expand.evaluate((button) => document.activeElement === button));
      assert.equal(await columns.count(), 0);
      await page.reload();
      await expand.click();
      assert.equal(await columns.inputValue(), '1');
      assert.equal(await page.getByRole('button', { name:'Masonry: Off' }).count(), 1);
      await page.getByRole('button', { name:'Masonry: Off' }).click();
      await measure(page, 1, `${prefix}-reload-and-on`);
      await columns.selectOption('Auto');
      await measure(page, 4, `${prefix}-auto-again`);
      await page.reload();
      await expand.click();
      assert.equal(await columns.inputValue(), 'Auto');
      assert.equal(await loadCount(), 'auto');
      await measure(page, 4, `${prefix}-auto-reload`);

      // Set an invalid stored value before initialization, then ensure it stays
      // Auto without rewriting the stored value or disturbing the enabled flag.
      await page.evaluate((key) => GM_setValue(key, '2.5'), key);
      await page.reload();
      await expand.click();
      assert.equal(await columns.inputValue(), 'Auto');
      assert.equal(await loadCount(), '2.5');
      await measure(page, 4, `${prefix}-invalid-storage`);
      assert.deepEqual(errors, []);
      assert.deepEqual(blocked, []);
      await context.close();
      console.log(`PASS ${prefix}`);
    }
  }
  await writeFile(`${output}/measurements.json`, JSON.stringify({ chrome:browser.version(), results }, null, 2));
} finally {
  await browser.close();
}
