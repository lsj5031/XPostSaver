// Shortest-column placement and instance-scroller integration adapted from
// X.com Masonry View 1.7.7. See THIRD_PARTY_NOTICES.md (MIT).
/* global unsafeWindow */
import css from './masonry.css';

const POST = 'article[role="article"], [data-testid="tweet"]';
const LIMIT = 120;

export function outerPosts(root) {
  return [...root.querySelectorAll(POST)].filter((post) => {
    const owner = post.parentElement?.closest(POST);
    return !owner || !root.contains(owner);
  });
}

export function masonryPositions(heights, columns, width, gap = 12, fullRows = new Set()) {
  const bottoms = Array(columns).fill(0);
  const cardWidth = (width - gap * (columns - 1)) / columns;
  const positions = heights.map((height, index) => {
    if (fullRows.has(index)) {
      const top = Math.max(...bottoms);
      if (height) bottoms.fill(top + height + gap);
      return { top, left: 0, width };
    }
    const column = bottoms.indexOf(Math.min(...bottoms));
    const top = bottoms[column];
    if (height) bottoms[column] += height + gap;
    return { top, left: column * (cardWidth + gap), width: cardWidth };
  });
  return { positions, height: Math.max(0, ...bottoms) };
}

export function initMasonry({ read, write }) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  const preference = read('xpsMasonryEnabled');
  let enabled = preference !== false && preference !== 'false';
  let active = null;
  let bridge = null;
  let timer = 0;
  let lastPath = location.pathname;
  let lastFetch = 0;
  let fetchTimer = 0;
  let viewportDirty = true;
  const observed = new Set();
  const sizes = new Map();
  const fullRows = new Set();
  const rejected = new WeakSet();
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  function release() {
    window.clearTimeout(fetchTimer);
    fetchTimer = 0;
    resize?.disconnect();
    for (const child of observed) clearChild(child);
    observed.clear();
    const scroller = bridge?.scroller;
    if (bridge) {
      for (const [name, entry] of bridge.originals) {
        if (bridge.scroller[name] !== entry.installed) continue;
        if (entry.own) bridge.scroller[name] = entry.value;
        else delete bridge.scroller[name];
      }
      bridge = null;
    }
    if (active) {
      active.classList.remove('xps-masonry-container');
      active.style.removeProperty('--xps-feed-height');
      for (const child of active.children) clearChild(child);
    }
    active = null;
    sizes.clear();
    fullRows.clear();
    document.dispatchEvent(new Event('xps-masonry-change'));
    try { scroller?._handleScroll(); } catch { /* Native route may already be gone. */ }
  }

  function clearChild(child) {
    child.classList.remove('xps-masonry-item');
    for (const name of ['--xps-card-x', '--xps-card-y', '--xps-card-width']) child.style.removeProperty(name);
  }

  function discover() {
    const primary = document.querySelector('[data-testid="primaryColumn"]');
    if (!primary) return null;
    let best = null, count = 1;
    for (const post of outerPosts(primary).slice(0, 16)) {
      for (let node = post.parentElement, depth = 0; node && node !== primary && depth < 9; node = node.parentElement, depth++) {
        const n = [...node.children].filter((child) => child.matches(POST) || outerPosts(child).length === 1).length;
        if (n > count) { best = node; count = n; }
      }
    }
    return best;
  }

  function refresh(scroller) {
    try {
      if (typeof scroller._measureRelativeViewportRect === 'function' &&
          typeof scroller._getAnchor === 'function' &&
          typeof scroller._updateRenderedItems === 'function') {
        const rect = scroller._measureRelativeViewportRect();
        scroller._updateRenderedItems(scroller._getAnchor(rect), rect);
        return;
      }
    } catch { /* Fall back to the instance's native scroll entry point. */ }
    try { scroller._handleScroll(); } catch {
      if (active) rejected.add(active);
      schedule();
    }
  }

  function connect(container) {
    // Access the page's React properties through the manager's page-world grant,
    // not an inline script (which a site's CSP can block).
    const native = page.document.querySelector('[data-xps-scroller]');
    if (!native) return null;
    const key = Object.keys(native).find((name) => name.startsWith('__reactFiber$'));
    let fiber = key ? native[key] : null;
    let scroller = null, fetch = null;
    for (let depth = 0; fiber && depth < 80; depth++, fiber = fiber.return) {
      if (!scroller && typeof fiber.stateNode?._getRenderCandidates === 'function') scroller = fiber.stateNode;
      const props = fiber.memoizedProps || fiber.stateNode?.props;
      if (!fetch && typeof props?.onNearBottom === 'function') fetch = () => props.onNearBottom();
      if (!fetch && typeof props?.onNearEnd === 'function') fetch = () => props.onNearEnd();
    }
    if (!scroller || !fetch || typeof scroller._handleScroll !== 'function') return null;
    const state = { scroller, fetch, originals: new Map(), start: 0, total: 0 };
    const replace = (name, installed) => {
      state.originals.set(name, { own: Object.hasOwn(scroller, name), value: scroller[name], installed });
      scroller[name] = installed;
    };
    const original = scroller._getRenderCandidates;
    const candidates = function (...args) {
      const result = original.apply(scroller, args);
      // An optional external engine may wrap this method after us. Once released,
      // such a retained wrapper must be a transparent native pass-through.
      if (bridge !== state) return result;
      if (!Array.isArray(result?.allItemsWithPositions) || !result.slice || !Array.isArray(result.newRenderedItems)) {
        rejected.add(container);
        schedule();
        return result;
      }
      state.total = result.allItemsWithPositions.length;
      const width = container.clientWidth;
      const columns = Math.max(1, Math.floor((width + 12) / 332));
      const layout = masonryPositions(Array.from({ length: state.total }, (_, i) => sizes.get(i) ?? 320), columns, width, 12, fullRows);
      const y = Math.max(0, -container.getBoundingClientRect().top);
      let start = layout.positions.findIndex((p, i) => p.top + (sizes.get(i) || 320) >= y - 800);
      if (start < 0) start = Math.max(0, state.total - LIMIT);
      const end = Math.min(state.total, start + LIMIT);
      state.start = start;
      schedule();
      return { ...result, newRenderedItems: result.allItemsWithPositions.slice(start, end),
        slice: { start, end }, arePreferredItemsRendered: true };
    };
    try {
      replace('_getRenderCandidates', candidates);
      if (typeof scroller._getIsHeightsReady === 'function') replace('_getIsHeightsReady', () => true);
    } catch {
      for (const [name, entry] of state.originals) {
        if (scroller[name] === entry.installed) {
          if (entry.own) scroller[name] = entry.value;
          else delete scroller[name];
        }
      }
      return null;
    }
    return state;
  }

  function apply() {
    timer = 0;
    lastPath = location.pathname;
    const detail = /\/status\/\d+(?:\/|$)/.test(lastPath);
    if (!enabled || detail || innerWidth < 700 || !resize) { if (active) release(); return; }
    // A separately installed external engine owns its layout, never patch it twice.
    if (document.querySelector('.xopt-masonry-container')) { if (active) release(); return; }
    const container = discover();
    if (active && active !== container) release();
    if (!container || rejected.has(container)) { if (active) release(); return; }
    if (!active) {
      // Absolute/transformed native lists require an available, recognized bridge.
      const virtual = [...container.children].some((child) => {
        const s = getComputedStyle(child);
        return s.position === 'absolute' || s.transform !== 'none';
      });
      if (virtual) {
        container.setAttribute('data-xps-scroller', '');
        try { bridge = connect(container); } catch { bridge = null; }
        container.removeAttribute('data-xps-scroller');
        if (!bridge) { rejected.add(container); return; }
      }
      active = container;
      active.classList.add('xps-masonry-container');
      document.dispatchEvent(new Event('xps-masonry-change'));
      viewportDirty = true;
    }
    if (bridge && viewportDirty) refresh(bridge.scroller);
    viewportDirty = false;
    const children = [...container.children];
    const width = container.clientWidth;
    const columns = Math.max(1, Math.floor((width + 12) / 332));
    const cardWidth = (width - (columns - 1) * 12) / columns;
    const wanted = new Set();
    children.forEach((child) => {
      child.classList.add('xps-masonry-item');
      const hasPost = child.matches(POST) || outerPosts(child).length > 0;
      child.style.setProperty('--xps-card-width', `${hasPost ? cardWidth : width}px`);
      wanted.add(child);
    });
    for (const child of observed) if (!wanted.has(child)) {
      resize.unobserve(child);
      clearChild(child);
      observed.delete(child);
    }
    for (const child of wanted) if (!observed.has(child)) { observed.add(child); resize.observe(child); }
    let changed = false;
    const heights = children.map((child, i) => {
      const height = Math.ceil(child.getBoundingClientRect().height);
      const index = (bridge?.start || 0) + i;
      if (child.matches(POST) || outerPosts(child).length) fullRows.delete(index);
      else fullRows.add(index);
      if (sizes.get(index) !== height) { sizes.set(index, height); changed = true; }
      return height;
    });
    // Retain measurements, never detached DOM. Bound the optional height cache.
    while (sizes.size > 2000) {
      const key = sizes.keys().next().value;
      sizes.delete(key);
      fullRows.delete(key);
    }
    const layout = masonryPositions(bridge ? Array.from({ length: bridge.total }, (_, i) => sizes.get(i) ?? 320) : heights, columns, width, 12, fullRows);
    children.forEach((child, i) => {
      const position = layout.positions[(bridge?.start || 0) + i];
      if (!position) return;
      child.style.setProperty('--xps-card-x', `${position.left}px`);
      child.style.setProperty('--xps-card-y', `${position.top}px`);
    });
    container.style.setProperty('--xps-feed-height', `${layout.height}px`);
    if (bridge && changed) refresh(bridge.scroller);
    const remaining = container.getBoundingClientRect().bottom - innerHeight;
    if (bridge?.fetch && remaining < 1800) {
      const wait = 1200 - (Date.now() - lastFetch);
      if (wait <= 0) {
        lastFetch = Date.now();
        try { bridge.fetch(); } catch { /* Native network/loading state owns retries. */ }
      } else if (!fetchTimer) {
        fetchTimer = window.setTimeout(() => { fetchTimer = 0; schedule(); }, wait + 1);
      }
    }
  }

  function schedule() {
    if (!timer) timer = window.setTimeout(apply, 60);
  }
  new MutationObserver((records) => {
    if (records.some((r) => [...r.addedNodes, ...r.removedNodes].some((n) =>
      n instanceof Element && !n.closest('#xps-masonry-keys, #xps-panel') &&
      !n.matches('.xps-nav-toggle, #xps-masonry-keys')))) schedule();
  }).observe(document.body, { subtree: true, childList: true });
  window.addEventListener('resize', () => { viewportDirty = true; schedule(); });
  window.addEventListener('scroll', () => {
    viewportDirty = true;
    schedule();
  }, { passive: true });
  window.addEventListener('popstate', schedule);
  // No history/global monkey patch. Also catches pushState and delayed mounts.
  window.setInterval(() => { if (lastPath !== location.pathname || !active?.isConnected) schedule(); }, 350);
  schedule();
  return {
    enabled: () => enabled,
    toggle() { enabled = !enabled; write('xpsMasonryEnabled', enabled); if (!enabled) release(); schedule(); return enabled; },
  };
}
