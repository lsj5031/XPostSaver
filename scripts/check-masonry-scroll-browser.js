// Offline native-shaped workload, not live X or a physical smoothness claim.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.XPS_PLAYWRIGHT);
const output = process.env.XPS_EVIDENCE || '/tmp/xps-scroll-evidence';
await mkdir(output, { recursive:true });
const label = process.argv.includes('--baseline') ? 'baseline' : 'fixed';
const html = (await readFile(new URL('../tests/fixtures/masonry-navigation.html', import.meta.url), 'utf8'))
  .replaceAll(' xopt-page-wide', '')
  .replace(/<div class="timeline">[\s\S]*?<\/section>/, '<div class="timeline"></div></section>')
  .replace('</style>', '.timeline{display:block;position:relative;padding:0}.cell{position:absolute;width:100%;top:0;left:0}.post{min-height:0} </style>');
const source = buildSync({ entryPoints:[new URL('../src/main.js', import.meta.url).pathname],
  bundle:true, write:false, format:'iife', loader:{ '.css':'text' } }).outputFiles[0].text;
const bundle = await readFile(new URL('../x-post-saver-enhanced.user.js', import.meta.url), 'utf8');
if (label === 'baseline') assert.match(bundle, /@version\s+0\.5\.17\b/,
  '--baseline labels a pre-repair .17 checkout, never the current fixed code');
const browser = await chromium.launch({ executablePath:process.env.XPS_CHROMIUM, headless:true,
  args:['--disable-background-networking'] });
const reports = [];
try {
  for (const [kind, original] of [['source', source], ['bundle', bundle]]) {
    for (const hints of [true, false]) {
      const name = `${label}-${kind}-${hints ? 'hints' : 'no-hints'}`;
      const context = await browser.newContext({ viewport:{ width:1440, height:900 }, serviceWorkers:'block' });
      await context.route('**/*', (route) => route.request().url() === 'https://x.com/home' ?
        route.fulfill({ contentType:'text/html', body:html }) : route.abort());
      await context.tracing.start({ screenshots:true, snapshots:true });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('https://x.com/home');
      await page.evaluate(() => {
        window.GM_getValue = () => undefined;
        window.GM_setValue = () => {};
        window.tabCalls = [];
        window.GM_openInTab = (url) => window.tabCalls.push(url);
        const timeline = document.querySelector('.timeline');
        const data = Array.from({ length:360 }, (_, i) => ({ item:{ id:`tweet-${i + 1}` }, id:i + 1, height:320, position:i * 320 }));
        let signature = '';
        window.nativeRefreshes = 0;
        window.moreCalls = 0;
        const scroller = {
          _getRenderCandidates() { return { allItemsWithPositions:data, newRenderedItems:data.slice(0, 16) }; },
          _handleScroll() {
            window.nativeRefreshes++;
            const result = this._getRenderCandidates();
            const next = result.newRenderedItems.map((entry) => entry.id).join();
            if (signature === next) return;
            signature = next;
            timeline.style.height = `${data.length * 320}px`;
            const old = new Map([...timeline.children].map((node) => [Number(node.dataset.id), node]));
            const cells = result.newRenderedItems.map(({ id }) => {
              if (old.has(id)) return old.get(id);
              const cell = document.createElement('div');
              cell.className = 'cell'; cell.dataset.id = id;
              cell.style.transform = `translateY(${(id - 1) * 320}px)`;
              cell.innerHTML = `<article class="post" role="article" data-testid="tweet" tabindex="0">
                <a href="/fixture/status/${id}"><time>Post ${id}</time></a>
                <div data-testid="tweetText"><p>Offline scroll fixture ${id}</p>${'<p>Variable height content</p>'.repeat(id % 4)}</div>
                <article class="quote" role="article" data-testid="tweet"><a href="/quoted/status/${10000 + id}"><time>Quote</time></a><p>Nested quote</p></article>
                <div class="delayed"></div><div role="group"><button data-testid="reply">Reply</button></div></article>`;
              return cell;
            });
            const wanted = new Set(cells);
            for (const node of [...timeline.children]) if (!wanted.has(node)) node.remove();
            cells.forEach((node, i) => { if (timeline.children[i] !== node) timeline.insertBefore(node, timeline.children[i] || null); });
          },
        };
        timeline.__reactFiber$fixture = { stateNode:scroller, memoizedProps:{ onNearBottom() {
          window.moreCalls++;
          if (!window.allowMore) return;
          window.allowMore = false;
          const start = data.length;
          data.push(...Array.from({ length:12 }, (_, i) => ({ item:{ id:`tweet-${start + i + 1}` }, id:start + i + 1, height:320, position:(start + i) * 320 })));
          scroller._handleScroll();
        } } };
        window.scrollFixture = { data, scroller };
        scroller._handleScroll();
        window.addEventListener('scroll', () => scroller._handleScroll(), { passive:true });
        window.metrics = {};
        const bump = (key) => { window.metrics[key] = (window.metrics[key] || 0) + 1; };
        for (const [object, method, key] of [
          [Element.prototype, 'getBoundingClientRect', 'rectReads'],
          [Element.prototype, 'getClientRects', 'rectListReads'],
          [Document.prototype, 'elementFromPoint', 'hitTests'],
          [CSSStyleDeclaration.prototype, 'setProperty', 'styleWrites'],
        ]) {
          const original = object[method];
          object[method] = function (...args) { bump(key); return original.apply(this, args); };
        }
        const timeout = window.setTimeout;
        window.setTimeout = (fn, delay, ...args) => timeout(() => {
          const start = performance.now();
          fn(...args);
          if (fn.name === 'apply') {
            bump('applyCalls');
            window.metrics.applyMs = (window.metrics.applyMs || 0) + performance.now() - start;
          }
        }, delay);
        const raf = window.requestAnimationFrame;
        window.requestAnimationFrame = (fn) => raf((time) => {
          const start = performance.now();
          fn(time);
          if (fn.name === 'reconcile') {
            bump('hintCalls');
            window.metrics.hintMs = (window.metrics.hintMs || 0) + performance.now() - start;
          }
        });
        new MutationObserver((records) => {
          bump('mutationDeliveries');
          for (const record of records) {
            bump(record.type === 'attributes' ? 'attributeMutations' : 'childMutations');
            if (record.target.closest?.('#xps-masonry-keys')) bump('badgeMutations');
          }
        }).observe(document.documentElement, { subtree:true, attributes:true, childList:true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) { bump('longTasks'); window.metrics.longTaskMs = (window.metrics.longTaskMs || 0) + entry.duration; }
        }).observe({ type:'longtask', buffered:false });
        window.frameLog = [];
        let previous = 0;
        function sample(time) {
          window.frameLog.push({ time, interval:previous ? time - previous : 0, y:scrollY,
            nodes:timeline.children.length,
            keys:[...document.querySelectorAll('.xps-masonry-key')].map((node) => [node.textContent, node.dataset.url]) });
          previous = time; raf(sample);
        }
        raf(sample);
      });
      const code = hints ? original : original.replace(/(?<!function )initMasonryHints\(\{[\s\S]*?openBackground: openBackgroundPost,?\s*\}\);/, '');
      await page.addScriptTag({ content:code });
      await page.waitForFunction(() => document.querySelector('.xps-masonry-container'), null, { timeout:5000 }).catch(async (error) => {
        console.error(name, errors, await page.locator('body').innerText());
        throw error;
      });
      await page.waitForTimeout(700);
      await page.screenshot({ path:`${output}/${name}-01-start.png` });
      await page.evaluate(() => { window.metrics = {}; window.frameLog = []; window.nativeRefreshes = 0; });
      // Identical deterministic wheel sequence in a real browser, including stop/start.
      await page.mouse.move(1100, 700);
      for (let i = 0; i < 48; i++) {
        await page.mouse.wheel(0, i < 32 ? 110 : -110);
        await page.waitForTimeout(20);
        if (i === 23) await page.screenshot({ path:`${output}/${name}-02-moving.png` });
        if (i === 31) await page.waitForTimeout(250);
      }
      await page.waitForTimeout(450);
      await page.screenshot({ path:`${output}/${name}-03-stopped.png` });
      const metrics = await page.evaluate(() => ({ ...window.metrics, nativeRefreshes:window.nativeRefreshes }));
      const frames = await page.evaluate(() => window.frameLog);
      if (label === 'fixed' && hints) {
        let previous = new Map();
        for (const frame of frames) {
          assert.ok(frame.keys.length > 0 && frame.keys.length <= 15, 'populated scroll frame has bounded labels');
          assert.equal(new Set(frame.keys.map(([key]) => key)).size, frame.keys.length);
          for (const [key,url] of frame.keys) {
            if (previous.has(url)) assert.equal(previous.get(url), key, 'surviving URL keeps its key during wheel reversals');
          }
          previous = new Map(frame.keys.map(([key,url]) => [url,key]));
        }
      }
      await writeFile(`${output}/${name}-frames.json`, JSON.stringify(frames));
      // Unchanged scroll notifications must not measure/rewrite every mounted card.
      await page.evaluate(() => { window.metrics = {}; window.nativeRefreshes = 0; });
      for (let i = 0; i < 12; i++) {
        await page.evaluate(() => dispatchEvent(new Event('scroll')));
        await page.waitForTimeout(75);
      }
      const unchanged = await page.evaluate(() => ({ ...window.metrics, nativeRefreshes:window.nativeRefreshes }));
      if (label === 'fixed') {
        assert.equal(unchanged.styleWrites || 0, 0, 'unchanged scroll never rewrites placement');
        assert.ok((unchanged.rectReads || 0) < 100, 'unchanged scroll does not measure every card');
        assert.equal(unchanged.childMutations || 0, 0, 'owned controls never rescan themselves in a mutation loop');
        assert.equal(unchanged.badgeMutations || 0, 0, 'no badge mutations on unchanged scroll');
        assert.equal(unchanged.hitTests || 0, 0, 'no badge hit tests on unchanged scroll');
        assert.equal(unchanged.nativeRefreshes, 12, 'only the fixture native listener handles unchanged scroll, no extra engine refresh');
        assert.equal((await page.locator('.xps-masonry-key').count()) > 0, hints);
        const prevented = await page.evaluate(() => {
          const event = new KeyboardEvent('keydown', { key:'1', bubbles:true, cancelable:true });
          document.body.dispatchEvent(event); return event.defaultPrevented;
        });
        assert.equal(prevented, hints);
        await page.keyboard.press('j');
        assert.equal(await page.evaluate(() => document.activeElement?.matches('article.post')), true);
        await page.keyboard.press('w');
        assert.equal(await page.evaluate(() => window.tabCalls.length), hints ? 2 : 1);
        await page.locator('.timeline').evaluate((node) => node.style.setProperty('width', '920px', 'important'));
        await page.waitForFunction(() => {
          const feed = document.querySelector('.timeline');
          const width = feed.clientWidth, columns = Math.max(1, Math.floor((width + 12) / 332));
          return width === 920 && Math.abs(feed.firstElementChild.getBoundingClientRect().width -
            (width - (columns - 1) * 12) / columns) < 1;
        });
        await page.locator('.timeline').evaluate((node) => node.style.removeProperty('width'));
        await page.waitForFunction(() => document.querySelector('.timeline').clientWidth > 920);
        await page.waitForTimeout(200);
      }
      // Delayed growth, recycled own identity, deep window, pagination, detail/back.
      await page.locator('.cell .delayed').first().evaluate((node) => { node.style.height = '230px'; });
      await page.waitForTimeout(300);
      const geometry = await page.locator('.cell').evaluateAll((nodes) => {
        const rects = nodes.map((node) => node.getBoundingClientRect());
        return { count:nodes.length, overlaps:rects.some((a, i) => rects.slice(i + 1).some((b) =>
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1)) };
      });
      assert.equal(geometry.overlaps, false);
      assert.ok(geometry.count <= 120);
      await page.evaluate(() => { document.querySelector('.cell article > a').href = '/fixture/status/99999'; });
      await page.waitForTimeout(150);
      await page.evaluate(() => { window.allowMore = true; scrollTo(0, document.body.scrollHeight); });
      await page.waitForFunction(() => window.scrollFixture.data.length === 372);
      await page.waitForTimeout(350);
      assert.ok(await page.locator('.cell').count() <= 120);
      for (const path of ['/fixture/status/1', '/home']) {
        await page.evaluate((path) => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path);
        await page.waitForFunction((active) => !!document.querySelector('.xps-masonry-container') === active, path === '/home');
      }
      assert.deepEqual(errors, []);
      reports.push({ name, metrics, unchanged, geometry, frames:frames.length,
        maxFrameInterval:Math.max(...frames.map((frame) => frame.interval)),
        maxNodes:Math.max(...frames.map((frame) => frame.nodes)), errors });
      await context.tracing.stop({ path:`${output}/${name}-trace.zip` });
      await context.close();
    }
  }
} finally {
  await writeFile(`${output}/${label}-results.json`, JSON.stringify(reports, null, 2));
  await browser.close();
}
console.log(JSON.stringify(reports, null, 2));
