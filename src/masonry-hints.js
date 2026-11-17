import { isShortcutControl } from './keyboard.js';

// Disposable viewport assignments. No native clicks, permanent post keys, or polling.
export function initMasonryHints({ permalink, eligible, openBackground }) {
  if (typeof document.elementFromPoint !== 'function') return;
  const keys = '1234567890';
  const layer = document.createElement('div');
  layer.id = 'xps-masonry-keys';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:3';
  let snapshot = null;
  let route = location.href;
  let timer = 0;
  let prefixUntil = 0;
  const observed = new Set();
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => invalidate()) : null;

  function feed() {
    if (document.hidden || /\/status\/\d+(?:\/|$)/.test(location.pathname) ||
        document.documentElement.classList.contains('xopt-status-detail') ||
        document.querySelector('.xps-nav-open')) return null;
    const layers = document.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"], [role="menu"], [aria-modal="true"], [data-testid="Dropdown"], [popover]:popover-open');
    if ([...layers].some((node) => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden')) return null;
    return document.querySelector('[data-testid="primaryColumn"] .xopt-masonry-container');
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
      // Keep raw full hrefs and anchor identities too, even if canonical URL is unchanged.
      const links = [...card.querySelectorAll('a[href*="/status/"]')].map((anchor) => [anchor, anchor.getAttribute('href')]);
      result.push({ card, source, url, links, rect: [rect.left, rect.top, rect.right, rect.bottom], patch });
    }
    return result.sort((a, b) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0]);
  }

  function same(a, b) {
    return a !== null && a.length === b.length && a.every((entry, index) => {
      const next = b[index];
      return entry.card === next.card && entry.source === next.source && entry.url === next.url &&
        entry.links.length === next.links.length && entry.links.every(([anchor, href], i) => anchor === next.links[i][0] && href === next.links[i][1]) &&
        entry.rect.every((n, i) => n === next.rect[i]) && entry.patch.every((n, i) => n === next.patch[i]);
    });
  }

  function clear() {
    snapshot = null;
    if (layer.childNodes.length) layer.replaceChildren();
  }

  function observe(entries) {
    const source = feed();
    const wanted = new Set(source ? [source, source.closest('[data-testid="primaryColumn"]'), ...entries.map((entry) => entry.card)] : []);
    for (const node of observed) if (!wanted.has(node)) { resize?.unobserve(node); observed.delete(node); }
    for (const node of wanted) if (node && !observed.has(node)) { observed.add(node); resize?.observe(node); }
  }

  function invalidate() {
    clear();
    window.clearTimeout(timer);
    timer = 0;
    route = location.href;
    if (!feed()) { observe([]); return; }
    timer = window.setTimeout(() => {
      const before = cards();
      timer = window.setTimeout(() => {
        timer = 0;
        const after = cards();
        if (route !== location.href || !same(before, after)) { invalidate(); return; }
        observe(after);
        snapshot = after;
        if (!after.length) return;
        if (!layer.isConnected) document.body.append(layer);
        after.slice(0, keys.length).forEach((entry, i) => {
          const badge = document.createElement('span');
          badge.className = 'xps-masonry-key';
          badge.textContent = keys[i];
          badge.dataset.url = entry.url;
          badge.style.cssText = `position:absolute;left:${entry.patch[0]}px;top:${entry.patch[1]}px;width:28px;height:28px;box-sizing:border-box;text-align:center;border:1px solid white;border-radius:5px;background:#202020;color:white;font:bold 16px/26px monospace;pointer-events:none;box-shadow:0 1px 4px #0008`;
          layer.append(badge);
        });
      }, 80);
    }, 100);
  }

  new MutationObserver((records) => {
    if (records.every((record) => layer.contains(record.target) ||
      (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every((node) => node === layer)))) return;
    if (route === location.href && snapshot !== null && same(snapshot, cards())) return;
    if (timer && route === location.href) return; // Busy counters must not starve settlement.
    invalidate();
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'href', 'hidden', 'inert', 'aria-hidden', 'aria-modal', 'role'] });
  window.addEventListener('scroll', invalidate, true);
  window.addEventListener('resize', invalidate);
  window.addEventListener('popstate', invalidate);
  window.addEventListener('hashchange', invalidate);
  /** @type {Window & {navigation?: EventTarget}} */ (window).navigation?.addEventListener('currententrychange', invalidate);
  document.addEventListener('visibilitychange', invalidate);
  document.addEventListener('xps-navigation-change', invalidate);
  document.fonts?.addEventListener('loadingdone', invalidate);
  for (const name of ['load', 'transitionrun', 'transitionend', 'animationstart', 'animationend']) document.addEventListener(name, invalidate, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'g' && !event.ctrlKey && !event.metaKey && !event.altKey &&
        !event.shiftKey && !isShortcutControl(event)) {
      prefixUntil = Date.now() + 1000;
      return; // Observe, never consume, X's native navigation prefix.
    }
    if (Date.now() < prefixUntil && event.key.length === 1) {
      prefixUntil = 0;
      return;
    }
    if (!keys.includes(event.key) || event.key.length !== 1 || event.defaultPrevented || event.repeat ||
        event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
        isShortcutControl(event) ||
        [event.target, document.activeElement].some((node) => node instanceof Element &&
          node.closest('nav, header[role="banner"], [role="menu"], .xps-nav-toggle'))) return;
    const current = cards();
    if (route !== location.href || !same(snapshot, current)) { invalidate(); return; }
    const index = keys.indexOf(event.key);
    const entry = snapshot?.[index];
    if (!entry || !feed()) return;
    if (openBackground(entry.url)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  invalidate();
}
