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
    if (mode === 'wrapped') data.push({ id:'cursor-bottom', top:27000, height:40 });
    let signature = '', revision = 0, renderedRevision = -1;
    window.moreCalls = 0;
    window.handleCalls = 0;
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
        const positioned = ['wrapped','opaque'].includes(mode) ? data.map((item) => ({ item:{ id:typeof item.id === 'number' ? `${mode === 'opaque' ? 'opaque-' : 'tweet-'}${item.id}` : item.id }, position:item.top, height:item.height })) : data;
        return { allItemsWithPositions:positioned, newRenderedItems:positioned.slice(start, end),
          slice:{ start, end }, arePreferredItemsRendered:true };
      },
      _handleScroll() {
        window.handleCalls++;
        if (!timeline.isConnected) return;
        const result = this._getRenderCandidates();
        const rendered = result.newRenderedItems.map((item) => item.item ? { id:/^(?:tweet-|opaque-)\d+$/.test(item.item.id) ? Number(item.item.id.split('-').at(-1)) : item.item.id, top:item.position } : item);
        const next = rendered.map((item) => item.id).join(',') + ':' + revision;
        if (signature === next) return;
        signature = next;
        timeline.style.height = `${data.length * 450}px`;
        const existing = renderedRevision === revision ? new Map([...timeline.children].map((node) => [node.dataset.id, node])) : new Map();
        const cells = rendered.map(({ id, top }) => {
          if (existing.has(String(id))) return existing.get(String(id));
          const template = document.createElement('template');
          template.innerHTML = typeof id !== 'number' ? `<div class="cell" data-testid="cellInnerDiv" data-id="${id}" style="transform:translateY(${top}px)"><p>Loading fixture</p></div>` : `
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
          </article></div>`;
          return template.content.firstElementChild;
        });
        const wanted = new Set(cells);
        for (const node of [...timeline.children]) if (!wanted.has(node)) node.remove();
        cells.forEach((node, i) => { if (timeline.children[i] !== node) timeline.insertBefore(node, timeline.children[i] || null); });
        renderedRevision = revision;
      },
    };
    if (mode === 'wrapped') {
      window.nativeUpdates = 0;
      scroller._measureRelativeViewportRect = () => ({ top:Math.max(0, scrollY - timeline.offsetTop), height:innerHeight });
      scroller._getAnchor = (rect) => {
        const result = scroller._getRenderCandidates();
        return result.allItemsWithPositions.find((item) => item.position + item.height >= rect.top);
      };
      scroller._updateRenderedItems = () => { window.nativeUpdates++; scroller._handleScroll(); };
    }
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
      recycle(oldId, id) {
        const index = data.findIndex((item) => item.id === oldId);
        data[index] = { ...data[index], id };
        const cell = timeline.querySelector(`[data-id="${oldId}"]`);
        cell.dataset.id = id;
        cell.querySelector('a').href = `/fixture/status/${id}`;
        cell.querySelector('time').textContent = `Recycled post ${id}`;
        cell.querySelector('[data-testid="tweetText"]').innerHTML = '<p>Recycled identity, new height.</p>';
        scroller._handleScroll();
      },
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
    if (['virtual','nested','wrapped','opaque'].includes(mode)) timeline.__reactFiber$fixture = { stateNode:scroller, memoizedProps:{ onNearBottom:nearBottom }, return:null };
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
async function layoutStability(page, kind) {
  const before = await measure(page, `${kind}-layout-before`);
  await page.evaluate(() => {
    window.layoutBadges = [...document.querySelectorAll('.xps-masonry-key')].map((node) => ({ node, key:node.textContent, url:node.dataset.url }));
    const image = document.createElement('img');
    image.id = 'layout-image'; image.width = 280; image.height = 180;
    image.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="280" height="180"><rect width="280" height="180" fill="steelblue"/></svg>');
    document.querySelector('.delayed').append(image);
  });
  await settle(page);
  const after = await measure(page, `${kind}-layout-image`);
  const changed = before.cells.filter((a) => after.cells.some((b) => b.id === a.id && Math.abs(a.x - b.x) > 1)).map((a) => a.id);
  await writeFile(`${output}/${kind}-layout-columns.json`, JSON.stringify({ before, after, changed }, null, 2));
  assert.deepEqual(changed, [], 'delayed image growth must not move existing posts between columns');
  const imageHeight = after.cells[0].height - before.cells[0].height;
  assert.ok(imageHeight >= 180);
  for (const a of before.cells.slice(1)) {
    const b = after.cells.find((b) => b.id === a.id);
    assert.ok(Math.abs(b.y - a.y - (a.x === before.cells[0].x ? imageHeight : 0)) <= 1, 'only downstream cards in the growing column move');
  }
  const stable = await page.evaluate(() => {
    const current = [...document.querySelectorAll('.xps-masonry-key')];
    return window.layoutBadges.filter((b) => current.some((n) => n.dataset.url === b.url)).every((b) => b.node.isConnected && b.node.textContent === b.key);
  });
  assert.equal(stable, true, 'visible surviving badge nodes and keys survive layout growth');
  await page.locator('#layout-image').evaluate((n) => n.remove());
  await settle(page);
}

async function layoutIdentities(page, kind) {
  const initial = await measure(page, `${kind}-identity-before`);
  await page.evaluate(() => {
    window.originalLayoutData = window.fixture.data.map((item) => ({ ...item }));
    window.identityBadges = [...document.querySelectorAll('.xps-masonry-key')].map((node) => ({ node, key:node.textContent, url:node.dataset.url }));
    document.querySelector('.quote').insertAdjacentHTML('beforeend', '<div id="quote-growth" style="height:140px">Delayed offline quote growth</div>');
  });
  await settle(page);
  const quote = await measure(page, `${kind}-identity-quote`);
  const stableColumns = (before, after, label) => {
    const surviving = before.cells.filter((a) => after.cells.some((b) => b.id === a.id));
    assert.ok(surviving.length > 10);
    assert.ok(surviving.every((a) => Math.abs(a.x - after.cells.find((b) => b.id === a.id).x) <= 1), label);
  };
  stableColumns(initial, quote, 'quote growth does not reshuffle columns');
  assert.equal(await page.evaluate(() => {
    const current = [...document.querySelectorAll('.xps-masonry-key')];
    return window.identityBadges.filter((b) => current.some((n) => n.dataset.url === b.url)).every((b) => b.node.isConnected && b.node.textContent === b.key);
  }), true, 'quote growth keeps surviving hint nodes, keys and URLs');
  // Choose a genuinely non-shortest committed slot. Recycling must not inherit it.
  const target = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.cell')];
    const columns = [...new Set(cells.map((n) => n.getBoundingClientRect().x))].sort((a,b) => a-b);
    const bottoms = columns.map(() => 0);
    for (const cell of cells) {
      const r = cell.getBoundingClientRect(), col = columns.indexOf(r.x), shortest = bottoms.indexOf(Math.min(...bottoms));
      if (col !== shortest) return { id:Number(cell.dataset.id), old:r.x, expected:columns[shortest] };
      bottoms[col] += Math.ceil(r.height) + 12;
    }
    return null;
  });
  assert.ok(target, 'growth creates a slot that would move under greedy recomputation');
  await page.evaluate((id) => window.fixture.recycle(id, 90002), target.id);
  await settle(page);
  const recycled = await measure(page, `${kind}-identity-recycled`);
  assert.ok(Math.abs(recycled.cells.find((c) => c.id === '90002').x - target.expected) <= 1, 'new own identity chooses shortest current column, not recycled DOM column');
  stableColumns(quote, recycled, 'other identities keep columns when a cell is recycled');
  await page.evaluate(() => {
    const data = window.fixture.data;
    data.unshift({ id:90001, top:0, height:450 });
    // Native immutable entry object replacement and reorder, without changing identities.
    const [moved] = data.splice(8, 1); data.splice(3, 0, moved);
    data.splice(0, data.length, ...data.map((item) => ({ ...item })));
    window.fixture.scroller._handleScroll();
  });
  await settle(page);
  const inserted = await measure(page, `${kind}-identity-insert-reorder`);
  stableColumns(recycled, inserted, 'insert/reorder/new native objects retain identity columns');
  await page.evaluate(() => {
    const data = window.fixture.data;
    data.splice(data.findIndex((item) => item.id === 90001), 1);
    data.splice(data.findIndex((item) => item.id === 90002), 1);
    window.fixture.scroller._handleScroll();
  });
  await settle(page);
  const removed = await measure(page, `${kind}-identity-remove`);
  stableColumns(inserted, removed, 'removal never transfers or reshuffles surviving columns');
  await page.evaluate(() => window.fixture.replace());
  await settle(page);
  const replaced = await measure(page, `${kind}-identity-new-dom`);
  stableColumns(removed, replaced, 'new DOM with the same own identities retains columns');
  const geometry = await page.evaluate(() => {
    const result = window.fixture.scroller._getRenderCandidates();
    const mismatches = [...document.querySelectorAll('.cell')].flatMap((cell) => {
      const item = result.allItemsWithPositions.find((item) => String(item.id) === cell.dataset.id);
      return !item || item !== window.fixture.data.find((entry) => String(entry.id) === cell.dataset.id) ? [cell.dataset.id] : [];
    });
    return { mismatches, slice:result.slice, count:result.newRenderedItems.length,
      coherent:result.newRenderedItems.every((item, i) => item === result.allItemsWithPositions[result.slice.start + i]),
      untouched:window.fixture.data.every((item) => item.position === undefined) };
  });
  assert.deepEqual(geometry.mismatches, [], 'native candidates preserve raw entry references, independent of CSS geometry');
  assert.ok(geometry.count <= 120 && geometry.coherent && geometry.untouched, 'bounded synthetic slice, no mutation of native entries');
  await page.evaluate(() => {
    window.noopCalls = window.handleCalls; window.noopStyles = 0; window.noopEngineEvents = 0;
    window.noopObserver = new MutationObserver((records) => { window.noopStyles += records.filter((r) => r.target.matches('.timeline, .cell')).length; });
    window.noopObserver.observe(document.querySelector('.timeline'), { subtree:true, attributes:true, attributeFilter:['style','class'] });
    window.countEngineEvent = () => window.noopEngineEvents++;
    document.addEventListener('xps-masonry-change', window.countEngineEvent);
    for (let i = 0; i < 12; i++) window.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(220);
  const noop = await page.evaluate(() => {
    window.noopObserver.disconnect(); document.removeEventListener('xps-masonry-change', window.countEngineEvent);
    return { calls:window.handleCalls - window.noopCalls, styles:window.noopStyles, events:window.noopEngineEvents };
  });
  assert.deepEqual(noop, { calls:0, styles:0, events:0 }, 'unchanged layout does not write styles, dispatch changes or refresh native scroller');
  await page.evaluate(() => {
    history.pushState({}, '', '/notifications?fixture=layout');
  });
  await page.waitForTimeout(1000);
  await settle(page);
  const route = await measure(page, `${kind}-identity-route-reset`);
  // Fresh route gets fresh greedy placement, not this route's old committed columns.
  const bottoms = Array(route.columns).fill(0);
  const xs = [...new Set(route.cells.map((c) => c.x))].sort((a,b) => a-b);
  for (const cell of route.cells) {
    const col = bottoms.indexOf(Math.min(...bottoms));
    assert.ok(Math.abs(cell.x - xs[col]) <= 1, 'route resets identity-scoped placement');
    bottoms[col] += Math.ceil(cell.height) + 12;
  }
  await page.evaluate(() => {
    window.fixture.data.splice(0, window.fixture.data.length, ...window.originalLayoutData);
    history.pushState({}, '', '/home');
    window.fixture.replace(); window.scrollTo(0, 0);
  });
  await settle(page);
  await writeFile(`${output}/${kind}-layout-identity-summary.json`, JSON.stringify({ target, geometry, noop }, null, 2));
}

async function scrollLayoutStability(page, kind, known, bounded) {
  await page.evaluate(() => {
    window.scrollBadges = [...document.querySelectorAll('.xps-masonry-key')].map((node) => ({ node, key:node.textContent, url:node.dataset.url }));
    const cell = [...document.querySelectorAll('.cell')].find((cell) => { const r = cell.getBoundingClientRect(); return r.top >= 0 && r.bottom < innerHeight; });
    const image = document.createElement('img'); image.width = 200; image.height = 90;
    image.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="90"><rect width="200" height="90" fill="olive"/></svg>');
    cell.querySelector('.delayed').append(image);
  });
  await settle(page);
  const growth = await measure(page, `${kind}-08b-deep-media-growth`);
  const common = bounded.cells.filter((a) => growth.cells.some((b) => b.id === a.id));
  assert.ok(common.length > 20);
  assert.ok(common.every((a) => a.x === growth.cells.find((b) => b.id === a.id).x), 'deep-scroll measurements never change committed columns');
  assert.equal(await page.evaluate(() => {
    const current = [...document.querySelectorAll('.xps-masonry-key')];
    const shared = window.scrollBadges.filter((b) => current.some((n) => n.dataset.url === b.url));
    return shared.length > 0 && shared.every((b) => b.node.isConnected && b.node.textContent === b.key);
  }), true, 'deep media growth retains exposed badge identity/key/URL');
  await page.evaluate(() => {
    window.fixture.data.splice(0, window.fixture.data.length, ...window.fixture.data.map((item) => ({ ...item })));
    window.fixture.scroller._handleScroll();
    window.scrollTo(0, scrollY + 700);
  });
  await settle(page);
  const next = await measure(page, `${kind}-08c-deep-next-window`);
  assert.ok(next.count <= 120 && next.visibleCells >= next.columns);
  assert.ok(growth.cells.filter((a) => next.cells.some((b) => b.id === a.id)).every((a) => a.x === next.cells.find((b) => b.id === a.id).x), 'scroll-driven measurement updates keep shared columns');
  await page.evaluate(() => window.scrollTo(0,0));
  await settle(page);
  const back = await measure(page, `${kind}-08d-return-measured-identities`);
  const returned = known.cells.filter((a) => back.cells.some((b) => b.id === a.id));
  assert.ok(returned.length > 10);
  assert.ok(returned.every((a) => a.x === back.cells.find((b) => b.id === a.id).x), 'offscreen DOM recycling does not forget identity columns');
  const mismatches = await page.evaluate(() => {
    const candidates = window.fixture.scroller._getRenderCandidates();
    return [...document.querySelectorAll('.cell')].filter((cell) => {
      const entry = candidates.allItemsWithPositions.find((item) => String(item.id) === cell.dataset.id);
      return entry !== window.fixture.data.find((item) => String(item.id) === cell.dataset.id);
    }).map((cell) => cell.dataset.id);
  });
  assert.deepEqual(mismatches, [], 'native entries remain untouched after offscreen recycling');
  await writeFile(`${output}/${kind}-layout-scroll-summary.json`, JSON.stringify({ common:common.length, returned:returned.length, mismatches }, null, 2));
}

async function hintStability(page, kind) {
  await page.evaluate(() => {
    window.hintNodes = [...document.querySelectorAll('.xps-masonry-key')];
    window.hintFrames = [];
  });
  const frames = await page.evaluate(async () => {
    for (let frame = 0; frame < 36; frame++) {
      document.dispatchEvent(new Event('xps-masonry-change'));
      window.dispatchEvent(new Event('resize'));
      for (const name of ['load', 'transitionrun', 'transitionend', 'animationstart', 'animationend']) {
        for (const target of document.querySelectorAll('header, video, .cell article')) target.dispatchEvent(new Event(name, { bubbles:true }));
      }
      await new Promise(requestAnimationFrame);
      window.hintFrames.push({ frame, badges:[...document.querySelectorAll('.xps-masonry-key')].map((n) => ({
        key:n.textContent, url:n.dataset.url, identity:window.hintNodes.indexOf(n), x:n.style.left, y:n.style.top,
      })) });
    }
    return window.hintFrames;
  });
  await writeFile(`${output}/${kind}-hint-frames.json`, JSON.stringify(frames, null, 2));
  await page.screenshot({ path:`${output}/${kind}-hint-burst.png` });
  assert.ok(frames.every((f) => f.badges.length > 0), 'no blank badge frames during unchanged event bursts');
  assert.ok(frames.every((f) => f.badges.length === frames[0].badges.length && f.badges.every((b, i) =>
    b.identity === frames[0].badges[i].identity && b.identity >= 0 && b.key === frames[0].badges[i].key && b.url === frames[0].badges[i].url)), 'persistent badge nodes, keys and own URLs');
}

async function hintAssignments(page, kind) {
  await page.setViewportSize({ width:2560, height:1800 });
  await settle(page);
  assert.equal(await page.locator('.xps-masonry-key').count(), 15, 'digit-first pool exhausts safely');
  const displayed = await page.locator('.xps-masonry-key').evaluateAll((nodes) => nodes.map((n) => ({ key:n.textContent, url:n.dataset.url })));
  assert.deepEqual(displayed.map((b) => b.key).sort(), [...'1234567890deqyz'].sort());
  await page.evaluate(() => { document.activeElement.blur(); window.tabCalls = []; });
  for (const badge of displayed) {
    await page.keyboard.press(badge.key);
    assert.deepEqual(await page.evaluate(() => window.tabCalls.at(-1)), {
      url:badge.url, options:{ active:false, insert:true, setParent:true },
    });
  }
  assert.equal(await page.evaluate(() => window.tabCalls.length), 15, 'one open per displayed key');
  const ignored = async (keys) => {
    const before = await page.evaluate(() => window.tabCalls.length);
    await page.keyboard.press(keys);
    assert.equal(await page.evaluate(() => window.tabCalls.length), before, keys);
  };
  for (const key of 'abfghilmnoprstux') await ignored(key);
  for (const prefix of ['g', 'a']) {
    for (const key of '1234567890deqyz') { await ignored(prefix); await ignored(key); }
  }
  const nativeChains = await page.evaluate(() => {
    document.querySelector('.cell article').focus({ preventScroll:true });
    const before = { calls:window.tabCalls.length, y:scrollY };
    let passed = true;
    for (const prefix of ['g', 'a']) for (const key of 'abcdefghijklmnopqrstuvwxyz0123456789 ') {
      for (const part of [prefix, key]) {
        const event = new KeyboardEvent('keydown', { key:part, bubbles:true, cancelable:true });
        document.activeElement.dispatchEvent(event);
        passed &&= !event.defaultPrevented;
      }
    }
    document.activeElement.blur();
    return passed && window.tabCalls.length === before.calls && scrollY === before.y;
  });
  assert.equal(nativeChains, true, 'native prefix chains bypass every userscript handler, including a+Space');
  for (const key of 'deqyz') {
    for (const options of [{ repeat:true }, { isComposing:true }, { keyCode:229 }, { ctrlKey:true }, { altKey:true }, { metaKey:true }, { shiftKey:true }]) {
      await page.locator('body').evaluate((node, options) => node.dispatchEvent(new KeyboardEvent('keydown', { bubbles:true, cancelable:true, ...options })), { key, ...options });
    }
  }
  assert.equal(await page.evaluate(() => window.tabCalls.length), 15);
  for (const markup of ['<input>', '<textarea></textarea>', '<select><option>x</option></select>', '<div contenteditable="true" tabindex="0"></div>', '<div role="slider" tabindex="0"></div>', '<div data-testid="videoPlayer"><button>Media</button></div>', '<audio controls></audio>']) {
    await page.evaluate((markup) => {
      const holder = document.createElement('div'); holder.id = 'guard-fixture'; holder.innerHTML = markup; document.body.append(holder);
      const control = holder.querySelector('button') || holder.firstElementChild; control.tabIndex = 0; control.focus();
    }, markup);
    await ignored('d');
    await page.locator('#guard-fixture').evaluate((n) => n.remove());
  }
  await page.evaluate(() => {
    window.stableBadges = [...document.querySelectorAll('.xps-masonry-key')].map((node) => ({ node, key:node.textContent, url:node.dataset.url, top:node.style.top }));
    const post = document.querySelector('.cell article');
    post.querySelector('[data-testid="tweetText"]').insertAdjacentHTML('beforeend', '<img width="240" height="80" alt="Offline layout growth" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22240%22 height=%2280%22/%3E">');
    post.querySelector('time').textContent = 'Counter/media update';
  });
  const reflowFrames = await page.evaluate(async () => {
    const frames = [];
    for (let frame = 0; frame < 36; frame++) {
      await new Promise(requestAnimationFrame);
      frames.push({ frame, badges:[...document.querySelectorAll('.xps-masonry-key')].map((n) => ({
        key:n.textContent, url:n.dataset.url, identity:window.stableBadges.findIndex((b) => b.node === n), x:n.style.left, y:n.style.top,
      })) });
    }
    return frames;
  });
  await writeFile(`${output}/${kind}-hint-reflow-frames.json`, JSON.stringify(reflowFrames, null, 2));
  assert.ok(reflowFrames.every((f) => f.badges.length > 0), 'image reflow has no blank frames');
  await settle(page);
  const geometry = await page.evaluate(() => {
    const retained = window.stableBadges.filter((b) => [...document.querySelectorAll('.xps-masonry-key')].some((n) => n.dataset.url === b.url));
    return { retained:retained.length, stable:retained.every((b) => b.node.isConnected && b.node.textContent === b.key), moved:retained.some((b) => b.node.style.top !== b.top) };
  });
  await writeFile(`${output}/${kind}-hint-reflow-summary.json`, JSON.stringify(geometry, null, 2));
  assert.ok(geometry.retained > 10 && geometry.stable && geometry.moved, 'reflow moves persistent nodes without reassigning survivors');
  await page.screenshot({ path:`${output}/${kind}-hint-letters-reflow.png` });
  // Recycled own URL, before observer/frame delivery: the old displayed key must not open.
  const stale = await page.evaluate(() => {
    const badge = document.querySelector('.xps-masonry-key');
    const card = [...document.querySelectorAll('.cell article')].find((n) => n.querySelector('a')?.href === badge.dataset.url);
    const anchor = card.querySelector('a');
    const old = anchor.getAttribute('href'); anchor.setAttribute('href', '/fixture/status/999999');
    const before = window.tabCalls.length;
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key:badge.textContent, bubbles:true, cancelable:true }));
    const safe = window.tabCalls.length === before;
    anchor.setAttribute('href', old);
    return safe;
  });
  assert.equal(stale, true, 'independent own-identity validation');
  await page.evaluate(() => {
    const cover = document.createElement('div'); cover.id = 'hint-cover'; cover.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#222'; document.body.append(cover);
    window.coverCalls = window.tabCalls.length;
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key:'1', bubbles:true, cancelable:true }));
  });
  assert.equal(await page.evaluate(() => window.tabCalls.length === window.coverCalls), true);
  await page.waitForFunction(() => document.querySelectorAll('.xps-masonry-key').length === 0);
  await page.locator('#hint-cover').evaluate((n) => n.remove());
  await page.waitForFunction(() => document.querySelectorAll('.xps-masonry-key').length === 15);
  // Removing a card frees only its key; extra visible cards may consume it.
  const survivors = await page.evaluate(() => {
    const badges = [...document.querySelectorAll('.xps-masonry-key')];
    window.survivingHints = badges.slice(1);
    const card = [...document.querySelectorAll('.cell article')].find((n) => n.querySelector('a')?.href === badges[0].dataset.url);
    card.style.visibility = 'hidden';
    return badges[0].dataset.url;
  });
  await page.waitForFunction((url) => ![...document.querySelectorAll('.xps-masonry-key')].some((n) => n.dataset.url === url), survivors);
  assert.equal(await page.evaluate(() => window.survivingHints.every((n) => n.isConnected)), true);
  await page.locator('.cell article').first().evaluate((n) => n.style.removeProperty('visibility'));
  await page.setViewportSize({ width:1440, height:900 });
  await settle(page);
  await page.evaluate(() => { window.tabCalls = []; });
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
    await layoutStability(page, kind);
    await layoutIdentities(page, kind);
    await hintStability(page, kind);
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
    await hintAssignments(page, kind);
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
    const known = await measure(page, `${kind}-07-more`);
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
    await scrollLayoutStability(page, kind, known, bounded);
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
  for (const mode of ['delayed','unsupported','nested','wrapped','opaque']) {
    const context = await browser.newContext({ viewport:{ width:1440, height:900 } });
    await context.route('**/*', (route) => route.request().url() === 'https://x.com/home'
      ? route.fulfill({ contentType:'text/html', body:native }) : route.abort());
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto('https://x.com/home');
    await installFixture(page, mode);
    await page.addScriptTag({ content:bundle });
    if (mode !== 'unsupported') {
      await settle(page);
      await measure(page, `bundle-12-${mode}`);
      if (mode === 'wrapped') {
        assert.ok(await page.evaluate(() => window.nativeUpdates > 0), 'native anchor/update refresh entry point used');
        await page.locator('[data-id="cursor-bottom"]').evaluate((node) => node.replaceChildren());
        await settle(page);
        await measure(page, 'bundle-12-wrapped-zero-loader');
        assert.equal(await page.locator('[data-id="cursor-bottom"]').evaluate((node) => node.getBoundingClientRect().height), 0);
        await page.evaluate(() => history.pushState({}, '', '/fixture/status/1'));
        await page.waitForFunction(() => !document.querySelector('.xps-masonry-container'));
        assert.equal(await page.evaluate(() => window.fixture.scroller._getRenderCandidates === window.fixture.original), true);
      }
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
