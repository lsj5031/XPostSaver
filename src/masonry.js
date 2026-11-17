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

export function masonryPositions(heights, columns, width, gap = 12, fullRows = new Set(), assigned = []) {
  const bottoms = Array(columns).fill(0);
  const placed = [];
  const cardWidth = (width - gap * (columns - 1)) / columns;
  const positions = heights.map((height, index) => {
    if (fullRows.has(index)) {
      const top = Math.max(...bottoms);
      if (height) bottoms.fill(top + height + gap);
      return { top, left: 0, width };
    }
    const column = Number.isInteger(assigned[index]) && assigned[index] >= 0 && assigned[index] < columns
      ? assigned[index] : bottoms.indexOf(Math.min(...bottoms));
    placed[index] = column;
    const top = bottoms[column];
    if (height) bottoms[column] += height + gap;
    return { top, left: column * (cardWidth + gap), width: cardWidth };
  });
  return { positions, height: Math.max(0, ...bottoms), columns: placed };
}

// Columns belong to current feed identities, never DOM nodes or virtual indexes.
// Only measurements are an LRU cache. Placement metadata is pruned to the native
// loaded list on every update, so unloaded history and detached DOM cannot grow it.
export function createMasonryLayout() {
  const placements = new Map(), measurements = new Map();
  let count = 0;
  return {
    update(items, width) {
      const columns = Math.max(1, Math.floor((width + 12) / 332));
      if (columns !== count) {
        for (const placed of placements.values()) placed.column = undefined;
        count = columns;
      }
      const wanted = new Set(items.map((item) => item.key));
      for (const key of placements.keys()) if (!wanted.has(key)) placements.delete(key);
      for (const key of measurements.keys()) if (!wanted.has(key)) measurements.delete(key);
      const fullRows = new Set();
      const heights = items.map((item, i) => {
        if (measurements.get(item.key)?.fullRow ?? placements.get(item.key)?.fullRow ?? item.fullRow) fullRows.add(i);
        return measurements.get(item.key)?.height ?? item.height ?? 320;
      });
      const layout = masonryPositions(heights, columns, width, 12, fullRows,
        items.map((item) => placements.get(item.key)?.column));
      items.forEach((item, i) => {
        const committed = placements.get(item.key)?.committed || measurements.has(item.key);
        // Estimated offscreen entries have not been placed yet. Their predictions
        // may change; measured/rendered identities commit their column just once.
        placements.set(item.key, { column:committed ? layout.columns[i] : undefined,
          fullRow:fullRows.has(i), committed });
      });
      return { ...layout, heights };
    },
    measure(key, height, width, fullRow) {
      const before = measurements.get(key), placed = placements.get(key);
      const changed = before?.height !== height || before?.width !== width || placed?.fullRow !== fullRow;
      if (placed && placed.fullRow !== fullRow) {
        placed.fullRow = fullRow;
        placed.column = undefined;
      }
      measurements.delete(key);
      measurements.set(key, { height, width, fullRow });
      while (measurements.size > 2000) measurements.delete(measurements.keys().next().value);
      return changed;
    },
    size: () => ({ placements:placements.size, measurements:measurements.size }),
  };
}

// Recognize immutable native entry IDs, not an item's index, height or position.
export function masonryEntry(entry) {
  const item = entry?.item ?? entry;
  const id = item?.id ?? item?.entryId ?? item?.key;
  if (!['string', 'number'].includes(typeof id) || String(id).trim() === '' ||
      (typeof id === 'number' && !Number.isFinite(id)) ||
      (entry.position !== undefined && !Number.isFinite(entry.position))) return null;
  const post = /^(?:tweet-|post-)?(\d+)$/.exec(String(id))?.[1];
  return { key:post ? `post:${post}` : `entry:${id}`, post, entry,
    height:Number.isFinite(entry.height) && entry.height > 0 ? entry.height : 320 };
}

export function masonryWindow(layout, top, height) {
  const visible = [], near = [];
  layout.positions.forEach((p, i) => {
    const bottom = p.top + layout.heights[i];
    if (bottom >= top && p.top <= top + height) visible.push(i);
    if (bottom >= top - 800 && p.top <= top + height + 800) near.push(i);
  });
  const indices = visible.length ? visible : near;
  let start = indices.length ? indices[0] : Math.max(0, layout.positions.length - LIMIT);
  const last = indices.at(-1) ?? start;
  // A pathological tall column can span more than one contiguous native window.
  // Prefer native fallback to silently dropping visible posts or unbounding DOM.
  if (last - start >= LIMIT) return null;
  if (near.length && last - near[0] < LIMIT) start = near[0];
  const end = Math.min(layout.positions.length, Math.max(last + 1, start + LIMIT));
  return { start, end };
}

export function initMasonry({ read, write, permalink }) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  const preference = read('xpsMasonryEnabled');
  let enabled = preference !== false && preference !== 'false';
  let active = null;
  let bridge = null;
  let timer = 0;
  let lastRoute = location.pathname + location.search;
  let lastFetch = 0;
  let fetchTimer = 0;
  let viewportDirty = true;
  const observed = new Set();
  let placement = createMasonryLayout();
  let activeRoute = '';
  let rejected = new WeakSet();
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
    placement = createMasonryLayout();
    activeRoute = '';
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
    const state = { scroller, fetch, originals: new Map(), items:[], rendered:[], geometry:{ positions:[], heights:[] } };
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
      const items = result.allItemsWithPositions.map(masonryEntry);
      const posts = items.filter((item) => item?.post).map((item) => item.post);
      if (items.some((item) => !item) || new Set(items.map((item) => item.key)).size !== items.length ||
          new Set(posts).size !== posts.length) {
        rejected.add(container);
        schedule();
        return result;
      }
      state.items = items;
      const width = container.clientWidth;
      const layout = placement.update(items, width);
      state.geometry = layout;
      const y = Math.max(0, -container.getBoundingClientRect().top);
      const slice = masonryWindow(layout, y, innerHeight);
      if (!slice) { rejected.add(container); schedule(); return result; }
      // Native candidates, rendering and feed height must describe the same geometry.
      const positioned = items.map((item, i) => ({ ...item.entry,
        position:layout.positions[i].top, top:layout.positions[i].top, height:layout.heights[i] }));
      state.rendered = items.slice(slice.start, slice.end);
      schedule();
      return { ...result, allItemsWithPositions:positioned, newRenderedItems:positioned.slice(slice.start, slice.end),
        slice, arePreferredItemsRendered: true };
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
    if (lastRoute !== location.pathname + location.search) rejected = new WeakSet();
    lastRoute = location.pathname + location.search;
    const detail = /\/status\/\d+(?:\/|$)/.test(location.pathname);
    if (!enabled || detail || innerWidth < 700 || !resize) { if (active) release(); return; }
    if (active && activeRoute !== lastRoute) release();
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
      activeRoute = lastRoute;
      active.classList.add('xps-masonry-container');
      document.dispatchEvent(new Event('xps-masonry-change'));
      viewportDirty = true;
    }
    if (bridge && viewportDirty) {
      const layout = placement.update(bridge.items, container.clientWidth);
      const slice = masonryWindow(layout, Math.max(0, -container.getBoundingClientRect().top), innerHeight);
      const wanted = slice && bridge.items.slice(slice.start, slice.end);
      if (!bridge.items.length || !wanted || wanted.length !== bridge.rendered.length ||
          wanted.some((item, i) => item.key !== bridge.rendered[i].key)) refresh(bridge.scroller);
      if (rejected.has(container)) { release(); return; }
    }
    viewportDirty = false;
    const children = [...container.children];
    const width = container.clientWidth;
    const columns = Math.max(1, Math.floor((width + 12) / 332));
    const cardWidth = (width - (columns - 1) * 12) / columns;
    const byPost = new Map((bridge?.items || []).filter((item) => item.post).map((item) => [item.post, item]));
    const cells = children.map((child, i) => {
      const post = child.matches(POST) ? child : outerPosts(child)[0];
      const url = post && permalink(post);
      const id = url && /\/status\/(\d+)/.exec(url)?.[1];
      // Match posts by own identity even if React has not committed the requested
      // slice yet. The positional fallback is for non-post loading rows only.
      const row = bridge?.rendered[i];
      const item = bridge ? (post ? byPost.get(id) : row && !row.post ? row : null) :
        { key:id ? `post:${id}` : url || Symbol('row'), fullRow:!post };
      return { child, item, fullRow:!post };
    });
    if (bridge && cells.some((cell) => !cell.item)) {
      // Unknown/ambiguous entry shapes or a mismatched native commit must not
      // attach another entry's measurement/column to this DOM card.
      rejected.add(container);
      release();
      return;
    }
    const items = bridge ? bridge.items : cells.map((cell) => cell.item);
    if (new Set(items.map((item) => item.key)).size !== items.length) {
      rejected.add(container);
      release();
      return;
    }
    placement.update(items, width);
    let layoutChanged = false;
    const positionStyle = (node, name, value) => {
      if (node.style.getPropertyValue(name) === value) return;
      node.style.setProperty(name, value);
      layoutChanged = true;
    };
    const wanted = new Set();
    cells.forEach(({ child, fullRow }) => {
      if (!child.classList.contains('xps-masonry-item')) child.classList.add('xps-masonry-item');
      positionStyle(child, '--xps-card-width', `${fullRow ? width : cardWidth}px`);
      wanted.add(child);
    });
    for (const child of observed) if (!wanted.has(child)) {
      resize.unobserve(child);
      clearChild(child);
      observed.delete(child);
    }
    for (const child of wanted) if (!observed.has(child)) { observed.add(child); resize.observe(child); }
    cells.forEach(({ child, item, fullRow }) => {
      if (!item) return;
      const height = Math.ceil(child.getBoundingClientRect().height);
      placement.measure(item.key, height, width, fullRow);
    });
    const layout = placement.update(items, width);
    const geometryChanged = bridge && (layout.positions.length !== bridge.geometry.positions.length ||
      layout.positions.some((p, i) => p.top !== bridge.geometry.positions[i].top || layout.heights[i] !== bridge.geometry.heights[i]));
    const positions = new Map(items.map((item, i) => [item.key, layout.positions[i]]));
    cells.forEach(({ child, item }) => {
      const position = item && positions.get(item.key);
      if (!position) return;
      positionStyle(child, '--xps-card-x', `${position.left}px`);
      positionStyle(child, '--xps-card-y', `${position.top}px`);
    });
    positionStyle(container, '--xps-feed-height', `${layout.height}px`);
    if (layoutChanged) document.dispatchEvent(new Event('xps-masonry-change'));
    if (geometryChanged) refresh(bridge.scroller);
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
  window.setInterval(() => { if (lastRoute !== location.pathname + location.search || !active?.isConnected) schedule(); }, 350);
  schedule();
  return {
    enabled: () => enabled,
    toggle() { enabled = !enabled; write('xpsMasonryEnabled', enabled); if (!enabled) release(); schedule(); return enabled; },
  };
}
