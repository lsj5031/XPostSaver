import { isShortcutControl, isNativeShortcutSequence } from './keyboard.js';

// Viewport-local assignments, keyed by card + own permalink, not layout or counters.
export function initMasonryHints({ permalink, eligible, openBackground }) {
  if (typeof document.elementFromPoint !== 'function') return;
  const keys = '1234567890deqyz';
  const layer = document.createElement('div');
  layer.id = 'xps-masonry-keys';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:3';
  const assignments = new Map();
  let route = location.href;
  let frame = 0;
  const observed = new Set();
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;

  function feed() {
    if (document.hidden || /\/status\/\d+(?:\/|$)/.test(location.pathname) ||
        document.documentElement.classList.contains('xopt-status-detail') ||
        document.querySelector('.xps-nav-open')) return null;
    const layers = document.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"], [role="menu"], [aria-modal="true"], [data-testid="Dropdown"], [popover]:popover-open');
    if ([...layers].some((node) => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden')) return null;
    return document.querySelector('[data-testid="primaryColumn"] :is(.xps-masonry-container, .xopt-masonry-container)');
  }

  function cards() {
    const source = feed();
    if (!source) return [];
    const primary = source.closest('[data-testid="primaryColumn"]');
    if (!primary) return [];
    const bounds = primary.getBoundingClientRect();
    const result = [];
    for (const card of source.querySelectorAll('article')) {
      if (card.parentElement?.closest('article, [data-testid="tweet"]') || !eligible(card) ||
          card.closest('aside, [data-testid="UserCell"]')) continue;
      const rect = card.getBoundingClientRect();
      const left = Math.max(0, rect.left, bounds.left), right = Math.min(innerWidth, rect.right, bounds.right);
      const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
      if (right - left < 36 || bottom - top < 36) continue;
      const url = permalink(card);
      if (!url) continue;
      let hidden = false;
      for (let node = /** @type {Element | null} */ (card); node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true' ||
            style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) < 0.1) {
          hidden = true;
          break;
        }
      }
      if (hidden) continue;
      let patch = /** @type {number[] | null} */ (null);
      for (const y of [top + 4, (top + bottom - 28) / 2, bottom - 32]) {
        for (const x of [left + 4, (left + right - 28) / 2, right - 32]) {
          if ([[1, 1], [27, 1], [1, 27], [27, 27], [14, 14]].every(([dx, dy]) => {
            const hit = document.elementFromPoint(x + dx, y + dy);
            return hit && card.contains(hit) && hit.closest('article') === card && eligible(hit);
          })) { patch = [x, y]; break; }
        }
        if (patch) break;
      }
      if (!patch) continue;
      result.push({ card, source, url, rect: [rect.left, rect.top, rect.right, rect.bottom], patch });
    }
    return result.sort((a, b) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0]);
  }

  function remove(card) {
    assignments.get(card)?.badge.remove();
    assignments.delete(card);
  }

  function observe(entries) {
    const source = feed();
    const wanted = new Set(source ? [source, source.closest('[data-testid="primaryColumn"]'), ...entries.map((entry) => entry.card)] : []);
    for (const node of observed) if (!wanted.has(node)) { resize?.unobserve(node); observed.delete(node); }
    for (const node of wanted) if (node && !observed.has(node)) { observed.add(node); resize?.observe(node); }
  }

  function reconcile() {
    frame = 0;
    if (route !== location.href) {
      for (const card of assignments.keys()) remove(card);
    }
    route = location.href;
    const current = cards();
    const byCard = new Map(current.map((entry) => [entry.card, entry]));
    for (const [card, entry] of assignments) {
      const next = byCard.get(card);
      if (!next || next.url !== entry.url || next.source !== entry.source) remove(card);
    }
    const available = [...keys].filter((key) => ![...assignments.values()].some((entry) => entry.key === key));
    for (const entry of current) {
      let assigned = assignments.get(entry.card);
      if (!assigned) {
        const key = available.shift();
        if (!key) continue;
        const badge = document.createElement('span');
        badge.className = 'xps-masonry-key';
        badge.textContent = key;
        badge.dataset.url = entry.url;
        badge.style.cssText = 'position:absolute;width:28px;height:28px;box-sizing:border-box;text-align:center;border:1px solid white;border-radius:5px;background:#202020;color:white;font:bold 16px/26px monospace;pointer-events:none;box-shadow:0 1px 4px #0008';
        assigned = { ...entry, key, badge };
        assignments.set(entry.card, assigned);
        if (!layer.isConnected) document.body.append(layer);
        layer.append(badge);
      }
      // Only geometry changes. Identity and the displayed key survive reflow.
      const [x, y] = entry.patch;
      if (assigned.badge.style.left !== `${x}px`) assigned.badge.style.left = `${x}px`;
      if (assigned.badge.style.top !== `${y}px`) assigned.badge.style.top = `${y}px`;
    }
    observe(current);
  }

  function schedule() {
    if (assignments.size && (route !== location.href || !feed())) {
      for (const card of assignments.keys()) remove(card);
    }
    if (!frame) frame = requestAnimationFrame(reconcile);
  }

  new MutationObserver((records) => {
    if (records.every((record) => layer.contains(record.target) ||
      (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every((node) => node === layer)))) return;
    schedule();
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'href', 'hidden', 'inert', 'aria-hidden', 'aria-modal', 'role'] });
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  window.addEventListener('popstate', schedule);
  window.addEventListener('hashchange', schedule);
  /** @type {Window & {navigation?: EventTarget}} */ (window).navigation?.addEventListener('currententrychange', schedule);
  document.addEventListener('visibilitychange', schedule);
  document.addEventListener('xps-navigation-change', schedule);
  document.addEventListener('xps-masonry-change', schedule);
  document.fonts?.addEventListener('loadingdone', schedule);
  // Media dimensions are also observed. Unrelated site animations are not layout signals.
  document.addEventListener('load', (event) => {
    if (event.target instanceof Element && feed()?.contains(event.target)) schedule();
  }, true);
  document.addEventListener('keydown', (event) => {
    if (isNativeShortcutSequence(event)) return;
    if (!keys.includes(event.key) || event.key.length !== 1 || event.defaultPrevented || event.repeat ||
        event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
        isShortcutControl(event) ||
        [event.target, document.activeElement].some((node) => node instanceof Element &&
          node.closest('nav, header[role="banner"], [role="menu"], .xps-nav-toggle'))) return;
    const entry = [...assignments.values()].find((assigned) => assigned.key === event.key);
    // Independently validate the selected mapping, even before a queued frame runs.
    const valid = route === location.href && entry && cards().some((current) =>
      current.card === entry.card && current.source === entry.source && current.url === entry.url);
    if (!valid) {
      if (entry) remove(entry.card);
      schedule();
      return;
    }
    if (openBackground(entry.url)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  schedule();
}
