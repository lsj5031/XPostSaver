// Offline native-shaped integration fixture, never a live account/upstream runtime.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';

const require = createRequire(import.meta.url);
for (const name of ['XPS_PLAYWRIGHT', 'XPS_CHROMIUM']) {
  if (!process.env[name]) throw new Error(`Set ${name} to an absolute local tool path.`);
}
const { chromium } = require(process.env.XPS_PLAYWRIGHT);
const output = `${process.env.XPS_EVIDENCE || '/tmp/xps-masonry-sidebar-evidence'}/v2`;
await mkdir(output, { recursive: true });
const html = await readFile(new URL('../tests/fixtures/masonry-navigation.html', import.meta.url), 'utf8');
const source = buildSync({ entryPoints: [new URL('../src/main.js', import.meta.url).pathname], bundle: true, write: false, format: 'iife', loader: { '.css': 'text' } }).outputFiles[0].text;
const bundle = await readFile(new URL('../x-post-saver-enhanced.user.js', import.meta.url), 'utf8');
// Only the upstream layout contract, not its hooks/network implementation.
// MIT reference/permission notice: tests/fixtures/masonry-layout-NOTICE.md.
const upstreamLayout = `
main { flex:1 1 auto !important; }
.xopt-masonry-container { grid-template-columns:repeat(3,minmax(0,1fr)) !important; }
.xopt-page-wide { width:100% !important; max-width:none !important; min-width:0 !important; }
[data-testid="primaryColumn"] { width:min(1280px,calc(100vw - 300px)) !important; max-width:1280px !important; }
@media(min-width:1251px) {
header[role="banner"] { flex:0 0 280px !important; width:280px !important; max-width:280px !important; }
main { width:calc(100vw - 280px) !important; max-width:none !important; }
[data-testid="primaryColumn"] { flex:0 1 1240px !important; width:min(1240px,100%) !important; max-width:1240px !important; }
}
@media(max-width:1250px) {
  [data-testid="primaryColumn"] { width:calc(100vw - 92px) !important; }
  .xopt-masonry-container { grid-template-columns:repeat(2,minmax(0,1fr)) !important; }
}
@media(max-width:760px) { .xopt-masonry-container { grid-template-columns:minmax(0,1fr) !important; } }
`;
const browser = await chromium.launch({ executablePath: process.env.XPS_CHROMIUM, headless:true, args:['--disable-background-networking'] });
const context = await browser.newContext({ serviceWorkers:'block', reducedMotion:'reduce' });
await context.route('**/*', (route) => route.abort());
const measurements = [], calls = [], errors = [];

async function measure(page, name, screenshot = false) {
  const result = await page.evaluate(() => {
    const rect = (selector) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { x:r.x, width:r.width, right:r.right };
    };
    const feed = document.querySelector('[data-testid=primaryColumn]');
    return { header:rect('header[role=banner]'), feed:rect('[data-testid=primaryColumn]'), masonry:rect('.timeline'),
      surface:rect('header[role=banner] > div'), viewport:innerWidth,
      clientWidth:document.documentElement.clientWidth, scrollWidth:document.documentElement.scrollWidth,
      usableFeedWidth:feed.clientWidth,
      columns:getComputedStyle(document.querySelector('.timeline')).gridTemplateColumns };
  });
  assert.ok(result.scrollWidth <= result.clientWidth, `${name}: no horizontal overflow`);
  measurements.push({ name, ...result });
  if (screenshot) await page.screenshot({ path:`${output}/${name}.png` });
  return result;
}
async function closed(page) {
  await page.waitForFunction(() => document.querySelector('.xps-nav-toggle')?.getAttribute('aria-expanded') === 'false');
  const m = await measure(page, 'closed-check');
  assert.equal(m.header.width, 0);
  assert.equal(m.surface.width, 0, 'hidden native surface has no box');
  assert.equal(m.feed.x, 0);
  assert.equal(m.feed.width, m.clientWidth);
  assert.equal(m.masonry.width, m.usableFeedWidth, 'inner masonry wrappers also fill the feed');
  assert.equal(await page.locator('.xps-nav-surface').getAttribute('inert'), '');
  assert.equal(await page.locator('.xps-nav-surface').getAttribute('aria-hidden'), 'true');
  assert.equal(await page.getByRole('link', { name:'Home', exact:true }).count(), 0, 'closed controls absent from accessibility tree');
  assert.deepEqual(await page.locator('.xps-nav-toggle').evaluate((e) => {
    const r = e.getBoundingClientRect(); return [r.width,r.height];
  }), [44,44]);
}
async function settled(page) {
  // Allow layout and initial ResizeObserver delivery.
  await page.waitForTimeout(300);
}
async function press(page, key, options = {}, selector = 'body') {
  return page.locator(selector).first().evaluate((target, { key, options }) => {
    const event = new KeyboardEvent('keydown', { key, bubbles:true, cancelable:true, ...options });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }, { key, options });
}
async function blur(page) {
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
}
async function countCalls(page) { return page.evaluate(() => window.tabCalls.length); }

try {
  for (const [kind, code] of [['source',source], ['bundle',bundle]]) {
    for (const order of ['upstream-first','saver-first']) {
      const prefix = `${kind}-${order}`;
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(String(error)));
      await page.setViewportSize({ width:1440, height:900 });
      await page.setContent(html);
      await page.evaluate(() => {
        window.fixtureStorage = { xSavedPosts:'[]', xpsFactCheckTemplate:'Keep my settings' };
        window.GM_getValue = (key) => window.fixtureStorage[key];
        window.GM_setValue = (key, value) => { window.fixtureStorage[key] = value; };
        window.tabCalls = [];
        window.GM_openInTab = (url, options) => { window.tabCalls.push({ url, options }); return {}; };
        window.open = () => { throw new Error('Forbidden active-tab fallback'); };
        window.nativeClicks = [];
        document.addEventListener('click', (event) => {
          const control = event.target.closest('header[role=banner] a, header[role=banner] button');
          if (!control) return;
          event.preventDefault();
          window.nativeClicks.push(control.getAttribute('aria-label'));
          if (['More','Account menu'].includes(control.getAttribute('aria-label'))) {
            const menu = document.createElement('div');
            menu.setAttribute('role','menu');
            menu.innerHTML = '<button role="menuitem">Native fixture menu</button>';
            document.body.append(menu);
          }
        });
      });
      await page.addStyleTag({ content:upstreamLayout });
      if (order === 'upstream-first') await page.locator('.timeline').evaluate((e) => e.classList.add('xopt-masonry-container'));
      const before = await measure(page, `${prefix}-01-before`, true);
      await page.addScriptTag({ content:code });
      if (order === 'saver-first') {
        assert.equal(await page.locator('.xps-nav-toggle, .xps-masonry-key').count(), 0);
        await page.locator('.timeline').evaluate((e) => e.classList.add('xopt-masonry-container'));
      }
      await closed(page);
      await settled(page);
      await page.addStyleTag({ content:upstreamLayout });
      await closed(page);
      const after = await measure(page, `${prefix}-02-full-feed`, true);
      assert.ok(after.feed.width - before.feed.width >= 280, 'reclaim sidebar and latent wrapper cap/padding');
      for (const width of [1000,1280,1440,1920,2560]) {
        await page.setViewportSize({ width, height:900 });
        await closed(page);
        const m = await measure(page, `${prefix}-width-${width}`);
        assert.equal(m.feed.width, width);
        assert.equal(m.usableFeedWidth, width - 2, 'only native feed borders reduce client width');
        assert.equal(m.columns.split(' ').length, width <= 1250 ? 2 : 3, 'upstream columns unchanged');
      }
      await page.setViewportSize({ width:1440, height:900 });
      const toggle = page.locator('.xps-nav-toggle');
      // Actual keyboard traversal cannot enter the hidden original subtree.
      await toggle.focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('header').evaluate((e) => e.contains(document.activeElement)), false);
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('.xps-masonry-key').count(), 0);
      assert.equal(await page.getByRole('link', { name:'Home', exact:true }).evaluate((e) => e === document.activeElement), true);
      const expanded = await measure(page, `${prefix}-03-drawer`, true);
      assert.equal(expanded.surface.width, 280);
      assert.deepEqual(expanded.feed, after.feed);
      assert.equal(await page.locator('.badge').isVisible(), true);
      for (const name of ['Home','Profile','Post']) await page.getByRole('link', { name, exact:true }).click();
      for (const name of ['More','Account menu']) {
        await page.getByRole('button', { name, exact:true }).click();
        await page.getByRole('menuitem').click();
        await page.getByRole('menu').evaluate((e) => e.remove());
      }
      assert.deepEqual(await page.evaluate(() => window.nativeClicks), ['Home','Profile','Post','More','Account menu']);
      assert.equal(await press(page, '1'), false);
      assert.equal(await countCalls(page), 0);
      await page.evaluate(() => {
        const hidden = document.createElement('div'); hidden.setAttribute('role','dialog'); hidden.hidden = true; document.body.append(hidden);
      });
      await page.keyboard.press('Escape');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      assert.equal(await toggle.evaluate((e) => e === document.activeElement), true);
      await page.getByRole('dialog', { includeHidden:true }).evaluate((e) => e.remove());
      await page.keyboard.press('Enter');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      await toggle.focus();
      await page.keyboard.press('Space');
      await closed(page);
      await page.keyboard.press('Space');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      await page.getByRole('button', { name:'Reply', exact:true }).last().click();
      await closed(page);
      assert.equal(await page.getByRole('button', { name:'Reply', exact:true }).last().evaluate((e) => e === document.activeElement), true);
      await toggle.click();
      await page.getByRole('button', { name:'More', exact:true }).click();
      await page.evaluate(() => document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') document.querySelector('[role=menu]')?.remove();
      }, { once:true }));
      await page.keyboard.press('Escape');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'native menu owns first Escape');
      await page.keyboard.press('Escape');
      await closed(page);
      await toggle.click();
      await page.locator('.native-stack').evaluate((e) => {
        const menu = document.createElement('div');
        menu.setAttribute('role','menu');
        menu.style.cssText = 'position:fixed;left:300px;top:100px;bottom:auto;width:300px';
        menu.innerHTML = '<button role="menuitem">Nested native menu</button>'; e.append(menu);
      });
      await page.getByRole('menuitem', { name:'Nested native menu' }).click();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      await page.getByRole('menu').evaluate((e) => e.remove());
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width:1440, height:400 });
      await toggle.click();
      await page.getByRole('button', { name:'Account menu', exact:true }).scrollIntoViewIfNeeded();
      assert.ok(await page.locator('.xps-nav-surface').evaluate((e) => e.scrollTop > 0));
      await page.locator('header[role=banner]').evaluate((e) => e.setAttribute('aria-hidden','false'));
      await page.setViewportSize({ width:900, height:1200 });
      await page.waitForFunction(() => !document.querySelector('.xps-nav-toggle'));
      await settled(page);
      await measure(page, `${prefix}-04-portrait-restored`, true);
      assert.equal(await page.locator('[inert], .xps-nav-surface, .xps-feed-width').count(), 0);
      assert.equal(await page.locator('header[role=banner]').getAttribute('aria-hidden'), 'false', 'native attribute changes survive restoration');
      await page.setViewportSize({ width:1440, height:1600 });
      assert.equal(await toggle.count(), 0);
      await page.setViewportSize({ width:999, height:700 });
      assert.equal(await toggle.count(), 0);
      await page.setViewportSize({ width:1000, height:700 });
      await closed(page);
      await toggle.click();
      assert.equal(await page.locator('nav .native-label').first().isVisible(), true);
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width:1440, height:900 });
      await toggle.click();
      // Replace with pristine native DOM, not a clone of owned attributes.
      await page.locator('header[role=banner]').evaluate((old, markup) => {
        const doc = new DOMParser().parseFromString(markup, 'text/html');
        old.replaceWith(doc.querySelector('header[role=banner]'));
      }, html);
      await closed(page);
      assert.equal(await toggle.count(), 1);
      // Source replacement while open must close the drawer.
      await toggle.click();
      await page.locator('.timeline').evaluate((e) => {
        const replacement = e.cloneNode(true);
        replacement.querySelectorAll('.xps-save-btn, .xps-fact-btn').forEach((button) => button.remove());
        e.replaceWith(replacement);
      });
      await closed(page);
      await page.locator('.timeline').evaluate((e) => e.classList.remove('xopt-masonry-container'));
      await page.waitForFunction(() => !document.querySelector('.xps-nav-toggle'));
      assert.equal(await page.locator('.xps-masonry-key, [inert], .xps-feed-width').count(), 0);
      assert.equal((await measure(page, `${prefix}-stopped`)).header.width, 280);
      // A marker elsewhere is not a real primary masonry feed.
      await page.evaluate(() => {
        const unrelated = document.createElement('div'); unrelated.className = 'xopt-masonry-container'; document.body.append(unrelated);
      });
      assert.equal(await toggle.count(), 0);
      await page.locator('.timeline').evaluate((e) => e.classList.add('xopt-masonry-container'));
      await closed(page);

      // Retained shortcuts use own permalinks even with a preceding quote.
      await page.evaluate(() => {
        const timeline = document.querySelector('.timeline');
        const first = timeline.querySelector('article');
        first.insertAdjacentHTML('afterbegin', '<div data-testid="embeddedTweet"><a href="/quote/status/999"><time>Quoted timestamp before own timestamp</time></a></div>');
        for (let i=4; i<=18; i++) {
          const card = timeline.querySelectorAll('article')[2].cloneNode(true);
          card.querySelectorAll('.xps-save-btn, .xps-fact-btn').forEach((button) => button.remove());
          card.querySelector('a').setAttribute('href', `/fixture/status/${i}`);
          card.querySelector('time').textContent = `Fixture post ${i}`;
          timeline.append(card);
        }
      });
      await settled(page);
      await blur(page);
      const hints = await page.locator('.xps-masonry-key').evaluateAll((nodes) => nodes.map((n) => [n.textContent,n.dataset.url]));
      assert.ok(hints.length > 0 && hints.every(([,url]) => url.startsWith('https://x.com/fixture/status/')));
      for (const key of '1234567890deqyz') assert.equal(await press(page, key), hints.some(([k]) => k === key));
      assert.equal(await countCalls(page), hints.length);
      // Missing/rejected/throwing API: shared error feedback, no active-tab fallback.
      for (const failure of ['missing','throw','null','false','reject']) {
        await page.evaluate((failure) => {
          document.querySelector('#xps-toast')?.remove();
          window.savedOpener = window.GM_openInTab;
          if (failure === 'missing') delete window.GM_openInTab;
          else window.GM_openInTab = () => {
            if (failure === 'throw') throw new Error('Denied');
            if (failure === 'reject') return Promise.reject(new Error('Denied'));
            return failure === 'null' ? null : false;
          };
        }, failure);
        await settled(page);
        await blur(page);
        await page.keyboard.press('j');
        assert.equal(await press(page,'w',{},'article:focus'), failure !== 'missing');
        await page.waitForFunction(() => document.querySelector('#xps-toast')?.textContent.includes('permission'));
        await page.evaluate(() => { window.GM_openInTab = window.savedOpener; });
      }
      // Existing focused-post shortcuts still work without masonry hints.
      await page.evaluate(() => scrollTo(0,0));
      await settled(page);
      await blur(page);
      await page.keyboard.press('j');
      assert.equal(await page.evaluate(() => document.activeElement.tagName), 'ARTICLE');
      await page.keyboard.press('k');
      assert.equal(await page.evaluate(() => document.activeElement.tagName), 'ARTICLE');
      await page.keyboard.press('j');
      const focusedUrl = await page.evaluate(() => {
        const href = document.activeElement.querySelector('a[href*="/fixture/status/"]').getAttribute('href');
        return new URL(href, 'https://x.com').href.split('?')[0];
      });
      const beforeW = await countCalls(page);
      await page.keyboard.press('w');
      assert.equal(await countCalls(page), beforeW + 1);
      assert.equal((await page.evaluate(() => window.tabCalls)).at(-1).url, focusedUrl);
      await page.keyboard.press('v');
      await page.waitForFunction(() => JSON.parse(window.fixtureStorage.xSavedPosts).length === 1);
      await page.keyboard.press('v');
      await page.waitForFunction(() => JSON.parse(window.fixtureStorage.xSavedPosts).length === 0);
      await page.keyboard.press('c');
      await page.waitForFunction((url) => document.querySelector('dialog textarea')?.value.includes(url), focusedUrl);
      assert.equal(await press(page,'w'), false, 'local fact-check dialog guards retained shortcuts');
      await page.locator('dialog').evaluate((e) => e.dispatchEvent(new Event('cancel',{cancelable:true})));
      await page.keyboard.press('Space');
      await page.waitForFunction(() => scrollY > 0);
      const paged = await page.evaluate(() => scrollY);
      await page.keyboard.press('Shift+Space');
      await page.waitForFunction((y) => scrollY < y, paged);
      calls.push({ name:prefix, calls:await page.evaluate(() => window.tabCalls) });
      assert.deepEqual(await page.evaluate(() => window.fixtureStorage), { xSavedPosts:'[]', xpsFactCheckTemplate:'Keep my settings' });
      await page.close();
    }
    const routePage = await context.newPage();
    await routePage.route('https://x.com/**', (route) => route.fulfill({ contentType:'text/html', body:html }));
    await routePage.goto('https://x.com/home');
    await routePage.setViewportSize({ width:1280,height:800 });
    await routePage.evaluate(() => document.querySelector('.timeline').classList.add('xopt-masonry-container'));
    await routePage.addScriptTag({ content:code });
    await closed(routePage);
    await routePage.evaluate(() => {
      document.querySelector('.timeline').classList.remove('xopt-masonry-container');
      history.pushState({},'', '/fixture/status/1');
    });
    await routePage.waitForFunction(() => !document.querySelector('.xps-nav-toggle'));
    await routePage.evaluate(() => {
      history.pushState({},'','/home');
      document.querySelector('.timeline').classList.add('xopt-masonry-container');
    });
    await closed(routePage);
    await routePage.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/masonry-measurements.json`, JSON.stringify({ measurements, calls }, null, 2));
  console.log(`Passed source/bundle, both load orders, full-width layout, inert drawer, shortcuts and background API guards. Evidence: ${output}`);
} finally { await browser.close(); }
