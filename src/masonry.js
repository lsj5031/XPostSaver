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
  const valid = (value) => ['string', 'number'].includes(typeof value) &&
    String(value).trim() !== '' && (typeof value !== 'number' || Number.isFinite(value));
  // Native wrappers can own the list identity while item owns the render data,
  // or item can itself be the list key. Position is not an identity field.
  const ids = [item?.id, item?.entryId, item?.key, entry?.id, entry?.entryId, entry?.key,
    typeof item === 'object' ? undefined : item].filter(valid);
  const id = ids[0];
  if (id === undefined) return null;
  // List/promoted wrapper keys are not post IDs. A recognized own-post ID in
  // another explicit identity field wins, but conflicting post IDs never do.
  const posts = new Set(ids.map((id) => /^(?:tweet-|post-)?(\d+)$/.exec(String(id))?.[1]).filter(Boolean));
  if (posts.size > 1) return null;
  const post = [...posts][0];
  return { key:post ? `post:${post}` : `entry:${id}`, post, entry,
    height:Number.isFinite(entry.height) && entry.height > 0 ? entry.height : 320 };
}

export function matchMasonryCells(cells, items, rendered) {
  const byPost = new Map(items.filter((item) => item.post).map((item) => [item.post, item]));
  const matched = cells.map((cell) => ({ ...cell, item:cell.post ? byPost.get(cell.id) : null }));
  const rows = rendered.filter((item) => !item.post);
  const nonPosts = matched.filter((cell) => !cell.post);
  // Non-post children have no permalink. Match a unique loading row, or a
  // unique row bracketed by the same own-post identities, never rendered[i].
  matched.forEach((cell, i) => {
    if (cell.post) return;
    if (rows.length === 1 && nonPosts.length === 1) { cell.item = rows[0]; return; }
    const before = matched.slice(0, i).findLast((cell) => cell.post);
    const after = matched.slice(i + 1).find((cell) => cell.post);
    const start = before ? rendered.indexOf(before.item) : -1;
    const end = after ? rendered.indexOf(after.item) : rendered.length;
    if ((before && start < 0) || end < 0 || start >= end) return;
    const between = rendered.slice(start + 1, end).filter((item) => !item.post);
    if (between.length === 1) cell.item = between[0];
  });
  const counts = new Map();
  for (const cell of matched) if (cell.item) counts.set(cell.item.key, (counts.get(cell.item.key) || 0) + 1);
  // Multiple DOM cards for one candidate (or multiple posts in one cell) cannot
  // safely own a persistent measurement. Layout can still use local geometry.
  return matched.map((cell) => counts.get(cell.item?.key) > 1 || cell.postCount > 1 ? { ...cell, item:null } : cell);
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
  let layoutDirty = true;
  let containerWidth = 0;
  let refreshFrame = 0;
  const observed = new Set();
  let placement = createMasonryLayout();
  let visualPlacement = createMasonryLayout();
  let activeRoute = '';
  let rejected = new WeakMap();
  let status = 'waiting for feed';
  let retryContainer = null, retryCount = 0, retryTimer = 0;
  let bridgeReason = 'waiting for React bridge';
  const warnings = new Set();
  function warn(reason) {
    if (warnings.has(reason) || warnings.size >= 8) return;
    warnings.add(reason);
    console.warn('[XPostSaver masonry]', reason);
  }
  function setStatus(value) {
    if (status === value) return;
    status = value;
    if (value.startsWith('unsupported:') || (value.startsWith('waiting for ') && value !== 'waiting for feed')) warn(value);
    document.dispatchEvent(new Event('xps-masonry-status'));
  }
  function reject(container, reason) {
    rejected.set(container, reason);
    schedule();
  }
  function waitForBridge(container) {
    setStatus(bridgeReason);
    if (retryContainer !== container) { retryContainer = container; retryCount = 0; }
    if (retryTimer) return;
    const delay = [150, 350, 750, 1500, 3000][retryCount++];
    if (!retryTimer && delay) retryTimer = window.setTimeout(() => { retryTimer = 0; schedule(); }, delay);
  }
  function wake() {
    layoutDirty = true;
    if (!retryTimer) retryCount = 0;
    schedule();
  }
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
    // Our feed-height writes do not invalidate card geometry; parent-width
    // changes do, even when fixed-width cards have not resized yet.
    if (entries.some((entry) => entry.target !== active) || active?.clientWidth !== containerWidth) wake();
  }) : null;
  const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  function release() {
    if (refreshFrame) cancelAnimationFrame(refreshFrame);
    refreshFrame = 0;
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
    layoutDirty = true;
    placement = createMasonryLayout();
    visualPlacement = createMasonryLayout();
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
    if (refreshFrame) return;
    refreshFrame = requestAnimationFrame(() => {
      refreshFrame = 0;
      if (bridge?.scroller === scroller) refreshNow(scroller);
    });
  }

  function refreshNow(scroller) {
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
      if (active) reject(active, 'unsupported: native refresh failed');
      schedule();
    }
  }

  function connect(container) {
    // Access the page's React properties through the manager's page-world grant,
    // not an inline script (which a site's CSP can block).
    const native = page.document.querySelector('[data-xps-scroller]');
    bridgeReason = 'waiting for page-world list';
    if (!native) return null;
    const key = Object.keys(native).find((name) => name.startsWith('__reactFiber$'));
    bridgeReason = 'waiting for React bridge';
    if (!key) return null;
    let fiber = native[key];
    let scroller = null, fetch = null;
    for (let depth = 0; fiber && depth < 80; depth++, fiber = fiber.return) {
      if (!scroller && typeof fiber.stateNode?._getRenderCandidates === 'function') scroller = fiber.stateNode;
      for (const props of [fiber.memoizedProps, fiber.stateNode?.props]) {
        if (!fetch && typeof props?.onNearBottom === 'function') fetch = () => props.onNearBottom();
        if (!fetch && typeof props?.onNearEnd === 'function') fetch = () => props.onNearEnd();
      }
    }
    bridgeReason = !scroller ? 'waiting for native scroller' : !fetch ?
      'waiting for native pagination callback' : 'unsupported: native scroll method missing';
    if (!scroller || !fetch || typeof scroller._handleScroll !== 'function') return null;
    /** @typedef {{key:string|symbol, post?:string, entry:unknown, height:number}} WindowItem */
    const state = { scroller, fetch, originals: new Map(),
      items:/** @type {WindowItem[]} */ ([]), rendered:/** @type {WindowItem[]} */ ([]), geometry:{ positions:[], heights:[] },
      start:0, width:0, geometryDirty:true };
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
      if (!Array.isArray(result?.allItemsWithPositions)) {
        reject(container, 'unsupported: candidate envelope');
        schedule();
        return result;
      }
      const parsedEntries = result.allItemsWithPositions.map(masonryEntry);
      const counts = new Map();
      for (const item of parsedEntries) if (item) counts.set(item.key, (counts.get(item.key) || 0) + 1);
      const next = result.allItemsWithPositions.map((entry, index) => {
        const parsed = parsedEntries[index];
        if (parsed && counts.get(parsed.key) === 1) return { ...parsed,
          height:state.estimatedHeight ?? parsed.height };
        // Slot keys are only for estimated window geometry, never post ownership
        // or cached DOM measurements. Local visual layout remains permissive.
        return { key:typeof state.items[index]?.key === 'symbol' ? state.items[index].key : Symbol(`native slot ${index}`), entry,
          height:state.estimatedHeight ?? (Number.isFinite(entry?.height) && entry.height > 0 ? entry.height : 320) };
      });
      const changed = next.length !== state.items.length || next.some((item, i) =>
        item.key !== state.items[i].key || item.height !== state.items[i].height);
      if (changed) {
        state.items = next;
        state.geometryDirty = true;
      }
      const items = state.items;
      const width = container.clientWidth;
      if (!Number.isFinite(width) || width <= 0) return result;
      const dirty = state.geometryDirty || state.width !== width;
      if (dirty) {
        state.geometry = placement.update(items, width);
        state.width = width;
        state.geometryDirty = false;
      }
      const layout = state.geometry;
      const y = Math.max(0, -container.getBoundingClientRect().top);
      const slice = masonryWindow(layout, y, innerHeight);
      if (!slice) { reject(container, 'unsupported: visible window exceeds safe limit'); return result; }
      // Like .13, keep native entries and coordinate schemas untouched.
      const positioned = result.allItemsWithPositions;
      const windowChanged = slice.start !== state.start || slice.end - slice.start !== state.rendered.length;
      state.rendered = items.slice(slice.start, slice.end);
      state.start = slice.start;
      if (dirty || windowChanged) wake();
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
      bridgeReason = 'unsupported: native methods not writable';
      return null;
    }
    return state;
  }

  function apply() {
    timer = 0;
    if (lastRoute !== location.pathname + location.search) {
      rejected = new WeakMap();
      retryCount = 0;
    }
    lastRoute = location.pathname + location.search;
    const detail = /\/status\/\d+(?:\/|$)/.test(location.pathname);
    if (!enabled || detail || innerWidth < 700 || !resize) {
      if (active) release();
      window.clearTimeout(retryTimer); retryTimer = 0;
      setStatus(!enabled ? 'off' : detail ? 'native: post detail' : innerWidth < 700 ? 'native: narrow window' : 'unsupported: ResizeObserver unavailable');
      return;
    }
    if (active && activeRoute !== lastRoute) release();
    // A separately installed external engine owns its layout, never patch it twice.
    if (document.querySelector('.xopt-masonry-container')) { if (active) release(); setStatus('active: external engine'); return; }
    const container = !layoutDirty && active?.isConnected ? active : discover();
    if (active && active !== container) release();
    if (!container || rejected.has(container)) {
      if (active) release();
      setStatus(container ? rejected.get(container) : 'waiting for feed');
      return;
    }
    if (!active) {
      // Absolute/transformed native lists require an available, recognized bridge.
      const virtual = [...container.children].some((child) => {
        const s = getComputedStyle(child);
        return s.position === 'absolute' || s.transform !== 'none';
      });
      if (virtual) {
        container.setAttribute('data-xps-scroller', '');
        try { bridge = connect(container); } catch { bridge = null; bridgeReason = 'waiting for page-world access'; }
        container.removeAttribute('data-xps-scroller');
        if (!bridge) { waitForBridge(container); return; }
      }
      window.clearTimeout(retryTimer); retryTimer = 0;
      retryContainer = null; retryCount = 0;
      active = container;
      resize.observe(container);
      activeRoute = lastRoute;
      viewportDirty = true;
      layoutDirty = true;
    }
    if (bridge && viewportDirty) {
      const layout = bridge.geometry;
      const slice = masonryWindow(layout, Math.max(0, -container.getBoundingClientRect().top), innerHeight);
      const wanted = slice && bridge.items.slice(slice.start, slice.end);
      if (!bridge.items.length || !wanted || wanted.length !== bridge.rendered.length ||
          wanted.some((item, i) => item !== bridge.rendered[i])) refresh(bridge.scroller);
      if (rejected.has(container)) { release(); setStatus(rejected.get(container)); return; }
    }
    viewportDirty = false;
    if (!layoutDirty) {
      checkNearEnd(container);
      return;
    }
    layoutDirty = false;
    const children = [...container.children];
    const width = container.clientWidth;
    containerWidth = width;
    if (!Number.isFinite(width) || width <= 0) return;
    const columns = Math.max(1, Math.floor((width + 12) / 332));
    const cardWidth = (width - (columns - 1) * 12) / columns;
    const domCells = children.map((child) => {
      const posts = child.matches(POST) ? [child] : outerPosts(child);
      const post = posts[0];
      const url = post && permalink(post);
      const id = url && /\/status\/(\d+)/.exec(url)?.[1];
      // Match posts by own identity even if React has not committed the requested slice yet.
      const item = { key:id ? `post:${id}` : url || Symbol('row'), fullRow:!post };
      return { child, item, id, post:!!post, postCount:posts.length, fullRow:!post };
    });
    let cells = bridge ? matchMasonryCells(domCells, bridge.items, bridge.rendered) : domCells;
    const local = !bridge || cells.some((cell) => !cell.item || typeof cell.item.key === 'symbol');
    if (local && bridge) warn('Using estimated geometry and local card layout; unverified identities do not block masonry.');
    // Visual placement needs only DOM geometry. Own permalinks are optional
    // cache keys, never activation requirements or inferred shortcut targets.
    const ids = new Map();
    for (const cell of domCells) if (cell.id) ids.set(cell.id, (ids.get(cell.id) || 0) + 1);
    if (local) cells = domCells.map((cell) => ({ ...cell, item:{
      key:cell.id && ids.get(cell.id) === 1 ? `post:${cell.id}` : Symbol('unverified card'),
      fullRow:cell.fullRow,
    } }));
    const items = local ? cells.map((cell) => cell.item) : bridge.items;
    const renderer = local ? visualPlacement : placement;
    window.clearTimeout(retryTimer); retryTimer = 0;
    retryContainer = null; retryCount = 0;
    if (!container.classList.contains('xps-masonry-container')) {
      container.classList.add('xps-masonry-container');
      document.dispatchEvent(new Event('xps-masonry-change'));
    }
    renderer.update(items, width);
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
    const measured = new Map();
    cells.forEach(({ child, item, fullRow }) => {
      if (!item) return;
      const height = Math.ceil(child.getBoundingClientRect().height);
      measured.set(child, height);
      if (Number.isFinite(height) && height >= 0) renderer.measure(item.key, height, width, fullRow);
    });
    const layout = renderer.update(items, width);
    // Unverified windows have no persistent per-post measurements. Use their
    // current card-height average to keep native window estimates useful even
    // when the site's original one-column heights differ greatly at this width.
    const cardHeights = local && bridge ? cells.filter((cell) => !cell.fullRow)
      .map(({ child }) => measured.get(child)).filter((height) => height > 0 && Number.isFinite(height)) : [];
    const estimate = cardHeights.length ? Math.ceil(cardHeights.reduce((sum, height) => sum + height, 0) / cardHeights.length) : null;
    const estimateChanged = estimate !== null && bridge.estimatedHeight !== estimate;
    if (estimateChanged) {
      bridge.estimatedHeight = estimate;
      bridge.geometryDirty = true;
    }
    const geometryChanged = bridge && !local && (layout.positions.length !== bridge.geometry.positions.length ||
      layout.positions.some((p, i) => p.top !== bridge.geometry.positions[i].top || layout.heights[i] !== bridge.geometry.heights[i]));
    const offset = local && bridge ? Math.min(...bridge.geometry.positions.slice(bridge.start,
      bridge.start + bridge.rendered.length).map((p) => p.top), Infinity) : 0;
    const top = Number.isFinite(offset) ? offset : 0;
    const positions = new Map(items.map((item, i) => [item.key, layout.positions[i]]));
    cells.forEach(({ child, item }) => {
      const position = item && positions.get(item.key);
      if (!position) return;
      positionStyle(child, '--xps-card-x', `${position.left}px`);
      positionStyle(child, '--xps-card-y', `${position.top + top}px`);
    });
    positionStyle(container, '--xps-feed-height', `${Math.max(layout.height + top,
      local && bridge ? bridge.geometry.height : 0)}px`);
    setStatus('active');
    if (layoutChanged) document.dispatchEvent(new Event('xps-masonry-change'));
    if (bridge && !local) bridge.geometry = layout;
    if (geometryChanged || estimateChanged) refresh(bridge.scroller);
    checkNearEnd(container);
  }

  function checkNearEnd(container) {
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
    if (records.some((r) => (r.type === 'attributes' && r.target instanceof Element &&
      r.target.closest('[data-testid="primaryColumn"]')) || [...r.addedNodes, ...r.removedNodes].some((n) =>
      n instanceof Element && !n.closest('#xps-masonry-keys, #xps-panel, .xps-save-btn, .xps-fact-btn') &&
      !n.matches('.xps-nav-toggle, #xps-masonry-keys')))) wake();
  }).observe(document.body, { subtree: true, childList: true, attributes:true, attributeFilter:['href'] });
  window.addEventListener('resize', () => { viewportDirty = true; wake(); });
  window.addEventListener('scroll', () => {
    viewportDirty = true;
    if (!active) wake();
    else schedule();
  }, { passive: true });
  window.addEventListener('popstate', wake);
  // No history/global monkey patch. Also catches pushState and delayed mounts.
  window.setInterval(() => { if (lastRoute !== location.pathname + location.search || (active && !active.isConnected)) wake(); }, 350);
  schedule();
  return {
    enabled: () => enabled,
    status: () => status,
    toggle() { enabled = !enabled; write('xpsMasonryEnabled', enabled); if (!enabled) release(); else { rejected = new WeakMap(); retryCount = 0; } schedule(); return enabled; },
  };
}
