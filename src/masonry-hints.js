import { isNativeShortcutSequence, isShortcutControl } from './keyboard.js';
import { canonicalizeStatusUrl } from './utils.js';

const KEYS = '1234567890deqyz';
const POST = 'article,[data-testid="tweet"]';
const FEED = '[data-testid="primaryColumn"] :is(.xps-masonry-container,.xopt-masonry-container)';
const MODAL = 'dialog[open],[aria-modal="true"],[role="dialog"],[role="alertdialog"],[role="menu"],[data-testid="Dropdown"],:popover-open';
const QUOTE = 'div[role="link"],[data-testid="embeddedTweet"],[data-testid="testCondensedMedia"],[data-testid="card.wrapper"],[data-testid="tweetText"]';

// An own timestamp is positive evidence. A post mentioned in the text, a
// nested quote, or an unidentifiable masonry slot is never a shortcut target.
function ownUrl(card, eligible) {
  const urls = new Set();
  for (const time of card.querySelectorAll('a[href*="/status/"] time')) {
    const link = time.closest('a');
    if (time.closest(POST) !== card || link.closest(QUOTE) || !eligible(time)) continue;
    if (/^\/(?:[^/]+\/status|i\/web\/status|status)\/\d+\/?$/.test(link.pathname)) {
      const url = canonicalizeStatusUrl(link.href);
      if (url) urls.add(url);
    }
  }
  return urls.size === 1 ? [...urls][0] : null;
}

export function initMasonryHints({ eligible, openBackground }) {
  if (typeof IntersectionObserver !== 'function' || !document.elementFromPoint) return;
  const layer = document.createElement('div');
  layer.id = 'xps-masonry-keys';
  layer.setAttribute('aria-hidden', 'true');
  const assigned = new Map(), near = new Map();
  let source = null, frame = 0, route = location.href;
  // X temporarily disables pointer targeting on the list during wheel input.
  // Probe the painted surface synchronously, without changing native inline
  // styles or enabling clicks. Overlays and individual cells keep their rules.
  const probeStyle = document.createElement('style');
  document.head.append(probeStyle);
  const sheet = probeStyle.sheet;
  if (sheet) {
    sheet.disabled = true;
    sheet.insertRule('[data-testid="primaryColumn"] .xps-masonry-container { pointer-events:auto !important }');
  }
  function probe(read) {
    if (!sheet || !source?.matches('.xps-masonry-container') || source.style.pointerEvents !== 'none' ||
        getComputedStyle(source.parentElement).pointerEvents === 'none') return read();
    sheet.disabled = false;
    try { return read(); } finally { sheet.disabled = true; }
  }
  function forget(cell) { near.get(cell)?.edits.disconnect(); near.delete(cell); }
  const io = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      const wanted = isIntersecting && target.parentElement === source;
      if (near.has(target) === wanted) continue;
      if (wanted) {
        // Offscreen subtree churn is not a shortcut signal.
        const bucket = { posts:null, edits:new MutationObserver(() => { bucket.posts = null; schedule(); }) };
        const edits = bucket.edits;
        edits.observe(target, { subtree:true, childList:true, attributes:true,
          attributeFilter:['href','role','data-testid','aria-label','hidden','aria-hidden','inert','style','class'] });
        near.set(target, bucket);
      } else forget(target);
      schedule();
    }
  }, { rootMargin:'180px 0px' });
  const changes = new MutationObserver((records) => {
    for (const r of records) {
      if (r.target !== source || r.type !== 'childList') continue;
      for (const cell of r.removedNodes) if (cell instanceof Element && cell.parentElement !== source) { io.unobserve(cell); forget(cell); }
      for (const cell of r.addedNodes) if (cell instanceof Element) io.observe(cell);
    }
    schedule();
  });
  function blocked() {
    return document.hidden || /\/status\/\d+(?:\/|$)/.test(location.pathname) ||
      document.querySelector('.xps-nav-open,.xopt-status-detail') ||
      [...document.querySelectorAll(MODAL)].some((el) => el.checkVisibility({ visibilityProperty:true }));
  }
  function exposed(card, x, y) {
    const hit = document.elementFromPoint(x, y);
    return hit && hit.closest(POST) === card && !hit.closest('div[role="link"],[data-testid="embeddedTweet"]') && eligible(hit);
  }
  function locate(cell, card, url) {
    if (!url || card.parentElement?.closest(POST) || !eligible(card) ||
        card.closest('[hidden],[inert],[aria-hidden="true"],aside,[data-testid="UserCell"]') ||
        !card.checkVisibility({ opacityProperty:true, visibilityProperty:true })) return;
    const r = card.getBoundingClientRect();
    const l = Math.max(0,r.left), t = Math.max(0,r.top), b = Math.min(innerHeight,r.bottom), end = Math.min(innerWidth,r.right);
    if (end-l < 36 || b-t < 36) return;
    if (Number(getComputedStyle(cell).opacity) < .1) return;
    for (const y of [t+4,(t+b-28)/2,b-32]) for (const x of [l+4,end-32]) {
      if (exposed(card,x+14,y+14) && exposed(card,x+1,y+1) && exposed(card,x+27,y+27)) return { card, cell, url, x, y };
    }
  }
  function remove(card) { assigned.get(card).badge.remove(); assigned.delete(card); }
  function reconcile() {
    frame = 0;
    const feed = document.querySelector(FEED);
    if (source !== feed || route !== location.href) {
      for (const card of assigned.keys()) remove(card);
      changes.disconnect(); io.disconnect();
      for (const cell of near.keys()) forget(cell);
      source = feed; route = location.href;
      if (source) {
        for (const cell of source.children) io.observe(cell);
        changes.observe(source, { childList:true, attributes:true, attributeFilter:['class','hidden','inert','aria-hidden'] });
      }
    }
    const current = new Map();
    if (near.size && source && !blocked()) probe(() => {
      for (const [cell,bucket] of near) {
        // Stable scroll frames need fresh bounds, not repeated permalink/DOM
        // discovery. Never use this cache to authorize a keypress.
        bucket.posts ??= [...(cell.matches(POST) ? [cell] : cell.querySelectorAll(POST))]
          .filter((card) => !card.parentElement?.closest(POST))
          .map((card) => [card, ownUrl(card, eligible)]);
        for (const [card,url] of bucket.posts) {
          const entry = locate(cell, card, url);
          if (entry) current.set(card, entry);
        }
      }
    });
    for (const [card, old] of assigned) if (old.url !== current.get(card)?.url) remove(card);
    const used = new Set([...assigned.values()].map((a) => a.key));
    const free = [...KEYS].filter((key) => !used.has(key));
    for (const entry of [...current.values()].sort((a,b) => a.y-b.y || a.x-b.x)) {
      let slot = assigned.get(entry.card);
      if (!slot) {
        const key = free.shift();
        if (!key) continue;
        const badge = document.createElement('span');
        badge.className = 'xps-masonry-key';
        badge.textContent = key;
        badge.dataset.url = entry.url;
        slot = { key, badge, ...entry };
        assigned.set(entry.card, slot);
        if (!layer.isConnected) document.documentElement.append(layer);
        layer.append(badge);
      }
      const { style } = slot.badge;
      if (style.left !== `${entry.x}px`) style.left = `${entry.x}px`;
      if (style.top !== `${entry.y}px`) style.top = `${entry.y}px`;
    }
    if (!assigned.size && layer.isConnected) layer.remove();
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(reconcile); }
  // Commit/route signals and a viewport shortlist; no RAF loop, no reads of
  // masonry's placements, and no badge writes inside observed application DOM.
  let lastY = scrollY, lastX = scrollX;
  window.addEventListener('scroll', () => {
    if (lastY === scrollY && lastX === scrollX) return;
    lastY = scrollY; lastX = scrollX; schedule();
  }, { passive:true });
  window.addEventListener('resize', schedule);
  window.addEventListener('popstate', schedule);
  for (const event of ['xps-masonry-change','visibilitychange','toggle']) document.addEventListener(event, schedule, true);
  document.addEventListener('xps-navigation-change', () => {
    if (document.querySelector('.xps-nav-open') || (source && !source.matches(FEED))) {
      for (const card of assigned.keys()) remove(card);
    }
    schedule();
  });
  // Native overlays are normally inserted outside the feed. The hint layer
  // lives outside body, so adding/removing a label cannot wake this observer.
  new MutationObserver((records) => {
    if (records.some((r) => !source?.contains(r.target))) schedule();
  }).observe(document.body, { subtree:true, childList:true });
  document.addEventListener('keydown', (event) => {
    if (isNativeShortcutSequence(event) || event.key.length !== 1 || !KEYS.includes(event.key) ||
        event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 ||
        event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || isShortcutControl(event) ||
        [event.target, document.activeElement].some((n) => n instanceof Element &&
          n.closest('nav,[role="navigation"],header[role="banner"],.xps-nav-toggle,#xps-panel'))) return;
    const slot = [...assigned.values()].find((a) => a.key === event.key);
    if (!slot) return;
    const { card, cell, badge, url } = slot;
    const r = badge.getBoundingClientRect();
    if (route !== location.href || document.querySelector(FEED) !== source || blocked() ||
        cell.parentElement !== source || !cell.contains(card) || !badge.isConnected ||
        ownUrl(card, eligible) !== url || !probe(() => locate(cell, card, url) &&
          exposed(card,r.x+14,r.y+14))) { schedule(); return; }
    if (openBackground(url)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  schedule();
}
