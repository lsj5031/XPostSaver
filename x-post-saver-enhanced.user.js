// ==UserScript==
// @name         X Post Saver (Enhanced)
// @namespace    http://tampermonkey.net/
// @version      0.3.5
// @description  Adds a "Save" button to posts on X.com. Saved posts are stored locally and can be exported as JSONL (NDJSON).
// @match        https://x.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-end
// ==/UserScript==

"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

  // src/utils.js
  function nowIso() {
    return (/* @__PURE__ */ new Date()).toISOString();
  }
  __name(nowIso, "nowIso");
  function tweetIdFromUrl(url) {
    if (typeof url !== "string") return null;
    const match = url.match(/\/status\/(\d+)/i);
    return match ? match[1] : null;
  }
  __name(tweetIdFromUrl, "tweetIdFromUrl");
  function sanitizeLinks(links) {
    if (!Array.isArray(links)) return [];
    return links.filter((l) => typeof l === "string").map((l) => (
      /** @type {string} */
      l.trim()
    )).filter(Boolean);
  }
  __name(sanitizeLinks, "sanitizeLinks");
  function sanitizeMedia(media) {
    if (!Array.isArray(media)) return [];
    return media.filter((m) => m && typeof m === "object").map((m) => ({
      type: typeof /** @type {any} */
      m.type === "string" ? (
        /** @type {any} */
        m.type
      ) : "",
      url: typeof /** @type {any} */
      m.url === "string" ? (
        /** @type {any} */
        m.url.trim()
      ) : ""
    })).filter((m) => m.url);
  }
  __name(sanitizeMedia, "sanitizeMedia");
  function sanitizeQuotedPost(post) {
    if (!post || typeof post !== "object") return null;
    const url = typeof post.url === "string" ? post.url.trim() : "";
    if (!url) return null;
    return {
      url,
      author: typeof post.author === "string" ? post.author : "",
      handle: typeof post.handle === "string" ? post.handle : "",
      text: typeof post.text === "string" ? post.text : "",
      date: typeof post.date === "string" ? post.date : "",
      links: sanitizeLinks(post.links),
      media: sanitizeMedia(post.media)
    };
  }
  __name(sanitizeQuotedPost, "sanitizeQuotedPost");
  function sanitizePost(post, { defaultSavedAt = "" } = {}) {
    if (!post || typeof post !== "object") return null;
    const url = typeof post.url === "string" ? post.url.trim() : "";
    if (!url) return null;
    const providedId = typeof post.id === "string" ? post.id.trim() : "";
    const resolvedId = providedId || tweetIdFromUrl(url) || "";
    const savedAt = typeof post.saved_at === "string" ? post.saved_at : defaultSavedAt;
    return {
      id: resolvedId,
      url,
      author: typeof post.author === "string" ? post.author : "",
      handle: typeof post.handle === "string" ? post.handle : "",
      text: typeof post.text === "string" ? post.text : "",
      date: typeof post.date === "string" ? post.date : "",
      saved_at: savedAt,
      links: sanitizeLinks(post.links),
      media: sanitizeMedia(post.media),
      quoted: sanitizeQuotedPost(post.quoted)
    };
  }
  __name(sanitizePost, "sanitizePost");
  function canonicalizeStatusUrl(raw) {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    let u;
    try {
      u = new URL(trimmed, "https://x.com");
    } catch {
      return null;
    }
    const path = u.pathname || "";
    const matchUser = path.match(/^\/([^/]+)\/status\/(\d+)/i);
    if (matchUser) return `https://x.com/${matchUser[1]}/status/${matchUser[2]}`;
    const matchWeb = path.match(/^\/i\/web\/status\/(\d+)/i);
    if (matchWeb) return `https://x.com/i/web/status/${matchWeb[1]}`;
    const matchStatus = path.match(/^\/status\/(\d+)/i);
    if (matchStatus) return `https://x.com/status/${matchStatus[1]}`;
    return null;
  }
  __name(canonicalizeStatusUrl, "canonicalizeStatusUrl");
  function normalizeUrlForCompare(url) {
    if (typeof url !== "string") return "";
    const canonical = canonicalizeStatusUrl(url);
    const normalized = canonical || url;
    try {
      const u = new URL(normalized, "https://x.com");
      u.hash = "";
      u.search = "";
      return u.toString();
    } catch {
      return normalized;
    }
  }
  __name(normalizeUrlForCompare, "normalizeUrlForCompare");
  function getPostKeyFromUrl(url) {
    if (typeof url !== "string") return "";
    const id = tweetIdFromUrl(url);
    if (id) return id;
    const normalized = normalizeUrlForCompare(url);
    if (normalized) return normalized;
    return url.trim();
  }
  __name(getPostKeyFromUrl, "getPostKeyFromUrl");
  function getPostKey(post) {
    if (!post || typeof post !== "object") return "";
    if (typeof post.id === "string" && post.id.trim()) return post.id.trim();
    return getPostKeyFromUrl(post.url);
  }
  __name(getPostKey, "getPostKey");
  function normalizeSavedPosts(input) {
    if (!Array.isArray(input)) return [];
    const seen = /* @__PURE__ */ new Set();
    const normalized = [];
    for (const item of input) {
      const sanitized = sanitizePost(item);
      if (!sanitized) continue;
      const key = getPostKey(sanitized);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      normalized.push(sanitized);
    }
    return normalized;
  }
  __name(normalizeSavedPosts, "normalizeSavedPosts");
  function isLikelyImageMediaUrl(url) {
    if (typeof url !== "string") return false;
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      if (!host.endsWith("twimg.com")) return false;
      const path = u.pathname.toLowerCase();
      return path.includes("/media/") || path.includes("/ext_tw_video_thumb/") || path.includes("/tweet_video_thumb/") || path.includes("/amplify_video_thumb/");
    } catch {
      return false;
    }
  }
  __name(isLikelyImageMediaUrl, "isLikelyImageMediaUrl");
  function withOriginalImageSize(url) {
    if (typeof url !== "string") return url;
    try {
      const u = new URL(url);
      if (u.searchParams.has("name")) u.searchParams.set("name", "orig");
      return u.toString();
    } catch {
      return url;
    }
  }
  __name(withOriginalImageSize, "withOriginalImageSize");
  function normalizeUiLabel(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }
  __name(normalizeUiLabel, "normalizeUiLabel");

  // src/main.js
  var STORAGE_KEY = "xSavedPosts";
  var STORAGE_SYNC_KEY = "xpsSync";
  var STORAGE_SOFT_LIMIT = 2e3;
  var STORAGE_WARN_THRESHOLD = 1800;
  var ARTICLE_PROCESSED_ATTR = "data-xps-processed";
  var UI = {
    styleId: "xps-style",
    panelId: "xps-panel",
    toastId: "xps-toast"
  };
  function safeLocalStorageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  __name(safeLocalStorageGet, "safeLocalStorageGet");
  function safeLocalStorageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
  __name(safeLocalStorageSet, "safeLocalStorageSet");
  function safeLocalStorageRemove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
    }
  }
  __name(safeLocalStorageRemove, "safeLocalStorageRemove");
  function storageGet(key) {
    const gm = (
      /** @type {GlobalWithGM} */
      globalThis
    );
    if (typeof gm.GM_getValue === "function") {
      try {
        return gm.GM_getValue(key, null);
      } catch {
      }
    }
    return safeLocalStorageGet(key);
  }
  __name(storageGet, "storageGet");
  function storageSet(key, value) {
    const gm = (
      /** @type {GlobalWithGM} */
      globalThis
    );
    if (typeof gm.GM_setValue === "function") {
      try {
        gm.GM_setValue(key, value);
        return true;
      } catch {
        return false;
      }
    }
    return safeLocalStorageSet(key, value);
  }
  __name(storageSet, "storageSet");
  function migrateLegacyStorage() {
    const gm = (
      /** @type {GlobalWithGM} */
      globalThis
    );
    if (typeof gm.GM_getValue !== "function" || typeof gm.GM_setValue !== "function") return;
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
  __name(migrateLegacyStorage, "migrateLegacyStorage");
  function broadcastStorageUpdate() {
    safeLocalStorageSet(STORAGE_SYNC_KEY, String(Date.now()));
  }
  __name(broadcastStorageUpdate, "broadcastStorageUpdate");
  function loadSavedPosts() {
    const raw = storageGet(STORAGE_KEY);
    if (!raw) return [];
    try {
      return normalizeSavedPosts(JSON.parse(
        /** @type {string} */
        raw
      ));
    } catch {
      return [];
    }
  }
  __name(loadSavedPosts, "loadSavedPosts");
  function persistSavedPosts(posts) {
    const ok = storageSet(STORAGE_KEY, JSON.stringify(posts));
    if (!ok) {
      toast("Could not save (storage quota or blocked).", { type: "error" });
      return false;
    }
    broadcastStorageUpdate();
    return true;
  }
  __name(persistSavedPosts, "persistSavedPosts");
  migrateLegacyStorage();
  var savedPosts = loadSavedPosts();
  var savedKeySet = new Set(savedPosts.map((p) => getPostKey(p)).filter(Boolean));
  var storageWarned = false;
  function rebuildIndex() {
    savedKeySet = new Set(savedPosts.map((p) => getPostKey(p)).filter(Boolean));
  }
  __name(rebuildIndex, "rebuildIndex");
  function isSaved(url) {
    const key = getPostKeyFromUrl(url);
    if (!key) return false;
    return savedKeySet.has(key);
  }
  __name(isSaved, "isSaved");
  function maybeWarnStorageLimit() {
    if (savedPosts.length >= STORAGE_WARN_THRESHOLD) {
      if (!storageWarned) {
        toast("You are approaching the saved-posts limit. Consider exporting or clearing older items.", {
          type: "error"
        });
        storageWarned = true;
      }
      return;
    }
    storageWarned = false;
  }
  __name(maybeWarnStorageLimit, "maybeWarnStorageLimit");
  function addPost(post) {
    if (!post || typeof post !== "object" || !post.url) return false;
    if (isSaved(post.url)) return false;
    if (savedPosts.length >= STORAGE_SOFT_LIMIT) {
      toast("Storage limit reached. Export or clear before saving more.", { type: "error" });
      return false;
    }
    const newPost = sanitizePost(post, { defaultSavedAt: nowIso() });
    if (!newPost) return false;
    savedPosts.unshift(newPost);
    const key = getPostKey(newPost);
    if (key) savedKeySet.add(key);
    if (!persistSavedPosts(savedPosts)) {
      savedPosts = savedPosts.filter((p) => p.url !== newPost.url);
      rebuildIndex();
      return false;
    }
    updatePanelCount();
    updateButtonsForUrl(newPost.url);
    maybeWarnStorageLimit();
    scheduleScan(document);
    return true;
  }
  __name(addPost, "addPost");
  function removePost(url) {
    if (!url || !isSaved(url)) return false;
    const key = getPostKeyFromUrl(url);
    if (!key) return false;
    savedPosts = savedPosts.filter((p) => getPostKey(p) !== key);
    rebuildIndex();
    if (!persistSavedPosts(savedPosts)) return false;
    updatePanelCount();
    updateButtonsForUrl(url);
    maybeWarnStorageLimit();
    scheduleScan(document);
    return true;
  }
  __name(removePost, "removePost");
  function buildJsonl() {
    return savedPosts.map((p) => JSON.stringify(p)).join("\n") + (savedPosts.length ? "\n" : "");
  }
  __name(buildJsonl, "buildJsonl");
  function downloadJsonl() {
    if (savedPosts.length === 0) {
      toast("No saved posts to export.");
      return;
    }
    const filename = `x-saved-posts-${nowIso().slice(0, 10)}.jsonl`;
    const blob = new Blob([buildJsonl()], { type: "application/x-ndjson;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1e3);
  }
  __name(downloadJsonl, "downloadJsonl");
  async function copyJsonlToClipboard() {
    if (savedPosts.length === 0) {
      toast("No saved posts to copy.");
      return;
    }
    const text = buildJsonl();
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(text);
        toast("Copied JSONL to clipboard.");
        return;
      }
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.top = "-1000px";
      textarea.style.left = "-1000px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      textarea.remove();
      if (!ok) throw new Error("Copy failed");
      toast("Copied JSONL to clipboard.");
    } catch {
      toast("Copy failed (permission blocked?).", { type: "error" });
    }
  }
  __name(copyJsonlToClipboard, "copyJsonlToClipboard");
  function clearAllPosts() {
    if (savedPosts.length === 0) {
      toast("Nothing to clear.");
      return;
    }
    if (!confirm(`Clear ${savedPosts.length} saved posts?`)) return;
    savedPosts = [];
    rebuildIndex();
    persistSavedPosts(savedPosts);
    updatePanelCount();
    updateAllButtons();
    toast("Cleared saved posts.");
  }
  __name(clearAllPosts, "clearAllPosts");
  var toastTimer = 0;
  function toast(message, { timeoutMs = 2200, type = "info" } = {}) {
    let el = document.getElementById(UI.toastId);
    if (!el) {
      el = document.createElement("div");
      el.id = UI.toastId;
      document.body.appendChild(el);
    }
    el.textContent = String(message || "");
    el.dataset.type = type;
    el.dataset.show = "1";
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      const current = document.getElementById(UI.toastId);
      if (current) current.dataset.show = "0";
    }, timeoutMs);
  }
  __name(toast, "toast");
  var panelCountEl = null;
  function updatePanelCount() {
    if (!panelCountEl) return;
    panelCountEl.textContent = `(${savedPosts.length})`;
  }
  __name(updatePanelCount, "updatePanelCount");
  function updateSavedPostsFromStorage() {
    savedPosts = loadSavedPosts();
    rebuildIndex();
    updatePanelCount();
    updateAllButtons();
    maybeWarnStorageLimit();
    scheduleScan(document);
  }
  __name(updateSavedPostsFromStorage, "updateSavedPostsFromStorage");
  function ensureStyles() {
    if (document.getElementById(UI.styleId)) return;
    const style = document.createElement("style");
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
  __name(ensureStyles, "ensureStyles");
  function ensurePanel() {
    if (document.getElementById(UI.panelId)) return;
    const panel = document.createElement("div");
    panel.id = UI.panelId;
    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.addEventListener("click", downloadJsonl);
    const exportText = document.createElement("span");
    exportText.textContent = "Export ";
    panelCountEl = document.createElement("span");
    panelCountEl.textContent = "(0)";
    exportBtn.appendChild(exportText);
    exportBtn.appendChild(panelCountEl);
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", () => {
      void copyJsonlToClipboard();
    });
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.textContent = "Clear";
    clearBtn.addEventListener("click", clearAllPosts);
    panel.appendChild(exportBtn);
    panel.appendChild(copyBtn);
    panel.appendChild(clearBtn);
    (document.documentElement || document.body).appendChild(panel);
    updatePanelCount();
  }
  __name(ensurePanel, "ensurePanel");
  function getTweetPermalink(tweetElement) {
    const containerArticle = tweetElement instanceof Element && tweetElement.matches("article") ? tweetElement : null;
    const timeEls = tweetElement.querySelectorAll ? tweetElement.querySelectorAll("time") : [];
    for (const timeEl of timeEls) {
      if (containerArticle) {
        const closestArticle = timeEl.closest("article");
        if (closestArticle && closestArticle !== containerArticle) continue;
      }
      const link = timeEl.closest('a[href*="/status/"]');
      const href = link ? link.getAttribute("href") : null;
      if (!href) continue;
      try {
        const abs = new URL(href, "https://x.com").toString();
        return canonicalizeStatusUrl(abs) || abs;
      } catch {
      }
    }
    const statusLinks = tweetElement.querySelectorAll ? tweetElement.querySelectorAll('a[href*="/status/"]') : [];
    const candidates = [];
    const quoteContainerSelector = '[data-testid="testCondensedMedia"], [data-testid="embeddedTweet"], div[aria-label="Embedded Tweet"], div[aria-label="Embedded Post"], div[aria-label="Embedded post"]';
    for (const link of statusLinks) {
      if (containerArticle) {
        const closestArticle = link.closest("article");
        if (closestArticle && closestArticle !== containerArticle) continue;
      }
      const href = link.getAttribute ? link.getAttribute("href") : null;
      if (!href) continue;
      try {
        const abs = new URL(href, "https://x.com").toString();
        candidates.push({ url: canonicalizeStatusUrl(abs) || abs, link });
      } catch {
      }
    }
    if (candidates.length === 0) return null;
    if (containerArticle) {
      const preferred = candidates.find((c) => !c.link.closest(quoteContainerSelector));
      if (preferred) return preferred.url;
    }
    return candidates[0].url;
  }
  __name(getTweetPermalink, "getTweetPermalink");
  function markArticleProcessed(article) {
    if (!(article instanceof Element)) return;
    if (!article.matches("article")) return;
    article.setAttribute(ARTICLE_PROCESSED_ATTR, "1");
  }
  __name(markArticleProcessed, "markArticleProcessed");
  function findFirstWithinArticle(root, selector, containerArticle) {
    const els = root.querySelectorAll ? root.querySelectorAll(selector) : [];
    for (const el of els) {
      if (containerArticle) {
        const closestArticle = el.closest("article");
        if (closestArticle && closestArticle !== containerArticle) continue;
      }
      return el;
    }
    return null;
  }
  __name(findFirstWithinArticle, "findFirstWithinArticle");
  function extractAuthorAndHandle(tweetElement, url) {
    const containerArticle = tweetElement instanceof Element && tweetElement.matches("article") ? tweetElement : null;
    const userNameEl = findFirstWithinArticle(tweetElement, '[data-testid="User-Name"]', containerArticle);
    let author = "";
    let handle = "";
    if (userNameEl) {
      const lines = String(userNameEl.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean).filter((s) => s !== "\xB7").filter((s) => !/^follows you$/i.test(s)).filter((s) => !/^promoted$/i.test(s));
      handle = lines.find((s) => s.startsWith("@")) || "";
      author = lines.find((s) => !s.startsWith("@")) || "";
    }
    if (!handle && url) {
      const match = url.match(/x\.com\/([^/]+)\/status\//i);
      if (match && match[1]) handle = `@${match[1]}`;
    }
    return { author, handle };
  }
  __name(extractAuthorAndHandle, "extractAuthorAndHandle");
  function findTweetTextElement(tweetElement, containerArticle) {
    return findFirstWithinArticle(tweetElement, '[data-testid="tweetText"]', containerArticle);
  }
  __name(findTweetTextElement, "findTweetTextElement");
  function findShowMoreControl(root) {
    if (!root || !root.querySelectorAll) return null;
    const candidates = root.querySelectorAll(
      'button, div[role="button"], span[role="button"], a[role="link"], a[href]'
    );
    for (const el of candidates) {
      const label = normalizeUiLabel(el.innerText || el.textContent || "");
      if (/^show more$/i.test(label)) return el;
    }
    return null;
  }
  __name(findShowMoreControl, "findShowMoreControl");
  function isWithinSameArticle(el, containerArticle) {
    if (!containerArticle) return true;
    if (!(el instanceof Element)) return false;
    const closestArticle = el.closest("article");
    return !closestArticle || closestArticle === containerArticle;
  }
  __name(isWithinSameArticle, "isWithinSameArticle");
  function resolveShowMoreClickable(control) {
    if (!(control instanceof Element)) return null;
    const button = control.closest("button");
    if (button) return button;
    const roleButton = control.closest('[role="button"]');
    if (roleButton) return roleButton;
    return control;
  }
  __name(resolveShowMoreClickable, "resolveShowMoreClickable");
  function findShowMoreNearTweetText(tweetElement, containerArticle, textEl) {
    let node = textEl;
    for (let depth = 0; depth < 6 && node; depth++) {
      const found2 = findShowMoreControl(node);
      if (found2 && isWithinSameArticle(found2, containerArticle)) return found2;
      if (containerArticle && node === containerArticle) break;
      node = node.parentElement;
    }
    const root = containerArticle || tweetElement;
    const found = findShowMoreControl(root);
    if (found && isWithinSameArticle(found, containerArticle)) return found;
    return null;
  }
  __name(findShowMoreNearTweetText, "findShowMoreNearTweetText");
  function safeClickControl(el) {
    if (!(el instanceof Element)) return false;
    const htmlEl = (
      /** @type {HTMLElement} */
      el
    );
    try {
      htmlEl.scrollIntoView?.({ block: "center", inline: "nearest" });
    } catch {
    }
    try {
      if (el.tagName === "A") {
        el.addEventListener(
          "click",
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
  __name(safeClickControl, "safeClickControl");
  async function expandShowMoreIfPresent(tweetElement, containerArticle) {
    const originalTextEl = findTweetTextElement(tweetElement, containerArticle);
    if (!originalTextEl) return false;
    let expanded = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const textEl = findTweetTextElement(tweetElement, containerArticle) || originalTextEl;
      const before = normalizeUiLabel(textEl.innerText || "");
      const showMoreControl = findShowMoreNearTweetText(tweetElement, containerArticle, textEl);
      if (!showMoreControl) break;
      const clickable = resolveShowMoreClickable(showMoreControl);
      if (!clickable || !isWithinSameArticle(clickable, containerArticle)) break;
      const clicked = safeClickControl(clickable);
      if (!clicked) break;
      const start = Date.now();
      let changed = false;
      while (Date.now() - start < 2e3) {
        await new Promise((resolve) => window.setTimeout(resolve, 50));
        const currentTextEl = findTweetTextElement(tweetElement, containerArticle) || textEl;
        const after = normalizeUiLabel(currentTextEl.innerText || "");
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
  __name(expandShowMoreIfPresent, "expandShowMoreIfPresent");
  function extractTweetText(tweetElement, containerArticle) {
    const textEl = findTweetTextElement(tweetElement, containerArticle);
    if (!textEl) return "";
    const showMoreControl = findShowMoreControl(textEl);
    const showMoreLabel = showMoreControl ? String(showMoreControl.innerText || showMoreControl.textContent || "").trim() : "";
    const visible = String(textEl.innerText || "").trim();
    if (showMoreLabel && visible && visible.toLowerCase().endsWith(showMoreLabel.toLowerCase())) {
      const withoutLabel = visible.slice(0, Math.max(0, visible.length - showMoreLabel.length)).trim();
      const raw = String(textEl.textContent || "").trim();
      if (raw && raw.length > withoutLabel.length) {
        const rawWithoutLabel = raw.replace(showMoreLabel, "").trim();
        if (rawWithoutLabel.length > withoutLabel.length) return rawWithoutLabel;
      }
      return withoutLabel;
    }
    return visible;
  }
  __name(extractTweetText, "extractTweetText");
  function extractLinks(tweetElement, containerArticle) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    function add(raw) {
      if (!raw || typeof raw !== "string") return;
      let abs = "";
      try {
        abs = new URL(raw, window.location.href).toString();
      } catch {
        return;
      }
      if (!abs) return;
      try {
        const u = new URL(abs);
        const host = u.hostname.replace(/^www\./, "").toLowerCase();
        if (host === "x.com" || host === "twitter.com" || host === "mobile.twitter.com") return;
      } catch {
      }
      if (seen.has(abs)) return;
      seen.add(abs);
      out.push(abs);
    }
    __name(add, "add");
    const textEl = findTweetTextElement(tweetElement, containerArticle);
    const anchorsInText = textEl && textEl.querySelectorAll ? textEl.querySelectorAll("a[href]") : [];
    for (const a of anchorsInText) {
      const expanded = a.getAttribute("data-expanded-url");
      const title = a.getAttribute("title");
      const href = a.getAttribute("href");
      if (expanded && /^https?:\/\//i.test(expanded)) add(expanded);
      else if (title && /^https?:\/\//i.test(title)) add(title);
      else add(href);
    }
    const tcoAnchors = tweetElement.querySelectorAll ? tweetElement.querySelectorAll('a[href*="t.co/"]') : [];
    for (const a of tcoAnchors) {
      if (containerArticle) {
        const closestArticle = a.closest("article");
        if (closestArticle && closestArticle !== containerArticle) continue;
      }
      add(a.getAttribute("href"));
    }
    return out;
  }
  __name(extractLinks, "extractLinks");
  function extractMedia(tweetElement, containerArticle) {
    const media = [];
    const seen = /* @__PURE__ */ new Set();
    function add(type, raw) {
      if (!raw || typeof raw !== "string") return;
      let abs = "";
      try {
        abs = new URL(raw, window.location.href).toString();
      } catch {
        return;
      }
      if (!abs) return;
      let finalUrl = abs;
      if (type === "photo") {
        if (!isLikelyImageMediaUrl(abs)) return;
        finalUrl = withOriginalImageSize(abs);
      } else if (type === "video_poster" || type === "thumb") {
        if (!isLikelyImageMediaUrl(abs)) return;
      } else if (type === "video") {
        if (!/^https?:\/\//i.test(abs)) return;
        if (abs.startsWith("blob:")) return;
      }
      const key = `${type}|${finalUrl}`;
      if (seen.has(key)) return;
      seen.add(key);
      media.push({ type, url: finalUrl });
    }
    __name(add, "add");
    const imgs = tweetElement.querySelectorAll ? tweetElement.querySelectorAll("img[src]") : [];
    for (const img of imgs) {
      if (containerArticle) {
        const closestArticle = img.closest("article");
        if (closestArticle && closestArticle !== containerArticle) continue;
      }
      const src = img.getAttribute("src");
      if (!src) continue;
      let abs = "";
      try {
        abs = new URL(src, window.location.href).toString();
      } catch {
        continue;
      }
      if (!isLikelyImageMediaUrl(abs)) continue;
      let type = "thumb";
      try {
        const path = new URL(abs).pathname.toLowerCase();
        type = path.includes("/media/") ? "photo" : "thumb";
      } catch {
      }
      add(type, abs);
    }
    const videos = tweetElement.querySelectorAll ? tweetElement.querySelectorAll("video") : [];
    for (const video of videos) {
      if (containerArticle) {
        const closestArticle = video.closest("article");
        if (closestArticle && closestArticle !== containerArticle) continue;
      }
      const poster = video.getAttribute("poster");
      if (poster) add("video_poster", poster);
      const src = video.currentSrc || video.getAttribute("src") || "";
      if (src) add("video", src);
      const sources = video.querySelectorAll ? video.querySelectorAll("source[src]") : [];
      for (const source of sources) {
        const s = source.getAttribute("src");
        if (s) add("video", s);
      }
    }
    return media;
  }
  __name(extractMedia, "extractMedia");
  function findQuotedTweetArticle(tweetArticle, outerUrl) {
    if (!tweetArticle || !tweetArticle.querySelectorAll) return null;
    const outerNorm = normalizeUrlForCompare(outerUrl);
    const embedded = tweetArticle.querySelector(
      '[data-testid="embeddedTweet"], div[aria-label="Embedded Tweet"], div[aria-label="Embedded Post"], div[aria-label="Embedded post"]'
    );
    if (embedded) {
      let root = embedded;
      if (embedded.matches && embedded.matches("article")) {
        root = embedded;
      } else if (embedded.querySelector) {
        root = embedded.querySelector("article") || embedded;
      }
      const url = getTweetPermalink(root);
      if (url && normalizeUrlForCompare(url) !== outerNorm) return root;
    }
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
          if (hasUser && node.matches && node.matches("article")) return node;
        }
        node = node.parentElement;
      }
      if (fallback) return fallback;
    }
    const articles = tweetArticle.querySelectorAll("article");
    for (const article of articles) {
      if (article === tweetArticle) continue;
      const url = getTweetPermalink(article);
      if (!url) continue;
      if (normalizeUrlForCompare(url) === outerNorm) continue;
      return article;
    }
    return null;
  }
  __name(findQuotedTweetArticle, "findQuotedTweetArticle");
  async function extractPostData(tweetElement, { includeQuoted = true } = {}) {
    const containerArticle = tweetElement instanceof Element && tweetElement.matches("article") ? tweetElement : null;
    const url = getTweetPermalink(tweetElement);
    if (!url) return null;
    await expandShowMoreIfPresent(tweetElement, containerArticle);
    const timeEl = findFirstWithinArticle(tweetElement, "time", containerArticle);
    const date = timeEl ? timeEl.getAttribute("datetime") || "" : "";
    const text = extractTweetText(tweetElement, containerArticle);
    const { author, handle } = extractAuthorAndHandle(tweetElement, url);
    const links = extractLinks(tweetElement, containerArticle);
    const media = extractMedia(tweetElement, containerArticle);
    let quoted = null;
    if (includeQuoted && containerArticle) {
      const quotedArticle = findQuotedTweetArticle(containerArticle, url);
      if (quotedArticle) quoted = await extractPostData(quotedArticle, { includeQuoted: false });
    }
    const id = tweetIdFromUrl(url) || "";
    return { id, url, author, handle, text, date, links, media, quoted };
  }
  __name(extractPostData, "extractPostData");
  function setSaveButtonState(button, { saved, url }) {
    if (url) button.dataset.url = url;
    if (saved) {
      button.classList.add("xps-saved");
      button.setAttribute("aria-label", "Remove saved post");
      button.title = "Remove from local saves";
      const label = button.querySelector(".xps-save-label");
      if (label) label.textContent = "Saved";
    } else {
      button.classList.remove("xps-saved");
      button.setAttribute("aria-label", "Save post locally");
      button.title = "Save post locally";
      const label = button.querySelector(".xps-save-label");
      if (label) label.textContent = "Save";
    }
  }
  __name(setSaveButtonState, "setSaveButtonState");
  function updateButtonsForUrl(url) {
    const key = getPostKeyFromUrl(url);
    if (!key) return;
    for (const btn of document.querySelectorAll("button.xps-save-btn")) {
      const htmlBtn = (
        /** @type {HTMLButtonElement} */
        btn
      );
      const btnKey = getPostKeyFromUrl(htmlBtn.dataset.url || "");
      if (btnKey && btnKey === key) {
        setSaveButtonState(htmlBtn, { saved: isSaved(url), url: htmlBtn.dataset.url || url });
      }
    }
  }
  __name(updateButtonsForUrl, "updateButtonsForUrl");
  function updateAllButtons() {
    for (const btn of document.querySelectorAll("button.xps-save-btn")) {
      const htmlBtn = (
        /** @type {HTMLButtonElement} */
        btn
      );
      const url = htmlBtn.dataset.url;
      if (!url) continue;
      setSaveButtonState(htmlBtn, { saved: isSaved(url), url });
    }
  }
  __name(updateAllButtons, "updateAllButtons");
  async function onSaveButtonClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const button = event.currentTarget;
    const tweetElement = button.closest("article") || button.closest('div[data-testid="cellInnerDiv"]');
    if (!tweetElement) {
      toast("Could not locate the post container yet.", { type: "error" });
      return;
    }
    const wasDisabled = button.disabled;
    button.disabled = true;
    try {
      const post = await extractPostData(tweetElement);
      if (!post) {
        toast("Could not extract post data (maybe not loaded yet).", { type: "error" });
        return;
      }
      if (!post.id) post.id = tweetIdFromUrl(post.url) || "";
      button.dataset.url = post.url;
      const key = getPostKey(post);
      if (key && savedKeySet.has(key)) {
        const ok = removePost(post.url);
        if (ok) toast("Removed.");
      } else {
        const ok = addPost(post);
        if (ok) toast("Saved.");
      }
    } finally {
      button.disabled = wasDisabled;
    }
  }
  __name(onSaveButtonClick, "onSaveButtonClick");
  function findActionBar(tweetElement) {
    const reply = tweetElement.querySelector('[data-testid="reply"]');
    const groupFromReply = reply ? reply.closest('div[role="group"]') : null;
    if (groupFromReply) return groupFromReply;
    const groups = tweetElement.querySelectorAll('div[role="group"]');
    for (const group of groups) {
      const hasReply = group.querySelector('[data-testid="reply"]');
      const hasRetweet = group.querySelector('[data-testid="retweet"]');
      const hasLike = group.querySelector('[data-testid="like"], [data-testid="unlike"]');
      if (hasReply || hasRetweet || hasLike) return group;
    }
    return null;
  }
  __name(findActionBar, "findActionBar");
  function ensureSaveButton(tweetElement) {
    const url = getTweetPermalink(tweetElement);
    if (!url) {
      if (tweetElement instanceof Element && tweetElement.matches("article")) {
        markArticleProcessed(tweetElement);
      }
      return;
    }
    const actionBar = findActionBar(tweetElement);
    if (!actionBar) {
      if (tweetElement instanceof Element && tweetElement.matches("article")) {
        markArticleProcessed(tweetElement);
      }
      return;
    }
    let button = actionBar.querySelector("button.xps-save-btn");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "xps-save-btn";
      button.addEventListener("click", onSaveButtonClick);
      const label = document.createElement("span");
      label.className = "xps-save-label";
      label.textContent = "Save";
      button.appendChild(label);
      actionBar.appendChild(button);
    }
    setSaveButtonState(button, { saved: isSaved(url), url });
    if (tweetElement instanceof Element && tweetElement.matches("article")) {
      markArticleProcessed(tweetElement);
    }
  }
  __name(ensureSaveButton, "ensureSaveButton");
  function scanForTweets(root) {
    if (!root) return;
    if (root instanceof Element && root.matches("article")) {
      ensureSaveButton(root);
      return;
    }
    const selector = `article:not([${ARTICLE_PROCESSED_ATTR}])`;
    const articles = root.querySelectorAll ? root.querySelectorAll(selector) : [];
    for (const article of articles) {
      ensureSaveButton(article);
    }
  }
  __name(scanForTweets, "scanForTweets");
  var scanTimer = 0;
  var scanRoots = /* @__PURE__ */ new Set();
  function scheduleScan(root) {
    if (root) scanRoots.add(root);
    if (scanTimer) return;
    scanTimer = window.setTimeout(() => {
      scanTimer = 0;
      const roots = Array.from(scanRoots);
      scanRoots = /* @__PURE__ */ new Set();
      if (roots.length === 0) {
        scanForTweets(document);
        return;
      }
      for (const entry of roots) {
        scanForTweets(entry);
      }
    }, 120);
  }
  __name(scheduleScan, "scheduleScan");
  function init() {
    ensureStyles();
    ensurePanel();
    scheduleScan(document);
    maybeWarnStorageLimit();
    window.addEventListener("storage", (event) => {
      if (!event) return;
      if (event.key !== STORAGE_SYNC_KEY) return;
      updateSavedPostsFromStorage();
    });
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (!mutation.addedNodes || mutation.addedNodes.length === 0) continue;
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node.matches("article")) {
            scheduleScan(node);
            return;
          }
          const article = node.querySelector ? node.querySelector("article") : null;
          if (article) scheduleScan(node);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  __name(init, "init");
  init();
})();
