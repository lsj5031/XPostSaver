// Minimal layout compatibility only. Native navigation nodes are never cloned.
import css from './masonry-navigation.css';

export function initMasonryNavigation() {
  if (typeof window.matchMedia !== 'function') return;
  const style = document.createElement('style');
  document.head.append(style);
  const media = window.matchMedia('(min-width: 1000px) and (orientation: landscape)');
  let header = /** @type {HTMLElement | null} */ (null);
  let source = /** @type {Element | null} */ (null);
  let surface = /** @type {HTMLElement | null} */ (null);
  let toggle = /** @type {HTMLButtonElement | null} */ (null);
  let open = false;
  let queued = false;
  const marked = new Map();
  const attributes = new Map();

  function mark(element, name) {
    if (!marked.has(element)) marked.set(element, new Set());
    marked.get(element).add(name);
    if (!element.classList.contains(name)) element.classList.add(name);
  }

  function ownAttribute(element, name, value) {
    if (!attributes.has(element)) attributes.set(element, new Map());
    const attrs = attributes.get(element);
    const current = element.getAttribute(name);
    if (!attrs.has(name)) attrs.set(name, { original:current, last:current });
    const entry = attrs.get(name);
    if (current !== entry.last) entry.original = current; // Preserve intervening native changes.
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
    entry.last = value;
  }

  function releaseAttribute(element, name) {
    const entry = attributes.get(element)?.get(name);
    if (!entry || element.getAttribute(name) !== entry.last) return;
    if (entry.original === null) element.removeAttribute(name);
    else element.setAttribute(name, entry.original);
    entry.last = entry.original;
  }

  function change(expanded, restore = false) {
    open = expanded;
    header?.classList.toggle('xps-nav-open', expanded);
    if (surface) {
      if (!expanded && surface.contains(document.activeElement)) restore = true;
      // Move focus before making its old subtree inert.
      if (restore) toggle?.focus({ preventScroll: true });
    }
    for (const node of [header, surface]) {
      if (!node) continue;
      if (expanded) {
        releaseAttribute(node, 'inert');
        releaseAttribute(node, 'aria-hidden');
      } else {
        ownAttribute(node, 'inert', '');
        ownAttribute(node, 'aria-hidden', 'true');
      }
    }
    toggle?.setAttribute('aria-expanded', String(expanded));
    toggle?.setAttribute('aria-label', expanded ? 'Close navigation' : 'Open navigation');
    document.dispatchEvent(new Event('xps-navigation-change'));
    if (expanded) {
      const link = surface?.querySelector('nav a, nav button, nav [role="button"]');
      if (link instanceof HTMLElement) link.focus({ preventScroll: true });
    }
  }

  function reset() {
    const focused = document.activeElement === toggle;
    for (const [element, names] of marked) for (const name of names) element.classList.remove(name);
    marked.clear();
    for (const [element, attrs] of attributes) {
      for (const name of attrs.keys()) releaseAttribute(element, name);
    }
    attributes.clear();
    header?.classList.remove('xps-nav-open');
    if (focused && header?.isConnected) {
      const link = header.querySelector('nav a');
      if (link instanceof HTMLElement) link.focus({ preventScroll: true });
    }
    toggle?.remove();
    document.documentElement.classList.remove('xps-masonry-nav');
    header = null;
    source = null;
    surface = null;
    toggle = null;
    open = false;
    document.dispatchEvent(new Event('xps-navigation-change'));
  }

  function reconcile() {
    queued = false;
    const nextSource = media.matches
      ? document.querySelector('[data-testid="primaryColumn"] :is(.xps-masonry-container, .xopt-masonry-container)') : null;
    const candidate = nextSource ? document.querySelector('header[role="banner"]') : null;
    const nextHeader = candidate?.querySelector('nav') ? candidate : null;
    const nextSurface = nextHeader?.firstElementChild;
    if (header !== nextHeader || source !== nextSource || surface !== nextSurface) reset();
    if (!(nextHeader instanceof HTMLElement) || !(nextSurface instanceof HTMLElement)) return;
    if (!header) {
      let background = 'Canvas';
      for (let node = /** @type {Element | null} */ (nextSurface); node; node = node.parentElement) {
        const value = getComputedStyle(node).backgroundColor;
        if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') { background = value; break; }
      }
      style.textContent = `${css}\n.xps-nav-header, .xps-nav-toggle { --xps-nav-background: ${background}; --xps-nav-color: ${getComputedStyle(nextHeader).color}; }`;
      header = nextHeader;
      source = nextSource;
      surface = nextSurface;
      mark(header, 'xps-nav-header');
      mark(surface, 'xps-nav-surface');
      document.documentElement.classList.add('xps-masonry-nav');
      toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'xps-nav-toggle';
      ownAttribute(surface, 'id', surface.id || 'xps-native-navigation');
      toggle.setAttribute('aria-controls', surface.id);
      toggle.addEventListener('click', () => change(!open, open));
      document.body.append(toggle);
      change(false);
    }
    // Clear width caps/margins along the feed's entire outer layout chain.
    for (let node = nextSource?.parentElement; node && node !== document.body; node = node.parentElement) mark(node, 'xps-feed-width');
    for (const control of header.querySelectorAll(
      'nav a, nav button, nav [role="button"], a[data-testid="SideNav_NewTweet_Button"], [data-testid="SideNav_AccountSwitcher_Button"], h1 a',
    )) {
      if (control.closest('[role="menu"], [role="dialog"], [data-testid="Dropdown"]')) continue;
      for (let node = control.parentElement; node && node !== header; node = node.parentElement) mark(node, 'xps-nav-width');
      // Native X links often wrap icon + label in an inner pill.
      const icon = control.querySelector('[data-testid^="UserAvatar-Container"]') || control.querySelector('svg');
      if (!icon) continue;
      let branch = icon;
      while (branch.parentElement) {
        const parent = branch.parentElement;
        if (branch !== icon || parent === control || !(icon instanceof SVGElement)) {
          for (const sibling of parent.children) if (sibling !== branch) mark(sibling, 'xps-nav-label');
        }
        if (parent === control) break;
        branch = parent;
      }
    }
    // Release detached inner navigation/layout nodes between SPA updates.
    for (const [element, names] of marked) {
      if (element.isConnected) continue;
      for (const name of names) element.classList.remove(name);
      marked.delete(element);
    }
  }

  function schedule() {
    if (!queued) { queued = true; queueMicrotask(reconcile); }
  }
  new MutationObserver((records) => {
    if (records.some((record) => {
      if (record.type === 'childList') return [...record.addedNodes, ...record.removedNodes]
        .some((node) => node instanceof Element && !node.matches('.xps-nav-toggle, #xps-masonry-keys, #xps-masonry-keys *'));
      if (!(record.target instanceof Element)) return false;
      const nativeClasses = (value) => (value || '').split(/\s+/).filter((name) => !name.startsWith('xps-')).join(' ');
      return nativeClasses(record.oldValue) !== nativeClasses(record.target.getAttribute('class'));
    })) schedule();
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  media.addEventListener('change', schedule);
  document.addEventListener('xps-masonry-change', schedule);
  document.addEventListener('keydown', (event) => {
    if (!open || event.key !== 'Escape' || event.defaultPrevented) return;
    if ([...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"], [data-testid="Dropdown"]')]
      .some((layer) => layer.getClientRects().length && getComputedStyle(layer).visibility !== 'hidden')) return;
    event.preventDefault();
    event.stopPropagation();
    change(false, true);
  }, true);
  document.addEventListener('click', (event) => {
    if (!open || !(event.target instanceof Node) || header?.contains(event.target) || toggle?.contains(event.target)) return;
    if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"], [data-testid="Dropdown"]')) return;
    change(false);
  });
  reconcile();
}
