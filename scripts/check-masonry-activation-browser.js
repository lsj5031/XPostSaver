// Offline activation boundary regression, not a live userscript-manager test.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { buildSync } from 'esbuild';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.XPS_PLAYWRIGHT);
const output = process.env.XPS_EVIDENCE || '/tmp/xps-activation-evidence';
await mkdir(output, { recursive:true });
const source = buildSync({ entryPoints:[new URL('../src/main.js', import.meta.url).pathname],
  bundle:true, write:false, format:'iife', loader:{ '.css':'text' } }).outputFiles[0].text;
const bundle = await readFile(new URL('../x-post-saver-enhanced.user.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath:process.env.XPS_CHROMIUM, headless:true,
  args:['--disable-background-networking'] });
const results = [];
const shapes = ['object-position', 'wrapper-id', 'primitive-item', 'anonymous-loader', 'duplicate-loader'];
const mixedDelays = ['anonymous-delay', 'repeated-delay', 'anonymous-delay-off', 'repeated-delay-route'];
const versions = [['source', source], ['bundle', bundle]];
if (process.argv.includes('--compare-releases')) {
  for (const [name, ref] of [['v0.5.13', 'cdb3816'], ['v0.5.14', '0156da3']]) {
    versions.push([name, execFileSync('git', ['show', `${ref}:x-post-saver-enhanced.user.js`],
      { cwd:new URL('..', import.meta.url), encoding:'utf8', maxBuffer:5 * 1024 * 1024 })]);
  }
}
try {
  for (const [kind, code] of versions) {
    for (const scenario of kind.startsWith('v') ? [...shapes, 'delayed-commit'] :
      process.argv.includes('--remediation-only') ? [...mixedDelays, 'unknown-entry'] :
      ['late-fiber', 'event-retry', 'instance-props', 'unknown-entry', 'delayed-commit', ...shapes, ...mixedDelays]) {
      const context = await browser.newContext({ viewport:{ width:1440, height:900 }, serviceWorkers:'block' });
      const page = await context.newPage();
      const errors = [];
      let geometry = null;
      let pending = null;
      page.on('pageerror', (error) => errors.push(error.message));
      await context.route('**/*', (route) => route.request().url() === 'https://x.com/home' ?
        route.fulfill({ contentType:'text/html', body:`<!doctype html><style>
        body{margin:0}.timeline{position:relative;width:100%;height:4000px}
        .cell{position:absolute;width:100%;height:180px}
        </style><main role="main"><section data-testid="primaryColumn"><div class="timeline"></div></section></main>` }) :
        route.abort());
      await page.goto('https://x.com/home');
      await page.evaluate((scenario) => {
        window.GM_getValue = () => undefined;
        window.GM_setValue = () => {};
        let timeline = document.querySelector('.timeline');
        const compatibility = ['object-position', 'wrapper-id', 'primitive-item', 'anonymous-loader', 'duplicate-loader'].includes(scenario);
        const mixedDelay = scenario.startsWith('anonymous-delay') || scenario.startsWith('repeated-delay');
        const data = Array.from({ length:compatibility ? 360 : mixedDelay ? 40 : 24 }, (_, i) => ({
          item:{ id:`tweet-${i + 1}` }, fixtureId:i + 1, position:i * 180, height:180 }));
        if (scenario === 'object-position') {
          data.forEach((entry) => { entry.position = { top:entry.position, bottom:entry.position + entry.height }; });
        }
        if (scenario === 'wrapper-id') {
          data.forEach((entry) => { entry.entryId = entry.item.id; entry.item = { renderData:true }; });
        }
        if (scenario === 'primitive-item') data.forEach((entry) => { entry.item = entry.item.id; });
        if (scenario === 'anonymous-loader') data.splice(2, 0, { item:{ loading:true }, fixtureId:'loader', position:360, height:40 });
        if (scenario === 'duplicate-loader') {
          for (const index of [2, 5]) data.splice(index, 0, { item:{ id:'cursor' }, fixtureId:`loader-${index}`, position:index * 180, height:40 });
        }
        if (scenario === 'unknown-entry') data[0] = { item:{ opaque:true }, fixtureId:1, position:0, height:180 };
        let renderedIds = [];
        let renderCalls = 0;
        let deferCommit = false;
        let allowMore = false, fetchCalls = 0;
        const scroller = {
          props:{ onNearBottom() {
            fetchCalls++;
            if (!allowMore) return;
            allowMore = false;
            const nextId = Math.max(...data.map((entry) => typeof entry.fixtureId === 'number' ? entry.fixtureId : 0)) + 1;
            for (let i = 0; i < 12; i++) {
              const id = nextId + i, top = data.length * 180;
              const entry = { item:{ id:`tweet-${id}` }, fixtureId:id, position:top, height:180 };
              if (scenario === 'object-position') entry.position = { top, bottom:top + 180 };
              if (scenario === 'wrapper-id') { entry.entryId = entry.item.id; entry.item = { renderData:true }; }
              if (scenario === 'primitive-item') entry.item = entry.item.id;
              data.push(entry);
            }
            scroller._handleScroll();
          } },
          _getRenderCandidates() {
            const entries = scenario === 'anonymous-loader' ? data.map((entry) =>
              entry.fixtureId === 'loader' ? { ...entry, item:{ loading:true } } : entry) : data;
            return { allItemsWithPositions:entries, newRenderedItems:entries.slice(0, 12), slice:{ start:0, end:12 } };
          },
          _handleScroll() {
            renderCalls++;
            const result = this._getRenderCandidates();
            if (scenario === 'object-position' && result.allItemsWithPositions.some((entry, i) =>
              entry !== data[i] || typeof entry.position !== 'object')) throw new Error('Native coordinate schema/reference corrupted');
            const ids = result.newRenderedItems.map((entry) => entry.fixtureId);
            renderedIds = ids;
            if ([...timeline.children].map((node) => node.dataset.id).join() === ids.join()) return;
            const html = ids.map((id, i) => `<div class="cell" data-id="${id}" style="transform:translateY(${i * 180}px)">${String(id).startsWith('loader') ?
              '<div role="progressbar">Loading fixture</div>' :
              `<article role="article" data-testid="tweet"><a href="/fixture/status/${id}"><time>Fixture</time></a><div data-testid="tweetText">Offline fixture</div><div role="group"><button data-testid="reply">Reply</button></div></article>`}</div>`).join('');
            if (deferCommit) setTimeout(() => { timeline.innerHTML = html; }, 350);
            else timeline.innerHTML = html;
          },
        };
        if (scenario === 'object-position') {
          scroller._measureRelativeViewportRect = () => ({ top:scrollY, height:innerHeight });
          scroller._getAnchor = (rect) => scroller._getRenderCandidates().allItemsWithPositions
            .find((entry) => entry.position.bottom >= rect.top);
          scroller._updateRenderedItems = () => scroller._handleScroll();
        }
        const original = scroller._getRenderCandidates;
        const fiber = { stateNode:scroller,
          memoizedProps:scenario === 'instance-props' ? {} : { onNearBottom:scroller.props.onNearBottom }, return:null };
        // Distinct page-world expando carrier. The sandbox DOM never has a Fiber.
        // The supplied upstream independently checks memoized and instance props.
        let hydrated = !['late-fiber', 'event-retry'].includes(scenario);
        let reads = 0;
        window.pageRealm = { document:{ querySelector(selector) {
          reads++;
          return document.querySelector(selector) ? (hydrated ? { __reactFiber$fixture:fiber } : {}) : null;
        } } };
        scroller._handleScroll();
        window.activationFixture = {
          original, readiness:scroller._getIsHeightsReady, scroller, data, rendered:() => renderedIds, renderCalls:() => renderCalls,
          hydrate() { hydrated = true; },
          reads:() => reads,
          allowMore() { allowMore = true; },
          fetchCalls:() => fetchCalls,
          replaceDataLate() {
            data.forEach((entry, i) => { entry.item = { id:`tweet-${1001 + i}` }; entry.fixtureId = 1001 + i; });
            if (scenario.startsWith('anonymous-delay')) data.splice(2, 0,
              { item:{ loading:true }, fixtureId:'loader', position:360, height:40 });
            if (scenario.startsWith('repeated-delay')) {
              for (const index of [2, 5]) data.splice(index, 0,
                { item:{ id:'cursor' }, fixtureId:`loader-${index}`, position:index * 180, height:40 });
            }
            deferCommit = true; scroller._handleScroll();
            setTimeout(() => { deferCommit = false; }, 400);
          },
          replace() {
            const next = document.createElement('div'); next.className = 'timeline';
            timeline.replaceWith(next); timeline = next; scroller._handleScroll();
          },
        };
      }, scenario);
      await page.addScriptTag({ content:'const unsafeWindow = window.pageRealm;' });
      await page.addScriptTag({ content:code });
      await page.getByRole('button', { name:'Expand X Post Saver panel', exact:true }).click();
      if (kind === 'v0.5.14') {
        if (scenario === 'delayed-commit') {
          await page.waitForFunction(() => document.querySelector('.xps-masonry-container'));
          await page.evaluate(() => window.activationFixture.replaceDataLate());
        }
        await page.waitForTimeout(750);
        assert.equal(await page.locator('.xps-masonry-container').count(), 0, `${kind} rejects ${scenario}`);
        assert.equal(await page.evaluate(() => window.activationFixture.scroller._getRenderCandidates === window.activationFixture.original), true);
        results.push({ kind, scenario, expected:'regression reproduced', errors });
        assert.deepEqual(errors, []);
        await context.close();
        continue;
      }
      if (scenario === 'late-fiber') {
        await page.waitForTimeout(250);
        assert.equal(await page.locator('.xps-masonry-container').count(), 0);
        assert.ok(await page.evaluate(() => window.activationFixture.reads()) > 0, 'bridge lookup failed before hydration');
        await page.screenshot({ path:`${output}/${kind}-waiting.png` });
        await page.evaluate(() => window.activationFixture.hydrate());
        // No DOM event accompanies adding a React expando.
      }
      if (scenario === 'event-retry') {
        await page.waitForTimeout(7500);
        const reads = await page.evaluate(() => window.activationFixture.reads());
        assert.ok(reads > 0, 'bridge discovery attempted before retry exhaustion');
        await page.waitForTimeout(700);
        assert.equal(await page.evaluate(() => window.activationFixture.reads()), reads, 'no idle bridge polling after budget exhaustion');
        assert.match(await page.locator('#xps-panel button').filter({ hasText:'Masonry:' }).textContent(), /On.*waiting for React bridge/);
        await page.evaluate(() => { window.activationFixture.hydrate(); dispatchEvent(new Event('scroll')); });
      }
      if (scenario === 'unknown-entry') {
        await page.waitForFunction(() => [...document.querySelectorAll('#xps-panel button')]
          .some((node) => node.textContent.includes('waiting for native post commit')), null, { timeout:1000 });
        const waitingAt = Date.now();
        assert.equal(await page.locator('.xps-masonry-container, .xps-masonry-item').count(), 0);
        await page.waitForTimeout(300);
        await page.evaluate(() => dispatchEvent(new Event('scroll')));
        await page.waitForFunction(() => [...document.querySelectorAll('#xps-panel button')]
          .some((node) => /unsupported.*candidate/i.test(node.textContent)), null, { timeout:7000 });
        pending = { fallbackAfterWaitingMs:Date.now() - waitingAt };
        assert.ok(pending.fallbackAfterWaitingMs <= 7500, 'DOM/user wake cannot extend the unknown-post deadline');
        assert.equal(await page.locator('.xps-masonry-container').count(), 0);
        assert.equal(await page.evaluate(() => window.activationFixture.scroller._getRenderCandidates === window.activationFixture.original), true);
        assert.match(await page.locator('#xps-panel button').filter({ hasText:'Masonry:' }).textContent(), /unsupported.*candidate/i);
        const calls = await page.evaluate(() => window.activationFixture.renderCalls());
        await page.waitForTimeout(700);
        assert.equal(await page.evaluate(() => window.activationFixture.renderCalls()), calls, 'unknown-post fallback stays idle');
      } else {
        await page.waitForFunction(() => document.querySelector('.xps-masonry-container'), null, { timeout:5000 });
        assert.match(await page.locator('#xps-panel button').filter({ hasText:'Masonry:' }).textContent(), kind === 'v0.5.13' ? /On/ : /On.*active/i);
        await page.screenshot({ path:`${output}/${kind}-${scenario}-active.png` });
        if (scenario === 'delayed-commit' || mixedDelays.includes(scenario)) {
          await page.evaluate(() => window.activationFixture.replaceDataLate());
          if (kind !== 'v0.5.13') {
            await page.waitForFunction(() => [...document.querySelectorAll('#xps-panel button')]
              .some((node) => node.textContent.includes('waiting for native post commit')), null, { timeout:1000 });
            assert.equal(await page.locator('.xps-masonry-container').count(), 0, 'suspend CSS while old DOM is pending');
            assert.equal(await page.locator('.xps-masonry-item').count(), 0, 'no old post is laid out using an anonymous slot');
          }
          if (scenario.endsWith('-off') || scenario.endsWith('-route')) {
            if (scenario.endsWith('-off')) await page.getByRole('button', { name:/Masonry:/ }).click();
            else await page.evaluate(() => { history.pushState({}, '', '/fixture/status/1'); dispatchEvent(new PopStateEvent('popstate')); });
            await page.waitForFunction(() => {
              const f = window.activationFixture;
              return f.scroller._getRenderCandidates === f.original && f.scroller._getIsHeightsReady === f.readiness;
            });
            await page.waitForTimeout(6500);
            assert.equal(await page.locator('.xps-masonry-container, .xps-masonry-item').count(), 0);
            assert.equal(await page.locator('.timeline').evaluate((node) => node.style.getPropertyValue('--xps-feed-height')), '');
            assert.equal(await page.evaluate(() => {
              const f = window.activationFixture;
              return f.scroller._getRenderCandidates === f.original && f.scroller._getIsHeightsReady === f.readiness;
            }), true, 'pending commit/deadline must not reinstall native hooks after Off/route');
            await page.screenshot({ path:`${output}/${kind}-${scenario}.png` });
            results.push({ kind, scenario, errors, pendingRestoration:true });
            assert.deepEqual(errors, []);
            await context.close();
            continue;
          }
          await page.waitForFunction(() => document.querySelector('.xps-masonry-container [data-id="1001"]'));
          assert.match(await page.getByRole('button', { name:/Masonry:/ }).textContent(), kind === 'v0.5.13' ? /On/ : /On.*active/);
          if (mixedDelays.includes(scenario)) {
            assert.deepEqual(await page.locator('.cell').evaluateAll((nodes) => nodes.map((node) => node.dataset.id)),
              await page.evaluate(() => window.activationFixture.rendered().map(String)), 'mixed commit uses actual native-selected identities');
            assert.ok(await page.locator('.cell').count() <= 120);
            assert.equal(await page.locator('[data-id^="loader"] article').count(), 0, 'loading slots never own a post');
            pending = { resumedWithoutToggle:true, mounted:await page.locator('.cell').count() };
          }
        }
        if (shapes.includes(scenario)) {
          const bounds = async () => page.evaluate(() => {
            const feed = document.querySelector('.timeline'), f = window.activationFixture;
            const nativeIds = f.rendered();
            const domIds = [...feed.children].map((node) => node.dataset.id);
            const cells = [...feed.children].map((node) => node.getBoundingClientRect());
            let overlaps = 0;
            for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
              const a = cells[i], b = cells[j];
              if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
                Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlaps++;
            }
            return { nativeIds, domIds, overlaps, visible:cells.filter((r) => r.bottom > 0 && r.top < innerHeight).length };
          });
          await page.waitForTimeout(250);
          const first = await bounds();
          assert.deepEqual(first.domIds, first.nativeIds.map(String), 'native selected entries are the posts actually rendered');
          assert.equal(first.overlaps, 0);
          assert.ok(first.domIds.length <= 120);
          if (!kind.startsWith('v')) {
            const columns = () => page.locator('.cell').evaluateAll((nodes) =>
              Object.fromEntries(nodes.filter((node) => node.querySelector('article'))
                .map((node) => [node.dataset.id, node.getBoundingClientRect().x])));
            const before = await columns();
            await page.locator('.cell').first().evaluate((node) => { node.style.height = '320px'; });
            await page.waitForTimeout(350);
            assert.deepEqual(await columns(), before, 'native-format compatibility retains stable post columns after growth');
          }
          await page.waitForTimeout(400);
          const calls = await page.evaluate(() => window.activationFixture.renderCalls());
          await page.waitForTimeout(400);
          assert.equal(await page.evaluate(() => window.activationFixture.renderCalls()), calls, 'no refresh loop from recreated anonymous wrappers');
          await page.evaluate(() => window.scrollTo(0, 18000));
          await page.waitForTimeout(600);
          const deep = await bounds();
          assert.deepEqual(deep.domIds, deep.nativeIds.map(String));
          assert.equal(deep.overlaps, 0);
          assert.ok(deep.visible >= 4, 'bounded compatibility slice covers viewport');
          assert.ok(deep.domIds.length <= 120 && Number(deep.domIds[0]) > 1);
          geometry = { loaded:await page.evaluate(() => window.activationFixture.data.length),
            initialMounted:first.domIds.length, deepMounted:deep.domIds.length,
            deepVisible:deep.visible, initialOverlaps:first.overlaps, deepOverlaps:deep.overlaps,
            stableColumnsAfterGrowth:kind.startsWith('v') ? null : true };
          await page.evaluate(() => { window.activationFixture.allowMore(); window.scrollTo(0, document.body.scrollHeight); });
          await page.waitForFunction((loaded) => window.activationFixture.data.length === loaded + 12, geometry.loaded);
          await page.waitForTimeout(350);
          const more = await bounds();
          assert.deepEqual(more.domIds, more.nativeIds.map(String));
          assert.ok(more.domIds.length <= 120);
          assert.equal(more.overlaps, 0);
          geometry.afterLoadMore = await page.evaluate(() => window.activationFixture.data.length);
          geometry.mountedAfterLoadMore = more.domIds.length;
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForTimeout(250);
        }
        assert.equal(await page.evaluate(() => Object.keys(document.querySelector('.timeline')).some((key) => key.startsWith('__reactFiber$'))), false);
        for (const destination of ['/fixture/status/1', '/home']) {
          await page.evaluate((url) => { history.pushState({}, '', url); dispatchEvent(new PopStateEvent('popstate')); }, destination);
          if (destination === '/home') await page.waitForFunction(() => document.querySelector('.xps-masonry-container'));
          else {
            await page.waitForFunction(() => !document.querySelector('.xps-masonry-container'));
            assert.equal(await page.evaluate(() => window.activationFixture.scroller._getRenderCandidates === window.activationFixture.original), true);
          }
        }
        await page.evaluate(() => window.activationFixture.replace());
        await page.waitForFunction(() => document.querySelector('.xps-masonry-container'));
        await page.getByRole('button', { name:/Masonry:/ }).click();
        await page.waitForFunction(() => !document.querySelector('.xps-masonry-container'));
        assert.equal(await page.evaluate(() => window.activationFixture.scroller._getRenderCandidates === window.activationFixture.original), true);
      }
      await page.screenshot({ path:`${output}/${kind}-${scenario}.png` });
      results.push({ kind, scenario, errors, geometry, pending, reads:await page.evaluate(() => window.activationFixture.reads()) });
      assert.deepEqual(errors, []);
      await context.close();
    }
  }
} finally {
  await writeFile(`${output}/activation-results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
console.log('Source/bundle late hydration, page-world routing, native fallback and restoration passed.');
