// ==UserScript==
// @name         X Post Saver (Enhanced)
// @namespace    http://tampermonkey.net/
// @version      0.2.0
// @description  Adds a "Save" button to posts on X.com. Saved posts are stored locally and can be exported as JSONL (NDJSON).
// @match        https://x.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'xSavedPosts';

  const UI = {
    styleId: 'xps-style',
    panelId: 'xps-panel',
    toastId: 'xps-toast',
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function safeStorageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  function normalizeSavedPosts(input) {
    if (!Array.isArray(input)) return [];

    const seen = new Set();
    const normalized = [];

    for (const item of input) {
      if (!item || typeof item !== 'object') continue;

      const url = typeof item.url === 'string' ? item.url : '';
      if (!url || seen.has(url)) continue;

      seen.add(url);

      normalized.push({
        url,
        author: typeof item.author === 'string' ? item.author : '',
        handle: typeof item.handle === 'string' ? item.handle : '',
        text: typeof item.text === 'string' ? item.text : '',
        date: typeof item.date === 'string' ? item.date : '',
        saved_at: typeof item.saved_at === 'string' ? item.saved_at : '',
      });
    }

    return normalized;
  }

  function loadSavedPosts() {
    const raw = safeStorageGet(STORAGE_KEY);
    if (!raw) return [];

    try {
      return normalizeSavedPosts(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  function persistSavedPosts(posts) {
    const ok = safeStorageSet(STORAGE_KEY, JSON.stringify(posts));
    if (!ok) toast('Could not save (storage quota or blocked).', { type: 'error' });
    return ok;
  }

  let savedPosts = loadSavedPosts();
  let savedUrlSet = new Set(savedPosts.map((p) => p.url));

  function rebuildIndex() {
    savedUrlSet = new Set(savedPosts.map((p) => p.url));
  }

  function isSaved(url) {
    return savedUrlSet.has(url);
  }

  function addPost(post) {
    if (!post || typeof post !== 'object' || !post.url) return false;
    if (isSaved(post.url)) return false;

    const newPost = {
      url: post.url,
      author: post.author || '',
      handle: post.handle || '',
      text: post.text || '',
      date: post.date || '',
      saved_at: post.saved_at || nowIso(),
    };

    savedPosts.unshift(newPost);
    savedUrlSet.add(newPost.url);

    if (!persistSavedPosts(savedPosts)) {
      savedPosts = savedPosts.filter((p) => p.url !== newPost.url);
      rebuildIndex();
      return false;
    }

    updatePanelCount();
    updateButtonsForUrl(newPost.url);
    scheduleScan();
    return true;
  }

  function removePost(url) {
    if (!url || !isSaved(url)) return false;

    savedPosts = savedPosts.filter((p) => p.url !== url);
    rebuildIndex();

    if (!persistSavedPosts(savedPosts)) return false;

    updatePanelCount();
    updateButtonsForUrl(url);
    scheduleScan();
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

    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
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

  function clearAllPosts() {
    if (savedPosts.length === 0) {
      toast('Nothing to clear.');
      return;
    }

    // eslint-disable-next-line no-alert
    if (!confirm(`Clear ${savedPosts.length} saved posts?`)) return;

    savedPosts = [];
    rebuildIndex();
    persistSavedPosts(savedPosts);

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

      #${UI.panelId} button {
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

      #${UI.panelId} button:hover {
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

    panel.appendChild(exportBtn);
    panel.appendChild(copyBtn);
    panel.appendChild(clearBtn);

    document.body.appendChild(panel);
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
        return new URL(href, 'https://x.com').toString();
      } catch {
        // ignore
      }
    }

    return null;
  }

  function extractAuthorAndHandle(tweetElement, url) {
    const userNameEl = tweetElement.querySelector('[data-testid="User-Name"]');
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

  function extractPostData(tweetElement) {
    const url = getTweetPermalink(tweetElement);
    if (!url) return null;

    const timeEl = tweetElement.querySelector('time');
    const date = timeEl ? timeEl.getAttribute('datetime') || '' : '';

    const textEl = tweetElement.querySelector('[data-testid="tweetText"]');
    const text = textEl ? String(textEl.innerText || '').trim() : '';

    const { author, handle } = extractAuthorAndHandle(tweetElement, url);

    return { url, author, handle, text, date };
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
    for (const btn of document.querySelectorAll('button.xps-save-btn')) {
      if (btn.dataset.url === url) setSaveButtonState(btn, { saved: isSaved(url), url });
    }
  }

  function updateAllButtons() {
    for (const btn of document.querySelectorAll('button.xps-save-btn')) {
      const url = btn.dataset.url;
      if (!url) continue;
      setSaveButtonState(btn, { saved: isSaved(url), url });
    }
  }

  function onSaveButtonClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    const tweetElement = button.closest('article') || button.closest('div[data-testid="cellInnerDiv"]');

    if (!tweetElement) {
      toast('Could not locate the post container yet.', { type: 'error' });
      return;
    }

    const post = extractPostData(tweetElement);
    if (!post) {
      toast('Could not extract post data (maybe not loaded yet).', { type: 'error' });
      return;
    }

    button.dataset.url = post.url;

    if (isSaved(post.url)) {
      const ok = removePost(post.url);
      if (ok) toast('Removed.');
    } else {
      const ok = addPost(post);
      if (ok) toast('Saved.');
    }
  }

  function findActionBar(tweetElement) {
    const reply = tweetElement.querySelector('[data-testid="reply"]');
    const groupFromReply = reply ? reply.closest('div[role="group"]') : null;
    return groupFromReply || tweetElement.querySelector('div[role="group"]');
  }

  function ensureSaveButton(tweetElement) {
    const url = getTweetPermalink(tweetElement);
    if (!url) return;

    const actionBar = findActionBar(tweetElement);
    if (!actionBar) return;

    let button = actionBar.querySelector('button.xps-save-btn');
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
  }

  function scanForTweets(root) {
    const scope = root || document;

    if (scope instanceof Element && scope.matches('article')) {
      ensureSaveButton(scope);
    }

    const articles = scope.querySelectorAll ? scope.querySelectorAll('article') : [];
    for (const article of articles) {
      ensureSaveButton(article);
    }
  }

  let scanTimer = 0;
  function scheduleScan() {
    if (scanTimer) return;

    scanTimer = window.setTimeout(() => {
      scanTimer = 0;
      scanForTweets(document);
    }, 200);
  }

  function init() {
    ensureStyles();
    ensurePanel();

    scheduleScan();

    const observer = new MutationObserver(() => {
      scheduleScan();
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  init();
})();
