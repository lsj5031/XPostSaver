// @ts-check
/**
 * @typedef {typeof globalThis & {
 *   GM_getValue?: (key: string, defaultValue?: unknown) => unknown;
 *   GM_setValue?: (key: string, value: unknown) => void;
 * }} GlobalWithGM
 */
import {
  nowIso,
  tweetIdFromUrl,
  sanitizePost,
  canonicalizeStatusUrl,
  normalizeUrlForCompare,
  getPostKeyFromUrl,
  getPostKey,
  normalizeSavedPosts,
  isLikelyImageMediaUrl,
  withOriginalImageSize,
  normalizeUiLabel,
} from './utils.js';
import { tryCommitSavedPosts } from './storage.js';
import {
  ARTICLE_READ_VIEW_SELECTOR,
  findActionBar,
  getMutationArticle,
  isArticleReadView,
  removeStaleSaveButtons,
} from './dom.js';

const STORAGE_KEY = 'xSavedPosts';
const STORAGE_SYNC_KEY = 'xpsSync';
const STORAGE_SOFT_LIMIT = 2000;
const STORAGE_WARN_THRESHOLD = 1800;

const UI = {
  styleId: 'xps-style',
  panelId: 'xps-panel',
  toastId: 'xps-toast',
};

function safeLocalStorageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeLocalStorageRemove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function storageGet(key) {
  const gm = /** @type {GlobalWithGM} */ (globalThis);
  if (typeof gm.GM_getValue === 'function') {
    try {
      return gm.GM_getValue(key, null);
    } catch {
      // ignore
    }
  }

  return safeLocalStorageGet(key);
}

function storageSet(key, value) {
  const gm = /** @type {GlobalWithGM} */ (globalThis);
  if (typeof gm.GM_setValue === 'function') {
    try {
      gm.GM_setValue(key, value);
      return true;
    } catch {
      return false;
    }
  }

  return safeLocalStorageSet(key, value);
}

function migrateLegacyStorage() {
  const gm = /** @type {GlobalWithGM} */ (globalThis);
  if (typeof gm.GM_getValue !== 'function' || typeof gm.GM_setValue !== 'function') return;

  let existing = null;
  try {
    existing = gm.GM_getValue(STORAGE_KEY, null);
  } catch {
    existing = null;
  }

  if (existing != null) return;

  const legacy = safeLocalStorageGet(STORAGE_KEY);
  if (!legacy) return;

  try {
    gm.GM_setValue(STORAGE_KEY, legacy);
  } catch {
    return;
  }

  safeLocalStorageRemove(STORAGE_KEY);
}

function broadcastStorageUpdate() {
  safeLocalStorageSet(STORAGE_SYNC_KEY, String(Date.now()));
}

function loadSavedPosts() {
  const raw = storageGet(STORAGE_KEY);
  if (!raw) return [];

  if (Array.isArray(raw)) return normalizeSavedPosts(raw);
  if (typeof raw !== 'string') return [];

  try {
    return normalizeSavedPosts(JSON.parse(raw));
  } catch {
    return [];
  }
}

function persistSavedPosts(posts) {
  const ok = storageSet(STORAGE_KEY, JSON.stringify(posts));
  if (!ok) {
    toast('Could not save (storage quota or blocked).', { type: 'error' });
    return false;
  }

  broadcastStorageUpdate();
  return true;
}

function commitSavedPosts(nextPosts) {
  const result = tryCommitSavedPosts(savedPosts, nextPosts, persistSavedPosts);
  if (!result.committed) return false;

  savedPosts = /** @type {typeof savedPosts} */ (result.posts);
  rebuildIndex();
  return true;
}

migrateLegacyStorage();

let savedPosts = loadSavedPosts();
let savedKeySet = new Set(savedPosts.map((p) => getPostKey(p)).filter(Boolean));
let storageWarned = false;

function rebuildIndex() {
  savedKeySet = new Set(savedPosts.map((p) => getPostKey(p)).filter(Boolean));
}

function isSaved(url) {
  const key = getPostKeyFromUrl(url);
  if (!key) return false;
  return savedKeySet.has(key);
}

function maybeWarnStorageLimit() {
  if (savedPosts.length >= STORAGE_WARN_THRESHOLD) {
    if (!storageWarned) {
      toast('You are approaching the saved-posts limit. Consider exporting or clearing older items.', {
        type: 'error',
      });
      storageWarned = true;
    }
    return;
  }

  storageWarned = false;
}

function addPost(post) {
  if (!post || typeof post !== 'object' || !post.url) return false;
  if (isSaved(post.url)) return false;

  if (savedPosts.length >= STORAGE_SOFT_LIMIT) {
    toast('Storage limit reached. Export or clear before saving more.', { type: 'error' });
    return false;
  }

  const newPost = sanitizePost(post, { defaultSavedAt: nowIso() });
  if (!newPost) return false;

  if (!commitSavedPosts([newPost, ...savedPosts])) return false;

  updatePanelCount();
  updateButtonsForUrl(newPost.url);
  maybeWarnStorageLimit();
  scheduleScan(document);
  return true;
}

function removePost(url) {
  if (!url || !isSaved(url)) return false;

  const key = getPostKeyFromUrl(url);
  if (!key) return false;

  const nextPosts = savedPosts.filter((p) => getPostKey(p) !== key);
  if (!commitSavedPosts(nextPosts)) return false;

  updatePanelCount();
  updateButtonsForUrl(url);
  maybeWarnStorageLimit();
  scheduleScan(document);
  return true;
}

function buildJsonl() {
  return savedPosts.map((p) => JSON.stringify(p)).join('\n') + (savedPosts.length ? '\n' : '');
}

function downloadJsonl() {
  if (savedPosts.length === 0) {
    toast('No saved posts to export.');
    return;
  }

  const filename = `x-saved-posts-${nowIso().slice(0, 10)}.jsonl`;
  const blob = new Blob([buildJsonl()], { type: 'application/x-ndjson;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  a.style.display = 'none';

  document.body.appendChild(a);
  a.click();
  a.remove();

  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

async function copyJsonlToClipboard() {
  if (savedPosts.length === 0) {
    toast('No saved posts to copy.');
    return;
  }

  const text = buildJsonl();

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      toast('Copied JSONL to clipboard.');
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    textarea.style.left = '-1000px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();

    if (!ok) throw new Error('Copy failed');

    toast('Copied JSONL to clipboard.');
  } catch {
    toast('Copy failed (permission blocked?).', { type: 'error' });
  }
}

function buildUrlList() {
  return savedPosts.map((p) => p.url).join('\n') + (savedPosts.length ? '\n' : '');
}

function downloadUrlList() {
  if (savedPosts.length === 0) {
    toast('No saved posts to export.');
    return;
  }

  const filename = `x-saved-posts-${nowIso().slice(0, 10)}.txt`;
  const blob = new Blob([buildUrlList()], { type: 'text/plain;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  a.style.display = 'none';

  document.body.appendChild(a);
  a.click();
  a.remove();

  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

async function copyUrlListToClipboard() {
  if (savedPosts.length === 0) {
    toast('No saved posts to copy.');
    return;
  }

  const text = buildUrlList();

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      toast('Copied URLs to clipboard.');
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    textarea.style.left = '-1000px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();

    if (!ok) throw new Error('Copy failed');

    toast('Copied URLs to clipboard.');
  } catch {
    toast('Copy failed (permission blocked?).', { type: 'error' });
  }
}

function clearAllPosts() {
  if (savedPosts.length === 0) {
    toast('Nothing to clear.');
    return;
  }

  if (!confirm(`Clear ${savedPosts.length} saved posts?`)) return;

  if (!commitSavedPosts([])) return;

  updatePanelCount();
  updateAllButtons();
  toast('Cleared saved posts.');
}

let toastTimer = 0;
function toast(message, { timeoutMs = 2200, type = 'info' } = {}) {
  let el = document.getElementById(UI.toastId);
  if (!el) {
    el = document.createElement('div');
    el.id = UI.toastId;
    document.body.appendChild(el);
  }

  el.textContent = String(message || '');
  el.dataset.type = type;
  el.dataset.show = '1';

  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    const current = document.getElementById(UI.toastId);
    if (current) current.dataset.show = '0';
  }, timeoutMs);
}

let panelCountEl = null;
function updatePanelCount() {
  if (!panelCountEl) return;
  panelCountEl.textContent = `(${savedPosts.length})`;
}

function updateSavedPostsFromStorage() {
  savedPosts = loadSavedPosts();
  rebuildIndex();
  updatePanelCount();
  updateAllButtons();
  maybeWarnStorageLimit();
  scheduleScan(document);
}

function ensureStyles() {
  if (document.getElementById(UI.styleId)) return;

  const style = document.createElement('style');
  style.id = UI.styleId;
  style.textContent = `
    #${UI.panelId} {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483647;
      display: flex;
      gap: 8px;
      padding: 8px;
      border-radius: 999px;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(6px);
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    }

    #${UI.panelId} > button {
      appearance: none;
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: rgba(0, 0, 0, 0.55);
      color: #fff;
      padding: 8px 12px;
      border-radius: 999px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
    }

    #${UI.panelId} > button:hover {
      background: rgba(255, 255, 255, 0.08);
    }

    #${UI.toastId} {
      position: fixed;
      right: 16px;
      bottom: 72px;
      z-index: 2147483647;
      max-width: min(420px, calc(100vw - 32px));
      background: rgba(0, 0, 0, 0.82);
      color: #fff;
      padding: 10px 12px;
      border-radius: 10px;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      font-size: 13px;
      line-height: 1.2;
      opacity: 0;
      transform: translateY(6px);
      transition: opacity 160ms ease, transform 160ms ease;
      pointer-events: none;
    }

    #${UI.toastId}[data-show="1"] {
      opacity: 1;
      transform: translateY(0);
    }

    #${UI.toastId}[data-type="error"] {
      background: rgba(140, 10, 10, 0.88);
    }

    button.xps-save-btn {
      appearance: none;
      border: 1px solid rgba(128, 128, 128, 0.35);
      background: transparent;
      color: inherit;
      cursor: pointer;
      user-select: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      /* X action bars use align-items: stretch; with an explicit height the
         pill would top-align, so center it against the native icon buttons. */
      align-self: center;
      height: 30px;
      padding: 0 10px;
      margin-left: 8px;
      border-radius: 999px;
      font: inherit;
      font-size: 12px;
      line-height: 1;
    }

    button.xps-save-btn:hover {
      background: rgba(29, 155, 240, 0.12);
      border-color: rgba(29, 155, 240, 0.6);
    }

    button.xps-save-btn.xps-saved {
      border-color: rgba(0, 186, 124, 0.75);
      color: rgba(0, 186, 124, 1);
    }

    button.xps-save-btn.xps-saved:hover {
      background: rgba(0, 186, 124, 0.12);
    }

    .xps-save-label {
      font-weight: 700;
    }
  `;

  (document.head || document.documentElement).appendChild(style);
}

function ensurePanel() {
  if (document.getElementById(UI.panelId)) return;

  const panel = document.createElement('div');
  panel.id = UI.panelId;

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.addEventListener('click', downloadJsonl);

  const exportText = document.createElement('span');
  exportText.textContent = 'Export ';

  panelCountEl = document.createElement('span');
  panelCountEl.textContent = '(0)';

  exportBtn.appendChild(exportText);
  exportBtn.appendChild(panelCountEl);

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', () => {
    void copyJsonlToClipboard();
  });

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.textContent = 'Clear';
  clearBtn.addEventListener('click', clearAllPosts);

  const exportUrlsBtn = document.createElement('button');
  exportUrlsBtn.type = 'button';
  exportUrlsBtn.textContent = 'Export URLs';
  exportUrlsBtn.addEventListener('click', downloadUrlList);

  const copyUrlsBtn = document.createElement('button');
  copyUrlsBtn.type = 'button';
  copyUrlsBtn.textContent = 'Copy URLs';
  copyUrlsBtn.addEventListener('click', () => {
    void copyUrlListToClipboard();
  });

  panel.appendChild(exportBtn);
  panel.appendChild(copyBtn);
  panel.appendChild(exportUrlsBtn);
  panel.appendChild(copyUrlsBtn);
  panel.appendChild(clearBtn);

  (document.documentElement || document.body).appendChild(panel);
  updatePanelCount();
}

function getTweetPermalink(tweetElement) {
  const containerArticle =
    tweetElement instanceof Element && tweetElement.matches('article') ? tweetElement : null;

  const timeEls = tweetElement.querySelectorAll ? tweetElement.querySelectorAll('time') : [];
  for (const timeEl of timeEls) {
    if (containerArticle) {
      const closestArticle = timeEl.closest('article');
      if (closestArticle && closestArticle !== containerArticle) continue;
    }

    const link = timeEl.closest('a[href*="/status/"]');
    const href = link ? link.getAttribute('href') : null;
    if (!href) continue;

    try {
      const abs = new URL(href, 'https://x.com').toString();
      const canonical = canonicalizeStatusUrl(abs);
      if (canonical) return canonical;
    } catch {
      // ignore
    }
  }

  // Quoted/embedded posts sometimes don't render a <time> element.
  const statusLinks = tweetElement.querySelectorAll ? tweetElement.querySelectorAll('a[href*="/status/"]') : [];

  const candidates = [];
  const quoteContainerSelector =
    '[data-testid="testCondensedMedia"], [data-testid="embeddedTweet"], div[aria-label="Embedded Tweet"], div[aria-label="Embedded Post"], div[aria-label="Embedded post"]';

  for (const link of statusLinks) {
    if (containerArticle) {
      const closestArticle = link.closest('article');
      if (closestArticle && closestArticle !== containerArticle) continue;
    }

    const href = link.getAttribute ? link.getAttribute('href') : null;
    if (!href) continue;

    try {
      const abs = new URL(href, 'https://x.com').toString();
      const canonical = canonicalizeStatusUrl(abs);
      if (canonical) candidates.push({ url: canonical, link });
    } catch {
      // ignore
    }
  }

  if (candidates.length === 0) return null;

  // When extracting the *main* tweet URL, avoid picking URLs from quoted tweet cards.
  if (containerArticle) {
    const preferred = candidates.find((c) => !c.link.closest(quoteContainerSelector));
    if (preferred) return preferred.url;
  }

  return candidates[0].url;
}

function findFirstWithinArticle(root, selector, containerArticle) {
  const els = root.querySelectorAll ? root.querySelectorAll(selector) : [];

  for (const el of els) {
    if (containerArticle) {
      const closestArticle = el.closest('article');
      if (closestArticle && closestArticle !== containerArticle) continue;
    }

    return el;
  }

  return null;
}

function extractAuthorAndHandle(tweetElement, url) {
  const containerArticle =
    tweetElement instanceof Element && tweetElement.matches('article') ? tweetElement : null;

  const userNameEl = findFirstWithinArticle(tweetElement, '[data-testid="User-Name"]', containerArticle);

  let author = '';
  let handle = '';

  if (userNameEl) {
    const lines = String(userNameEl.innerText || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => s !== '·')
      .filter((s) => !/^follows you$/i.test(s))
      .filter((s) => !/^promoted$/i.test(s));

    handle = lines.find((s) => s.startsWith('@')) || '';
    author = lines.find((s) => !s.startsWith('@')) || '';
  }

  if (!handle && url) {
    const match = url.match(/x\.com\/([^/]+)\/status\//i);
    if (match && match[1]) handle = `@${match[1]}`;
  }

  return { author, handle };
}

function findTweetTextElement(tweetElement, containerArticle) {
  return findFirstWithinArticle(tweetElement, '[data-testid="tweetText"]', containerArticle);
}

function findLongformTextElement(tweetElement, containerArticle) {
  return (
    findFirstWithinArticle(tweetElement, '[data-testid="longformRichTextComponent"]', containerArticle) ||
    findFirstWithinArticle(tweetElement, '[data-testid="twitterArticleRichTextView"]', containerArticle)
  );
}

function findLongformTitleElement(tweetElement, containerArticle) {
  return findFirstWithinArticle(tweetElement, '[data-testid="twitter-article-title"]', containerArticle);
}

function extractTextFromElement(el) {
  if (!el) return '';
  return String(el.innerText || el.textContent || '').trim();
}

function findShowMoreControl(root) {
  if (!root || !root.querySelectorAll) return null;

  const candidates = root.querySelectorAll(
    'button, div[role="button"], span[role="button"], a[role="link"], a[href]'
  );

  for (const el of candidates) {
    const label = normalizeUiLabel(el.innerText || el.textContent || '');
    if (/^show more$/i.test(label)) return el;
  }

  return null;
}

function isWithinSameArticle(el, containerArticle) {
  if (!containerArticle) return true;
  if (!(el instanceof Element)) return false;

  const closestArticle = el.closest('article');
  return !closestArticle || closestArticle === containerArticle;
}

function resolveShowMoreClickable(control) {
  if (!(control instanceof Element)) return null;

  const button = control.closest('button');
  if (button) return button;

  const roleButton = control.closest('[role="button"]');
  if (roleButton) return roleButton;

  return control;
}

function findShowMoreNearTweetText(tweetElement, containerArticle, textEl) {
  // X sometimes renders "Show more" as a sibling of the tweetText node.
  let node = textEl;
  for (let depth = 0; depth < 6 && node; depth++) {
    const found = findShowMoreControl(node);
    if (found && isWithinSameArticle(found, containerArticle)) return found;

    if (containerArticle && node === containerArticle) break;
    node = node.parentElement;
  }

  const root = containerArticle || tweetElement;
  const found = findShowMoreControl(root);
  if (found && isWithinSameArticle(found, containerArticle)) return found;

  return null;
}

function safeClickControl(el) {
  if (!(el instanceof Element)) return false;

  const htmlEl = /** @type {HTMLElement} */ (el);

  try {
    htmlEl.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  } catch {
    // ignore
  }

  try {
    // If X uses <a> for "Show more", prevent navigation but still allow the click handler.
    if (el.tagName === 'A') {
      el.addEventListener(
        'click',
        (e) => {
          e.preventDefault();
        },
        { capture: true, once: true }
      );
    }

    htmlEl.click();
    return true;
  } catch {
    return false;
  }
}

async function expandShowMoreIfPresent(tweetElement, containerArticle) {
  const originalTextEl = findTweetTextElement(tweetElement, containerArticle);
  if (!originalTextEl) return false;

  let expanded = false;

  for (let attempt = 0; attempt < 3; attempt++) {
    const textEl = findTweetTextElement(tweetElement, containerArticle) || originalTextEl;
    const before = normalizeUiLabel(textEl.innerText || '');

    const showMoreControl = findShowMoreNearTweetText(tweetElement, containerArticle, textEl);
    if (!showMoreControl) break;

    const clickable = resolveShowMoreClickable(showMoreControl);
    if (!clickable || !isWithinSameArticle(clickable, containerArticle)) break;

    const clicked = safeClickControl(clickable);
    if (!clicked) break;

    const start = Date.now();
    let changed = false;

    while (Date.now() - start < 2000) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));

      const currentTextEl = findTweetTextElement(tweetElement, containerArticle) || textEl;
      const after = normalizeUiLabel(currentTextEl.innerText || '');

      if (after && after.length > before.length + 5) {
        changed = true;
        break;
      }

      if (!findShowMoreNearTweetText(tweetElement, containerArticle, currentTextEl) && after && after !== before) {
        changed = true;
        break;
      }
    }

    if (!changed) break;
    expanded = true;
  }

  return expanded;
}

function extractTweetText(tweetElement, containerArticle) {
  const textEl = findTweetTextElement(tweetElement, containerArticle);
  if (!textEl) {
    const title = extractTextFromElement(findLongformTitleElement(tweetElement, containerArticle));
    const longform = extractTextFromElement(findLongformTextElement(tweetElement, containerArticle));

    if (title && longform) {
      const normalizedTitle = normalizeUiLabel(title);
      const normalizedLongform = normalizeUiLabel(longform);
      if (normalizedTitle && normalizedLongform.startsWith(normalizedTitle)) return longform;
      return `${title}\n\n${longform}`;
    }

    return longform || title;
  }

  const showMoreControl = findShowMoreControl(textEl);
  const showMoreLabel = showMoreControl
    ? String(showMoreControl.innerText || showMoreControl.textContent || '').trim()
    : '';

  const visible = String(textEl.innerText || '').trim();

  if (showMoreLabel && visible && visible.toLowerCase().endsWith(showMoreLabel.toLowerCase())) {
    const withoutLabel = visible.slice(0, Math.max(0, visible.length - showMoreLabel.length)).trim();

    const raw = String(textEl.textContent || '').trim();
    if (raw && raw.length > withoutLabel.length) {
      const rawWithoutLabel = raw.replace(showMoreLabel, '').trim();
      if (rawWithoutLabel.length > withoutLabel.length) return rawWithoutLabel;
    }

    return withoutLabel;
  }

  return visible;
}

function extractLinks(tweetElement, containerArticle) {
  const out = [];
  const seen = new Set();

  function add(raw) {
    if (!raw || typeof raw !== 'string') return;

    let abs = '';
    try {
      abs = new URL(raw, window.location.href).toString();
    } catch {
      return;
    }

    if (!abs) return;

    try {
      const u = new URL(abs);
      const host = u.hostname.replace(/^www\./, '').toLowerCase();
      if (host === 'x.com' || host === 'twitter.com' || host === 'mobile.twitter.com') return;
    } catch {
      // ignore
    }

    if (seen.has(abs)) return;
    seen.add(abs);
    out.push(abs);
  }

  const contentRoots = [];
  const textEl = findTweetTextElement(tweetElement, containerArticle);
  if (textEl) contentRoots.push(textEl);

  const longformEl = findLongformTextElement(tweetElement, containerArticle);
  if (longformEl && !contentRoots.includes(longformEl)) contentRoots.push(longformEl);

  const longformTitleEl = findLongformTitleElement(tweetElement, containerArticle);
  if (longformTitleEl && !contentRoots.includes(longformTitleEl)) contentRoots.push(longformTitleEl);

  for (const root of contentRoots) {
    const anchors = root.querySelectorAll ? root.querySelectorAll('a[href]') : [];
    for (const a of anchors) {
      const expanded = a.getAttribute('data-expanded-url');
      const title = a.getAttribute('title');
      const href = a.getAttribute('href');

      if (expanded && /^https?:\/\//i.test(expanded)) add(expanded);
      else if (title && /^https?:\/\//i.test(title)) add(title);
      else add(href);
    }
  }

  const tcoAnchors = tweetElement.querySelectorAll
    ? tweetElement.querySelectorAll('a[href*="t.co/"]')
    : [];

  for (const a of tcoAnchors) {
    if (containerArticle) {
      const closestArticle = a.closest('article');
      if (closestArticle && closestArticle !== containerArticle) continue;
    }

    add(a.getAttribute('href'));
  }

  return out;
}

function extractMedia(tweetElement, containerArticle) {
  const media = [];
  const seen = new Set();

  function add(type, raw) {
    if (!raw || typeof raw !== 'string') return;

    let abs = '';
    try {
      abs = new URL(raw, window.location.href).toString();
    } catch {
      return;
    }

    if (!abs) return;

    let finalUrl = abs;

    if (type === 'photo') {
      if (!isLikelyImageMediaUrl(abs)) return;
      finalUrl = withOriginalImageSize(abs);
    } else if (type === 'video_poster' || type === 'thumb') {
      if (!isLikelyImageMediaUrl(abs)) return;
    } else if (type === 'video') {
      if (!/^https?:\/\//i.test(abs)) return;
      if (abs.startsWith('blob:')) return;
    }

    const key = `${type}|${finalUrl}`;
    if (seen.has(key)) return;
    seen.add(key);
    media.push({ type, url: finalUrl });
  }

  const imgs = tweetElement.querySelectorAll ? tweetElement.querySelectorAll('img[src]') : [];
  for (const img of imgs) {
    if (containerArticle) {
      const closestArticle = img.closest('article');
      if (closestArticle && closestArticle !== containerArticle) continue;
    }

    const src = img.getAttribute('src');
    if (!src) continue;

    let abs = '';
    try {
      abs = new URL(src, window.location.href).toString();
    } catch {
      continue;
    }

    if (!isLikelyImageMediaUrl(abs)) continue;

    let type = 'thumb';
    try {
      const path = new URL(abs).pathname.toLowerCase();
      type = path.includes('/media/') ? 'photo' : 'thumb';
    } catch {
      // ignore
    }

    add(type, abs);
  }

  const videos = tweetElement.querySelectorAll ? tweetElement.querySelectorAll('video') : [];
  for (const video of videos) {
    if (containerArticle) {
      const closestArticle = video.closest('article');
      if (closestArticle && closestArticle !== containerArticle) continue;
    }

    const poster = video.getAttribute('poster');
    if (poster) add('video_poster', poster);

    const src = video.currentSrc || video.getAttribute('src') || '';
    if (src) add('video', src);

    const sources = video.querySelectorAll ? video.querySelectorAll('source[src]') : [];
    for (const source of sources) {
      const s = source.getAttribute('src');
      if (s) add('video', s);
    }
  }

  return media;
}

function findQuotedTweetArticle(tweetArticle, outerUrl) {
  if (!tweetArticle || !tweetArticle.querySelectorAll) return null;

  const outerNorm = normalizeUrlForCompare(outerUrl);

  // Some layouts wrap the quoted post in a dedicated container.
  const embedded = tweetArticle.querySelector(
    '[data-testid="embeddedTweet"], div[aria-label="Embedded Tweet"], div[aria-label="Embedded Post"], div[aria-label="Embedded post"]'
  );

  if (embedded) {
    let root = embedded;
    if (embedded.matches && embedded.matches('article')) {
      root = embedded;
    } else if (embedded.querySelector) {
      root = embedded.querySelector('article') || embedded;
    }

    const url = getTweetPermalink(root);
    if (url && normalizeUrlForCompare(url) !== outerNorm) return root;
  }

  // Quote cards can render without a nested <article> (e.g. data-testid="testCondensedMedia").
  const condensedCards = tweetArticle.querySelectorAll('[data-testid="testCondensedMedia"]');
  for (const card of condensedCards) {
    const hasTweetText = card.querySelector ? !!card.querySelector('[data-testid="tweetText"]') : false;
    const hasUser = card.querySelector ? !!card.querySelector('[data-testid="User-Name"]') : false;
    if (!hasTweetText && !hasUser) continue;

    const url = getTweetPermalink(card);
    if (!url) continue;

    if (normalizeUrlForCompare(url) === outerNorm) continue;
    return card;
  }

  // Some quote cards render as a clickable div[role="link"] card (no nested <article> and no testCondensedMedia).
  const outerTextEl = findFirstWithinArticle(tweetArticle, '[data-testid="tweetText"]', tweetArticle);
  const outerUserNameEl = findFirstWithinArticle(tweetArticle, '[data-testid="User-Name"]', tweetArticle);

  const seeds = tweetArticle.querySelectorAll('[data-testid="tweetText"], [data-testid="User-Name"]');
  for (const seed of seeds) {
    if (outerTextEl && seed === outerTextEl) continue;
    if (outerUserNameEl && seed === outerUserNameEl) continue;

    const card = seed.closest ? seed.closest('div[role="link"]') : null;
    if (card && card !== tweetArticle) {
      const url = getTweetPermalink(card);
      if (url && normalizeUrlForCompare(url) !== outerNorm) return card;
    }

    let fallback = null;
    let node = seed;

    for (let depth = 0; depth < 12 && node && node !== tweetArticle; depth++) {
      const url = getTweetPermalink(node);
      if (url && normalizeUrlForCompare(url) !== outerNorm) {
        fallback = node;

        const hasUser = node.querySelector ? !!node.querySelector('[data-testid="User-Name"]') : false;
        const hasText = node.querySelector ? !!node.querySelector('[data-testid="tweetText"]') : false;

        if (hasUser && hasText) return node;
        if (hasUser && node.matches && node.matches('article')) return node;
      }

      node = node.parentElement;
    }

    if (fallback) return fallback;
  }

  const articles = tweetArticle.querySelectorAll('article');

  for (const article of articles) {
    if (article === tweetArticle) continue;

    const url = getTweetPermalink(article);
    if (!url) continue;

    if (normalizeUrlForCompare(url) === outerNorm) continue;
    return article;
  }

  return null;
}

async function extractPostData(tweetElement, { includeQuoted = true } = {}) {
  const containerArticle =
    tweetElement instanceof Element && tweetElement.matches('article') ? tweetElement : null;

  const url = getTweetPermalink(tweetElement);
  if (!url) return null;

  await expandShowMoreIfPresent(tweetElement, containerArticle);

  const timeEl = findFirstWithinArticle(tweetElement, 'time', containerArticle);
  const date = timeEl ? timeEl.getAttribute('datetime') || '' : '';

  const text = extractTweetText(tweetElement, containerArticle);
  const { author, handle } = extractAuthorAndHandle(tweetElement, url);

  const links = extractLinks(tweetElement, containerArticle);
  const media = extractMedia(tweetElement, containerArticle);

  let quoted = null;
  if (includeQuoted && containerArticle) {
    const quotedArticle = findQuotedTweetArticle(containerArticle, url);
    if (quotedArticle) quoted = await extractPostData(quotedArticle, { includeQuoted: false });
  }

  const id = tweetIdFromUrl(url) || '';

  return { id, url, author, handle, text, date, links, media, quoted };
}

function setSaveButtonState(button, { saved, url }) {
  if (url) button.dataset.url = url;

  if (saved) {
    button.classList.add('xps-saved');
    button.setAttribute('aria-label', 'Remove saved post');
    button.title = 'Remove from local saves';
    const label = button.querySelector('.xps-save-label');
    if (label) label.textContent = 'Saved';
  } else {
    button.classList.remove('xps-saved');
    button.setAttribute('aria-label', 'Save post locally');
    button.title = 'Save post locally';
    const label = button.querySelector('.xps-save-label');
    if (label) label.textContent = 'Save';
  }
}

function updateButtonsForUrl(url) {
  const key = getPostKeyFromUrl(url);
  if (!key) return;

  for (const btn of document.querySelectorAll('button.xps-save-btn')) {
    const htmlBtn = /** @type {HTMLButtonElement} */ (btn);
    const btnKey = getPostKeyFromUrl(htmlBtn.dataset.url || '');
    if (btnKey && btnKey === key) {
      setSaveButtonState(htmlBtn, { saved: isSaved(url), url: htmlBtn.dataset.url || url });
    }
  }
}

function updateAllButtons() {
  for (const btn of document.querySelectorAll('button.xps-save-btn')) {
    const htmlBtn = /** @type {HTMLButtonElement} */ (btn);
    const url = htmlBtn.dataset.url;
    if (!url) continue;
    setSaveButtonState(htmlBtn, { saved: isSaved(url), url });
  }
}

async function onSaveButtonClick(event) {
  event.preventDefault();
  event.stopPropagation();

  const button = event.currentTarget;
  let tweetElement = button.closest('article') || button.closest('div[data-testid="cellInnerDiv"]');

  if (!tweetElement) {
    toast('Could not locate the post container yet.', { type: 'error' });
    return;
  }

  // A save button inside an article read view is nested in the tweet
  // <article>. Extract from the enclosing tweet article instead, so the saved
  // post carries the author and date that live outside the read view.
  if (tweetElement instanceof Element && isArticleReadView(tweetElement)) {
    tweetElement = tweetElement.parentElement?.closest('article') || tweetElement;
  }

  const wasDisabled = button.disabled;
  button.disabled = true;

  try {
    const post = await extractPostData(tweetElement);
    if (!post) {
      toast('Could not extract post data (maybe not loaded yet).', { type: 'error' });
      return;
    }

    if (!post.id) post.id = tweetIdFromUrl(post.url) || '';

    button.dataset.url = post.url;

    const key = getPostKey(post);
    if (key && savedKeySet.has(key)) {
      const ok = removePost(post.url);
      if (ok) toast('Removed.');
    } else {
      const ok = addPost(post);
      if (ok) toast('Saved.');
    }
  } finally {
    button.disabled = wasDisabled;
  }
}

function ensureSaveButton(tweetElement) {
  const url = getTweetPermalink(tweetElement);
  if (!url) return;

  const actionBar = findActionBar(tweetElement);
  if (!actionBar) return;

  /** @type {HTMLButtonElement|null} */
  let button = /** @type {HTMLButtonElement|null} */ (actionBar.querySelector('button.xps-save-btn'));
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'xps-save-btn';
    button.addEventListener('click', onSaveButtonClick);

    const label = document.createElement('span');
    label.className = 'xps-save-label';
    label.textContent = 'Save';

    button.appendChild(label);
    actionBar.appendChild(button);
  }

  setSaveButtonState(button, { saved: isSaved(url), url });
  removeStaleSaveButtons(tweetElement, actionBar);
}

function ensureSaveButtonsForTweet(tweetElement) {
  ensureSaveButton(tweetElement);

  // Long-form articles render a nested read-view <article> whose action bar
  // sits at the top of the article body. Add a second save button there so
  // the user does not need to scroll to the bottom of long articles.
  for (const nested of tweetElement.querySelectorAll(ARTICLE_READ_VIEW_SELECTOR)) {
    ensureSaveButton(nested);
  }
}

function scanForTweets(root) {
  if (!root) return;

  if (root instanceof Element && root.matches('article')) {
    if (!root.parentElement?.closest('article')) ensureSaveButtonsForTweet(root);
    else if (isArticleReadView(root)) ensureSaveButton(root);
    return;
  }

  const selector = 'article';
  const articles = root.querySelectorAll ? root.querySelectorAll(selector) : [];
  for (const article of articles) {
    if (article.parentElement?.closest('article')) {
      if (isArticleReadView(article)) ensureSaveButton(article);
      continue;
    }
    ensureSaveButtonsForTweet(article);
  }
}

let scanTimer = 0;
let scanRoots = new Set();
function scheduleScan(root) {
  if (root) scanRoots.add(root);
  if (scanTimer) return;

  scanTimer = window.setTimeout(() => {
    scanTimer = 0;
    const roots = Array.from(scanRoots);
    scanRoots = new Set();

    if (roots.length === 0) {
      scanForTweets(document);
      return;
    }

    for (const entry of roots) {
      scanForTweets(entry);
    }
  }, 120);
}

function init() {
  ensureStyles();
  ensurePanel();

  scheduleScan(document);
  maybeWarnStorageLimit();

  window.addEventListener('storage', (event) => {
    if (!event) return;
    if (event.key !== STORAGE_SYNC_KEY) return;
    updateSavedPostsFromStorage();
  });

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const targetArticle = getMutationArticle(mutation.target);
      if (targetArticle) scheduleScan(targetArticle);

      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;

        const owningArticle = getMutationArticle(node);
        if (owningArticle) {
          scheduleScan(owningArticle);
          return;
        }

        const article = node.querySelector ? node.querySelector('article') : null;
        if (article) scheduleScan(node);
      });
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

init();
