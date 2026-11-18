// Private synthetic native-window regression, not a live manager verification.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build, buildSync } from 'esbuild';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.XPS_PLAYWRIGHT);
const output = process.env.XPS_EVIDENCE || '/tmp/xps-geometry-evidence';
await mkdir(output, { recursive:true });
const source = buildSync({ entryPoints:[new URL('../src/main.js', import.meta.url).pathname],
  bundle:true, write:false, format:'iife', loader:{ '.css':'text' } }).outputFiles[0].text;
const baselineSource = process.env.XPS_BASELINE_SOURCE && (await build({
  entryPoints:[new URL('../src/main.js', import.meta.url).pathname], bundle:true, write:false, format:'iife',
  loader:{ '.css':'text' }, plugins:[{ name:'baseline-masonry', setup(build) {
    build.onLoad({ filter:/\/src\/masonry\.js$/ }, async () => ({
      contents:await readFile(process.env.XPS_BASELINE_SOURCE, 'utf8'),
      resolveDir:new URL('../src/', import.meta.url).pathname,
    }));
  } }],
})).outputFiles[0].text;
const versions = process.env.XPS_BASELINE ? [[baselineSource ? 'baseline-source' : 'baseline-bundle',
  baselineSource || await readFile(process.env.XPS_BASELINE, 'utf8')]] :
  [['source', source], ['bundle', await readFile(new URL('../x-post-saver-enhanced.user.js', import.meta.url), 'utf8')]];
if (process.argv.includes('--bundle-only')) versions.splice(0, versions.length - 1);
const browser = await chromium.launch({ executablePath:process.env.XPS_CHROMIUM, headless:true });
const results = [];
const scenarios = ['normal', 'estimates-normal', 'estimates-deep'];
if (process.argv.includes('--prefix-boundary')) scenarios.splice(0, scenarios.length, 'estimates-prefix');
else if (process.argv.includes('--native-commits')) scenarios.splice(0, scenarios.length, 'native-commits');
else if (!process.argv[2]) scenarios.push('estimates-head');
try {
  for (const [kind, code] of versions) {
    for (const scenario of scenarios) {
    const name = `${kind}-${scenario}`;
    const context = await browser.newContext({ viewport:{ width:1374, height:700 }, serviceWorkers:'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await context.route('**/*', (route) => route.request().url() === 'https://x.com/home' ?
      route.fulfill({ contentType:'text/html', body:`<!doctype html><style>
        *{box-sizing:border-box}body{margin:0;background:#101820;color:white}
        .timeline{position:relative;width:100%;height:80000px}
        .cell{position:absolute;width:100%}article{padding:0;border:0;overflow:hidden;background:#22394b}
        </style><main role="main"><section data-testid="primaryColumn"><div class="timeline"></div></section></main>` }) : route.abort());
    await page.goto('https://x.com/home');
    await page.evaluate((scenario) => {
      window.GM_getValue = () => undefined;
      window.GM_setValue = () => {};
      const timeline = document.querySelector('.timeline');
      let delay = false, signature = '', pending = 0, maxPending = 0;
      const frames = [];
      let wheelEpoch = 0;
      window.addEventListener('wheel', () => wheelEpoch++, { passive:true });
      const native = scenario === 'native-commits', measured = new Map();
      let forcedOrigin = 0, nativeScrolls = 0;
      const data = Array.from({ length:500 }, (_, i) => ({
        item:{ opaque:true }, fixtureId:i + 1,
        position:i * (scenario === 'normal' ? 240 : 600),
        height:scenario === 'normal' ? 160 + (i % 5) * 23 : 600,
      }));
      if (scenario === 'estimates-prefix' || native) data.splice(400);
      const scroller = {
        _getRenderCandidates() { return { allItemsWithPositions:data, newRenderedItems:data.slice(0, 16) }; },
        _handleScroll() { this.commit(this._getRenderCandidates(), 0); },
        commit(result, normalize) {
          const ids = result.newRenderedItems.map((entry) => `${entry.fixtureId}:${entry.visible}`).join();
          if (signature === ids && !normalize) return;
          signature = ids;
          const commit = () => {
            if (delay) pending--;
            const old = new Map([...timeline.children].map((node) => [Number(node.dataset.id), node]));
            this.state = { renderedItems:result.newRenderedItems };
            const nodes = result.newRenderedItems.map((entry) => {
              const cell = old.get(entry.fixtureId) || document.createElement('div');
              cell.className = 'cell'; cell.dataset.id = entry.fixtureId;
              cell.style.transform = `translateY(${(entry.offset ?? entry.position) - normalize}px)`;
              cell.style.opacity = entry.visible === false ? '.01' : '1';
              if (old.has(entry.fixtureId)) return cell;
              if (native && entry.fixtureId % 67 === 13) {
                cell.dataset.barrier = ''; cell.style.paddingBottom = '36px';
                return cell;
              }
              cell.innerHTML = `<article role="article" data-testid="tweet" style="height:${160 + ((entry.fixtureId - 1) % 5) * 23}px">
                <a href="/fixture/status/${entry.fixtureId}"><time>Private fixture ${entry.fixtureId}</time></a>
                <p>Opaque native identity, linked quote below</p><div role="link"><a href="/quote/status/${10000 + entry.fixtureId}">Quote</a></div>
                <div role="group"><button data-testid="reply">Reply</button></div></article>`;
              return cell;
            });
            const wanted = new Set(nodes);
            for (const child of [...timeline.children]) if (!wanted.has(child)) child.remove();
            nodes.forEach((node, i) => { if (timeline.children[i] !== node) timeline.insertBefore(node, timeline.children[i] || null); });
            if (normalize) { nativeScrolls++; window.scrollBy(0, -normalize); }
            if ((scenario === 'estimates-prefix' || native) && timeline.classList.contains('xps-masonry-container')) requestAnimationFrame(() => {
              const cards = [...timeline.children].flatMap((child) => {
                const rect = child.getBoundingClientRect();
                return rect.top < innerHeight && rect.bottom > 0 && +getComputedStyle(child).opacity > .1 ?
                  [{ id:child.dataset.id, x:rect.x, y:rect.y }] : [];
              });
              frames.push({ wheelEpoch, y:scrollY, visible:cards.length, cards, nodes:timeline.childElementCount });
            });
          };
          if (delay) { maxPending = Math.max(maxPending, ++pending); setTimeout(commit, 110); } else commit();
        },
      };
      if (native) {
        // Model the documented scalar anchor -> measure -> keyed commit ->
        // normalize callback. This is not X's code or proof of its live reset.
        const distance = (id) => data.slice(0, Number(id.slice(6)) - 1)
          .reduce((sum, e) => sum + (measured.get(e.fixtureId) ?? e.height), 0);
        scroller._getListOffset = (anchor) => anchor.offset - distance(anchor.itemId);
        scroller._getRenderCandidates = (anchor) => {
          let offset = scroller._getListOffset(anchor);
          const all = data.map((row) => {
            const height = measured.get(row.fixtureId) ?? row.height;
            const entry = { itemId:`entry-${row.fixtureId}`, fixtureId:row.fixtureId, offset,
              visible:measured.has(row.fixtureId), canBeAnchor:true, height };
            offset += height; return entry;
          });
          return { allItemsWithPositions:all, newRenderedItems:all.slice(0, 16) };
        };
        scroller._updateRenderedItems = (anchor) => scroller.commit(scroller._getRenderCandidates(anchor), scroller._getListOffset(anchor));
        scroller._handleScroll = () => {
          const child = [...timeline.children].find((node) => node.getBoundingClientRect().bottom > 0);
          const itemId = `entry-${child?.dataset.id || 1}`;
          const anchor = { itemId, offset:distance(itemId) + forcedOrigin };
          forcedOrigin = 0;
          for (const node of timeline.children) measured.set(Number(node.dataset.id), node.getBoundingClientRect().height);
          scroller._updateRenderedItems(anchor);
        };
      }
      const original = scroller._getRenderCandidates;
      const originalUpdate = scroller._updateRenderedItems;
      timeline.__reactFiber$fixture = { stateNode:scroller, memoizedProps:{ onNearBottom() {} }, return:null };
      window.geometryFixture = { scroller, original, originalUpdate, data, frames, maxPending:() => maxPending,
        normalize(value) { forcedOrigin = value; scroller._handleScroll(); }, nativeScrolls:() => nativeScrolls,
        delayed(value) { delay = value; } };
      scroller._handleScroll();
      window.addEventListener('scroll', () => scroller._handleScroll(), { passive:true });
    }, scenario);
    assert.equal(await page.locator('.xps-masonry-container,.xopt-masonry-container').count(), 0);
    const script = await page.addScriptTag({ content:code });
    const sha256 = createHash('sha256').update(await script.textContent()).digest('hex');
    assert.equal(sha256, createHash('sha256').update(code).digest('hex'));
    await page.waitForSelector('.xps-masonry-container');
    await page.waitForTimeout(700);
    const sample = () => page.evaluate(() => ({
      y:scrollY, height:document.documentElement.scrollHeight, viewport:innerHeight,
      cards:[...document.querySelector('.timeline').children].map((node) => {
        const rect = node.getBoundingClientRect();
        return { id:node.dataset.id, top:rect.top + scrollY, screen:rect.top, x:rect.x, height:rect.height,
          visible:rect.bottom > 0 && rect.top < innerHeight && +getComputedStyle(node).opacity > .1 };
      }),
    }));
    const samples = [await sample()];
    let maxShift = 0, lost = 0, comparisons = 0, blanks = 0, resets = 0, maxNodes = 0;
    await page.screenshot({ path:`${output}/${name}-start.png` });
    let wheels = scenario === 'estimates-deep' ? [14000, 0, 0, -600, 600] :
      [...Array(28).fill(500), ...Array(14).fill(-600), 500, -500, 500, -500];
    if (scenario === 'estimates-head') wheels = [
      14000, 0, 0, -600, 600, ...Array(25).fill(-600), 0, 0,
      14000, -600, 600, ...Array(25).fill(-600), 0, 0,
    ];
    if (scenario === 'estimates-prefix' || scenario === 'native-commits') wheels = [20000, 0, 0, 0, -600, 600, 0, 0];
    for (const delta of wheels) {
      const before = samples.at(-1);
      if (delta === 20000) await page.evaluate(() => {
        const trace = window.coldFrames = [];
        window.traceCold = true;
        const frame = (t) => {
          const xs = new Set();
          for (const child of document.querySelector('.timeline').children) {
            const r = child.getBoundingClientRect();
            if (r.top < innerHeight && r.bottom > 0 && +getComputedStyle(child).opacity > .1) xs.add(r.x);
          }
          trace.push({ t, y:scrollY, columns:xs.size });
          if (window.traceCold) requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      if (scenario === 'native-commits' && delta === 0) await page.evaluate(() => window.geometryFixture.normalize(413));
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(210);
      const after = await sample();
      if (delta === 20000) {
        const cold = await page.evaluate(() => { window.traceCold = false; return window.coldFrames; });
        await writeFile(`${output}/${name}-cold-frames.json`, JSON.stringify(cold, null, 2));
        const deep = cold.filter((f) => f.y > before.viewport);
        assert.ok(deep.length > 0, 'sample painted opportunities during the jump');
        assert.ok(deep.every((f) => f.columns >= (scenario === 'estimates-prefix' ? 4 : 1)),
          'viewport remains populated across the cold jump, including before a commit');
      }
      if (delta > 0 && after.y < before.y - 1) resets++;
      if (!after.cards.some((card) => card.visible)) blanks++;
      maxNodes = Math.max(maxNodes, after.cards.length);
      // Input, not the resulting scrollY, is the oracle: an unexpected
      // programmatic scroll must not make a lost or displaced survivor pass.
      const travel = Math.max(-before.y, Math.min(delta, before.height - before.viewport - before.y));
      if (Math.abs(travel) >= before.viewport && after.cards.some((card) => card.visible)) {
        const first = (sample) => Math.min(...sample.cards.filter((card) => card.visible).map((card) => Number(card.id)));
        assert.ok((first(after) - first(before)) * travel > 0, 'cold seek advances visible posts in the requested direction');
      }
      for (const previous of before.cards.filter((card) => card.visible)) {
        const expected = previous.screen - travel;
        if (expected >= before.viewport || expected + previous.height <= 0) continue;
        const card = after.cards.find((next) => next.id === previous.id && next.visible);
        if (card) maxShift = Math.max(maxShift, Math.abs(expected - card.screen), Math.abs(previous.x - card.x));
        else lost++;
        comparisons++;
      }
      samples.push(after);
      if (scenario === 'estimates-head' && after.y === 0) {
        await page.waitForTimeout(1000);
        const stopped = await sample();
        await writeFile(`${output}/${name}-head-stop-${samples.length}.json`, JSON.stringify(stopped, null, 2));
        await page.screenshot({ path:`${output}/${name}-head-stop-${samples.length}.png` });
        assert.ok(stopped.cards.some((card) => card.visible), 'long-return stationary viewport stays covered');
        if (stopped.y === 0) assert.ok(Math.abs(stopped.cards.find((card) => card.id === '1').top) <= 1,
          'the physical head remains at zero');
      }
    }
    if (scenario === 'estimates-head') {
      await page.mouse.wheel(0, 2600);
      await page.waitForTimeout(1100);
      const stopped = await sample();
      assert.equal(stopped.y, 2600);
      assert.ok(stopped.cards.filter((c) => c.visible).length >= 4, 'stationary Y2600 stays populated');
      await page.mouse.wheel(0, -2600);
      await page.waitForTimeout(350);
      const head = await sample();
      assert.equal(head.y, 0);
      assert.equal(head.cards.find((c) => c.id === '1').screen, 0);
    }
    await page.screenshot({ path:`${output}/${name}-reverse.png` });
    // Delayed media below the viewport must not move the stationary visible cards.
    const beforeMedia = await sample();
    await page.evaluate(() => {
      const cells = [...document.querySelector('.timeline').children];
      const target = cells.find((cell) => cell.querySelector('article') && cell.getBoundingClientRect().top > innerHeight + 100);
      const image = new Image();
      image.width = 100; image.height = 90;
      image.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="90"/>');
      target.querySelector('article').style.height = `${target.getBoundingClientRect().height + 90}px`;
      target.querySelector('article').append(image);
    });
    await page.waitForTimeout(500);
    const afterMedia = await sample();
    const stationary = beforeMedia.cards.filter((card) => card.visible).every((card) => {
      const next = afterMedia.cards.find((item) => item.id === card.id);
      return next && Math.abs(next.screen - card.screen) <= 1 && Math.abs(next.x - card.x) <= 1;
    });
    await page.evaluate(() => window.geometryFixture.delayed(true));
    for (const delta of [800, 800, -700, -700]) {
      await page.mouse.wheel(0, delta); await page.waitForTimeout(500);
      const current = await sample();
      assert.ok(current.cards.some((card) => card.visible), 'delayed native commit leaves visible cards');
    }
    if (scenario === 'estimates-prefix' || scenario === 'native-commits') {
      for (const delta of [350, 350, -400, -300]) {
        await page.mouse.wheel(0, delta); await page.waitForTimeout(20);
      }
      await page.waitForTimeout(350);
    }
    const { frames, maxPending } = await page.evaluate(() => ({
      frames:window.geometryFixture.frames, maxPending:window.geometryFixture.maxPending(),
    }));
    if (scenario === 'native-commits') {
      assert.equal(await page.evaluate(() => window.geometryFixture.nativeScrolls()), 0, 'no scalar compensation on top of masonry correction');
      // Grow a true full-width barrier; all downstream physical positions must
      // change even though the viewport above it is stationary.
      const barrier = await page.locator('[data-barrier]').evaluateAll((nodes) =>
        nodes.find((n) => n.getBoundingClientRect().top > innerHeight)?.dataset.id);
      assert.ok(barrier);
      const before = await sample();
      await page.locator(`[data-id="${barrier}"]`).evaluate((n) => { n.style.paddingBottom = '136px'; });
      await page.waitForTimeout(400);
      const after = await sample();
      const downstream = before.cards.filter((card) => Number(card.id) > Number(barrier));
      await writeFile(`${output}/${name}-barrier.json`, JSON.stringify({ barrier, before, after }));
      assert.ok(downstream.length > 20);
      for (const old of downstream) assert.equal(after.cards.find((c) => c.id === old.id)?.top - old.top, 100);
      assert.equal(after.y, before.y);
    }
    let commitShift = 0, commitLost = 0, commitComparisons = 0;
    for (let i = 1; i < frames.length; i++) {
      if (frames[i].wheelEpoch !== frames[i - 1].wheelEpoch) continue;
      for (const old of frames[i - 1].cards) {
        const next = frames[i].cards.find((c) => c.id === old.id);
        if (next) commitShift = Math.max(commitShift, Math.abs(next.y - old.y), Math.abs(next.x - old.x));
        else commitLost++;
        commitComparisons++;
      }
    }
    const report = { kind, sha256, scenario, maxShift, lost, comparisons, blanks, resets, maxNodes, stationary, errors, commitShift, commitLost, commitComparisons,
      commitBlanks:frames.filter((f) => !f.visible).length, maxPending };
    results.push(report);
    await writeFile(`${output}/${name}-samples.json`, JSON.stringify(samples, null, 2));
    await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
    assert.ok(comparisons > 30, 'exercise surviving visible cards across native windows');
    if (frames.length) await writeFile(`${output}/${name}-commits.json`, JSON.stringify(frames, null, 2));
    assert.ok(maxShift <= 1, `viewport survivors deviated ${maxShift}px from wheel intent`);
    assert.equal(lost, 0, 'all intended survivors remain visible');
    assert.equal(report.commitBlanks, 0, 'viewport covered on the first frame after each commit');
    if (frames.length) {
      assert.ok(commitComparisons > 0);
      assert.equal(commitLost, 0, 'no lost viewport posts between commits without input');
      assert.ok(commitShift <= 1, `viewport moved ${commitShift}px between commits without input`);
      assert.ok(frames.every((frame) => frame.nodes <= 120));
    }
    if (scenario === 'estimates-prefix' || scenario === 'native-commits') assert.ok(maxPending > 1, 'exercise overlapping requests');
    assert.equal(blanks, 0);
    assert.ok(maxNodes <= 120);
    assert.equal(stationary, true);
    assert.deepEqual(errors, []);
    await page.getByRole('button', { name:'Expand X Post Saver panel', exact:true }).click();
    await page.getByRole('button', { name:/Masonry: On/ }).click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.xps-masonry-item, .xps-masonry-container').count(), 0);
    assert.equal(await page.evaluate(() => window.geometryFixture.scroller._getRenderCandidates === window.geometryFixture.original), true);
    assert.equal(await page.evaluate(() => window.geometryFixture.scroller._updateRenderedItems === window.geometryFixture.originalUpdate), true);
    await context.close();
    }
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
