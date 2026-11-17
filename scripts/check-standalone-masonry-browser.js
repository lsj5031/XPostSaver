// Offline integration. Only XPostSaver is injected, never upstream CSS/classes/JS.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';

const require = createRequire(import.meta.url);
for (const name of ['XPS_PLAYWRIGHT', 'XPS_CHROMIUM']) {
  if (!process.env[name]) throw new Error(`Set ${name} to an absolute local tool path.`);
}
const { chromium } = require(process.env.XPS_PLAYWRIGHT);
const output = process.env.XPS_EVIDENCE || '/tmp/xps-standalone-evidence';
await mkdir(output, { recursive: true });
const native = (await readFile(new URL('../tests/fixtures/masonry-navigation.html', import.meta.url), 'utf8'))
  .replaceAll(' xopt-page-wide', '')
  .replace(/<div class="timeline">[\s\S]*?<\/section>/, '<div class="timeline"></div></section>')
  .replace('</style>', `
  .timeline {display:block;position:relative;padding:0;gap:0}
  .cell{position:absolute;top:0;left:0;width:100%}
  .post{min-height:0;border-radius:12px;background:#101820}
  .quote{margin:12px 0 0;padding:12px;min-height:0;border:1px solid #5b8dba;background:#142635}
  img{display:block;max-width:100%} .post p{margin:12px 0}
  </style>`);
const source = buildSync({ entryPoints: [new URL('../src/main.js', import.meta.url).pathname],
  bundle:true, write:false, format:'iife', loader:{ '.css':'text' } }).outputFiles[0].text;
const bundle = await readFile(new URL('../x-post-saver-enhanced.user.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath:process.env.XPS_CHROMIUM, headless:true,
  args:['--disable-background-networking'] });
const reports = [], errors = [];

async function installFixture(page, mode = 'virtual') {
  await page.evaluate((mode) => {
    window.fixtureStorage = { xSavedPosts:'[]', xpsFactCheckTemplate:'Keep existing template' };
    window.GM_getValue = (key) => window.fixtureStorage[key];
    window.GM_setValue = (key, value) => { window.fixtureStorage[key] = value; };
    window.tabCalls = [];
    window.GM_openInTab = (url, options) => window.tabCalls.push({ url, options });
    window.open = () => { throw new Error('No active-tab fallback'); };
    let timeline = document.querySelector('.timeline');
    const data = Array.from({ length:60 }, (_, i) => ({ id:i + 1, top:i * 450, height:450 }));
    let signature = '', revision = 0;
    window.moreCalls = 0;
    window.allowMore = false;
    window.nativeClicks = [];
    document.addEventListener('click', (event) => {
      const control = event.target.closest('header a,header button');
      if (!control) return;
      event.preventDefault();
      window.nativeClicks.push(control.getAttribute('aria-label'));
      if (control.getAttribute('aria-label') === 'More') {
        const menu = document.createElement('div');
        menu.setAttribute('role', 'menu');
        menu.innerHTML = '<button role="menuitem">Native fixture menu</button>';
        document.body.append(menu);
      }
    });
    const scroller = {
      props: { list:data },
      _getIsHeightsReady() { return false; },
      _getRenderCandidates() {
        const start = Math.max(0, Math.floor((scrollY - timeline.offsetTop) / 450) - 2);
        const end = Math.min(data.length, start + 12);
        return { allItemsWithPositions:data, newRenderedItems:data.slice(start, end),
          slice:{ start, end }, arePreferredItemsRendered:true };
      },
      _handleScroll() {
        if (!timeline.isConnected) return;
        const result = this._getRenderCandidates();
        const next = result.newRenderedItems.map((item) => item.id).join(',') + ':' + revision;
        if (signature === next) return;
        signature = next;
        timeline.style.height = `${data.length * 450}px`;
        timeline.innerHTML = result.newRenderedItems.map(({ id, top }) => `
          <div class="cell" data-testid="cellInnerDiv" data-id="${id}" style="transform:translateY(${top}px)">
          <article class="post" role="article" data-testid="tweet" tabindex="0">
          <div data-testid="User-Name">Synthetic author ${id}</div>
          <a href="/fixture/status/${id}"><time>Post ${id}</time></a>
          <div data-testid="tweetText"><p>OWN TEXT ${id}. Offline fixture only.</p>
          ${'<p>Unequal-height synthetic content.</p>'.repeat(id % 4)}</div>
          <${mode === 'nested' || id % 2 ? 'article role="article" data-testid="tweet"' : 'div role="link"'} class="quote">
          <div data-testid="User-Name">Quoted synthetic author</div>
          <a href="/quoted/status/${10000 + id}"><time>Quote</time></a>
          <div data-testid="tweetText">QUOTED TEXT ${id}</div>
          ${id === 2 ? '<video controls width="220" height="90"></video>' : ''}
          </${mode === 'nested' || id % 2 ? 'article' : 'div'}>
          <div class="delayed"></div>
          <div role="group"><button data-testid="reply">Reply</button><button data-testid="like">Like</button></div>
          </article></div>`).join('');
      },
    };
    const nearBottom = () => {
      window.moreCalls++;
      if (!window.allowMore) return;
      window.allowMore = false;
      const n = data.length;
      data.push(...Array.from({ length:12 }, (_, i) => ({ id:n + i + 1, top:(n + i) * 450, height:450 })));
      scroller._handleScroll();
    };
    const original = scroller._getRenderCandidates;
    window.fixture = {
      scroller, original, data,
      replace() { revision++; scroller._handleScroll(); },
      replaceContainer() {
        const next = document.createElement('div');
        next.className = 'timeline';
        next.__reactFiber$fixture = timeline.__reactFiber$fixture;
        timeline.replaceWith(next);
        timeline = next;
        signature = '';
        scroller._handleScroll();
      },
      mount() { timeline.removeAttribute('hidden'); scroller._handleScroll(); },
    };
    if (mode === 'virtual' || mode === 'nested') timeline.__reactFiber$fixture = { stateNode:scroller, memoizedProps:{ onNearBottom:nearBottom }, return:null };
    scroller._handleScroll();
    if (mode === 'delayed') {
      timeline.replaceChildren();
      setTimeout(() => {
        timeline.__reactFiber$fixture = { stateNode:scroller, memoizedProps:{ onNearBottom:nearBottom }, return:null };
        signature = '';
        scroller._handleScroll();
      }, 600);
    }
    window.addEventListener('scroll', () => scroller._handleScroll(), { passive:true });
  }, mode);
}

async function settle(page) {
  await page.waitForFunction(() => document.querySelector('.xps-masonry-container'));
  await page.waitForTimeout(650);
}
async function measure(page, name) {
  const result = await page.evaluate(() => {
    const timeline = document.querySelector('.timeline'), primary = timeline.closest('[data-testid="primaryColumn"]');
    const rect = (node) => {
      const r = node.getBoundingClientRect();
      return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom };
    };
    const cells = [...timeline.children].map((node) => ({ id:node.dataset.id, ...rect(node) }));
    let overlaps = 0;
    for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i], b = cells[j];
      if (Math.min(a.right,b.right) - Math.max(a.x,b.x) > 1 &&
        Math.min(a.bottom,b.bottom) - Math.max(a.y,b.y) > 1) overlaps++;
    }
    const quotes = [...timeline.querySelectorAll('.quote')].map((q) => {
      const r = rect(q), parent = rect(q.closest('.cell'));
      return { text:q.textContent, clipped:r.bottom > parent.bottom + 1 || r.right > parent.right + 1 };
    });
    return { viewport:innerWidth, clientWidth:document.documentElement.clientWidth,
      scrollWidth:document.documentElement.scrollWidth, primary:rect(primary), feed:rect(timeline),
      columns:new Set(cells.map((c) => c.x)).size, cells, overlaps, quotes,
      visibleCells:cells.filter((c) => c.bottom > 0 && c.y < innerHeight).length,
      count:cells.length, badgeCount:document.querySelectorAll('.xps-masonry-key').length,
      total:window.fixture.data.length };
  });
  assert.equal(result.overlaps, 0, `${name}: overlapping cards`);
  assert.ok(result.quotes.every((q) => !q.clipped && q.text.includes('QUOTED TEXT')), `${name}: quotes intact`);
  assert.ok(result.scrollWidth <= result.clientWidth, `${name}: horizontal overflow`);
  reports.push({ name, ...result });
  await page.screenshot({ path:`${output}/${name}.png` });
  return result;
}
async function guarded(page, options = {}, selector = 'body') {
  const before = await page.evaluate(() => window.tabCalls.length);
  await page.locator(selector).first().evaluate((node, options) => {
    node.dispatchEvent(new KeyboardEvent('keydown', { key:'1', bubbles:true, cancelable:true, ...options }));
  }, options);
  assert.equal(await page.evaluate(() => window.tabCalls.length), before);
}
try {
  for (const [kind, code] of [['source',source], ['bundle',bundle]]) {
    const context = await browser.newContext({ viewport:{ width:1440, height:900 }, serviceWorkers:'block', reducedMotion:'reduce' });
    await context.route('**/*', (route) => route.request().url() === 'https://x.com/home'
      ? route.fulfill({ contentType:'text/html', body:native }) : route.abort());
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto('https://x.com/home');
    await installFixture(page);
    assert.equal(await page.locator('[class*="xopt"]').count(), 0);
    const baseline = await measure(page, `${kind}-01-before`);
    assert.equal(baseline.columns, 1);
    // Some managers supply grants as lexical bindings, not globalThis properties.
    // This verifies grant lookup, not a real manager/security boundary.
    await page.addScriptTag({ content:'window.bridgeReads=0; const unsafeWindow={get document(){window.bridgeReads++; return document;}};' });
    await page.addScriptTag({ content:code });
    await settle(page);
    assert.ok(await page.evaluate(() => window.bridgeReads > 0));
    for (const width of [1000,1440,1920,2560]) {
      await page.setViewportSize({ width, height:900 });
      await settle(page);
      const m = await measure(page, `${kind}-02-width-${width}`);
      assert.equal(m.primary.x, 0);
      assert.equal(m.primary.width, m.clientWidth);
      assert.ok(m.feed.width >= m.clientWidth - 2);
      assert.equal(m.columns, Math.floor((m.feed.width + 12) / 332));
      assert.ok(m.cells.every((c) => c.width >= 320), 'minimum card width');
      assert.ok(m.columns >= 3);
      assert.ok(new Set(m.cells.map((c) => c.height)).size > 1);
    }
    await page.setViewportSize({ width:1440, height:900 });
    await settle(page);
    await page.waitForFunction(() => document.querySelectorAll('.xps-masonry-key').length > 0);
    const badge = await page.locator('.xps-masonry-key').first().evaluate((n) => ({ key:n.textContent, url:n.dataset.url }));
    const before = await page.evaluate(() => { document.activeElement.blur(); return { scroll:scrollY, focus:document.activeElement.tagName }; });
    await page.keyboard.press(badge.key);
    assert.deepEqual(await page.evaluate(() => window.tabCalls), [{ url:badge.url, options:{ active:false, insert:true, setParent:true } }]);
    assert.ok(badge.url.includes('/fixture/status/'), 'own, not quoted, permalink');
    assert.deepEqual(await page.evaluate(() => ({ scroll:scrollY, focus:document.activeElement.tagName })), before);
    for (const options of [{ repeat:true }, { isComposing:true }, { keyCode:229 }, { ctrlKey:true }, { altKey:true }, { metaKey:true }, { shiftKey:true }]) await guarded(page, options);
    await guarded(page, {}, 'video');
    await page.evaluate(() => {
      const input = document.createElement('input'); document.body.append(input); input.focus();
    });
    await guarded(page, {}, 'input');
    await page.locator('input').evaluate((n) => n.remove());
    const toggle = page.locator('.xps-nav-toggle');
    await toggle.focus();
    await page.keyboard.press('Enter');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.getByRole('link', { name:'Home', exact:true }).evaluate((n) => n === document.activeElement), true);
    for (const name of ['Home','Profile','Post']) await page.getByRole('link', { name, exact:true }).click();
    await page.getByRole('button', { name:'More', exact:true }).click();
    await guarded(page);
    await page.getByRole('menuitem').click();
    await page.getByRole('menu').evaluate((n) => n.remove());
    await measure(page, `${kind}-03-drawer`);
    await page.keyboard.press('Escape');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await toggle.evaluate((n) => n === document.activeElement), true);
    assert.deepEqual(await page.evaluate(() => window.nativeClicks), ['Home','Profile','Post','More']);
    await page.evaluate(() => window.scrollTo(0, 0));
    await settle(page);
    const previousHeight = await page.locator('.cell').first().evaluate((n) => n.getBoundingClientRect().height);
    await page.locator('.delayed').first().evaluate((n) => {
      const image = document.createElement('img');
      image.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="280"><rect width="500" height="280" fill="steelblue"/></svg>');
      n.append(image);
    });
    await settle(page);
    assert.ok(await page.locator('.cell').first().evaluate((n) => n.getBoundingClientRect().height) > previousHeight);
    await measure(page, `${kind}-04-media`);
    await page.locator('video').evaluate((n) => { n.height = 240; });
    await settle(page);
    await measure(page, `${kind}-04b-video-size`);
    await page.evaluate(() => window.fixture.replace());
    await settle(page);
    await measure(page, `${kind}-05-replacement`);
    await page.evaluate(() => window.scrollTo(0, 4500));
    await settle(page);
    await measure(page, `${kind}-06-scroll`);
    await page.evaluate(() => { window.allowMore = true; window.scrollTo(0, Math.max(0, scrollY - 1000)); });
    await page.waitForTimeout(100);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForFunction(() => window.fixture.data.length === 72).catch(async (error) => {
      console.error(await page.evaluate(() => ({
        more:window.moreCalls, allowed:window.allowMore, total:window.fixture.data.length,
        scroll:scrollY, doc:document.documentElement.scrollHeight,
        feed:document.querySelector('.timeline').getBoundingClientRect().toJSON(),
        style:document.querySelector('.timeline').getAttribute('style'),
      })));
      throw error;
    });
    await settle(page);
    await measure(page, `${kind}-07-more`);
    await page.evaluate(() => {
      // A long already-loaded timeline must not force an ever-growing DOM prefix.
      const data = window.fixture.data;
      const n = data.length;
      data.push(...Array.from({ length:600 }, (_, i) => ({ id:n+i+1, top:(n+i)*450, height:450 })));
      window.fixture.scroller._handleScroll();
      window.scrollTo(0, 20000);
    });
    await settle(page);
    const bounded = await measure(page, `${kind}-08-bounded-scroll`);
    assert.ok(bounded.count <= 120);
    assert.ok(bounded.visibleCells >= bounded.columns, 'virtual window covers the visible viewport');
    assert.ok(Number(bounded.cells[0].id) > 1, 'not retaining the entire prefix');
    await page.evaluate(() => history.pushState({}, '', '/fixture/status/1'));
    await page.waitForFunction(() => !document.querySelector('.xps-masonry-container'));
    assert.equal(await page.evaluate(() => window.fixture.scroller._getRenderCandidates === window.fixture.original), true);
    assert.equal(await page.locator('.xps-nav-toggle, .xps-masonry-key').count(), 0);
    await page.screenshot({ path:`${output}/${kind}-09-detail.png` });
    await page.evaluate(() => { history.pushState({}, '', '/home'); window.scrollTo(0,0); });
    await settle(page);
    assert.equal(await page.locator('.xps-masonry-container').count(), 1);
    assert.equal(await page.locator('.xps-nav-toggle').count(), 1);
    await measure(page, `${kind}-10-detail-return`);
    await page.evaluate(() => window.fixture.replaceContainer());
    await settle(page);
    assert.equal(await page.locator('.xps-masonry-container').count(), 1);
    assert.equal(await page.locator('.xps-nav-toggle').count(), 1);
    await measure(page, `${kind}-11-container-return`);
    await page.locator('.xps-panel-toggle').click();
    await page.getByRole('button', { name:'Masonry: On', exact:true }).click();
    await page.waitForFunction(() => !document.querySelector('.xps-masonry-container'));
    assert.equal(await page.evaluate(() => window.fixture.scroller._getRenderCandidates === window.fixture.original), true);
    await page.getByRole('button', { name:'Masonry: Off', exact:true }).click();
    await settle(page);
    await page.locator('.xps-panel-toggle').click();
    await page.setViewportSize({ width:600, height:900 });
    await page.waitForFunction(() => !document.querySelector('.xps-masonry-container'));
    assert.equal(await page.evaluate(() => window.fixture.scroller._getRenderCandidates === window.fixture.original), true);
    await page.setViewportSize({ width:1440, height:900 });
    await settle(page);
    assert.deepEqual(await page.evaluate(() => window.fixtureStorage), {
      xSavedPosts:'[]', xpsFactCheckTemplate:'Keep existing template', xpsMasonryEnabled:true,
    });
    await context.close();
  }
  for (const mode of ['delayed','unsupported','nested']) {
    const context = await browser.newContext({ viewport:{ width:1440, height:900 } });
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.setContent(native);
    await installFixture(page, mode);
    await page.addScriptTag({ content:bundle });
    if (mode !== 'unsupported') {
      await settle(page);
      await measure(page, `bundle-12-${mode}`);
    }
    else {
      await page.waitForTimeout(800);
      assert.equal(await page.locator('.xps-masonry-container').count(), 0);
      assert.equal(await page.evaluate(() => window.fixture.scroller._getRenderCandidates === window.fixture.original), true);
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ browser:browser.version(), reports, errors,
    limits:'Offline synthetic React-shaped virtualizer/pagination. No live X or userscript manager validation.' }, null, 2));
  console.log(`Standalone source/bundle checks passed. Evidence: ${output}`);
} finally { await browser.close(); }
