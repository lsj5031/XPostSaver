// ==UserScript==
// @name         X Post Saver (Enhanced)
// @namespace    http://tampermonkey.net/
// @version      0.4.0
// @description  Adds a "Save" button to posts on X.com (also at the top of long-form articles). Saved posts are stored locally and can be exported as JSONL (NDJSON). UI is set in Ioskeley Mono (OFL, ahatem/IoskeleyMono), embedded as a subset.
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
    let parsed;
    try {
      parsed = new URL(url, "https://x.com");
    } catch {
      return null;
    }
    if (!isSupportedXHost(parsed.hostname)) return null;
    const match = parsed.pathname.match(/\/status\/(\d+)/i);
    return match ? match[1] : null;
  }
  __name(tweetIdFromUrl, "tweetIdFromUrl");
  function isSupportedXHost(host) {
    if (typeof host !== "string") return false;
    const normalized = host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    return normalized === "x.com" || normalized === "twitter.com" || normalized === "mobile.twitter.com";
  }
  __name(isSupportedXHost, "isSupportedXHost");
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
    if (!isSupportedXHost(u.hostname)) return null;
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
      if (u.protocol !== "https:") return false;
      const host = u.hostname.toLowerCase();
      if (host !== "twimg.com" && !host.endsWith(".twimg.com")) return false;
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

  // src/storage.js
  function tryCommitSavedPosts(currentPosts, nextPosts, persist) {
    try {
      if (!persist(nextPosts)) return { committed: false, posts: currentPosts };
    } catch {
      return { committed: false, posts: currentPosts };
    }
    return { committed: true, posts: nextPosts };
  }
  __name(tryCommitSavedPosts, "tryCommitSavedPosts");
  function withSavedPostsLock(task, locks = globalThis.navigator?.locks) {
    if (!locks || typeof locks.request !== "function") {
      return (
        /** @type {Promise<Awaited<T>>} */
        Promise.resolve().then(task)
      );
    }
    return (
      /** @type {Promise<Awaited<T>>} */
      locks.request("xps-saved-posts", task)
    );
  }
  __name(withSavedPostsLock, "withSavedPostsLock");

  // src/panel-position.js
  var PANEL_VIEWPORT_MARGIN = 8;
  function finiteNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  __name(finiteNumber, "finiteNumber");
  function parsePanelPosition(value) {
    if (typeof value !== "string" || !value) return null;
    try {
      const parsed = JSON.parse(value);
      const x = finiteNumber(parsed?.x);
      const y = finiteNumber(parsed?.y);
      return x == null || y == null ? null : { x, y };
    } catch {
      return null;
    }
  }
  __name(parsePanelPosition, "parsePanelPosition");
  function clampPanelPosition(position, panelSize, viewportSize, margin = PANEL_VIEWPORT_MARGIN) {
    const safeMargin = Math.max(0, finiteNumber(margin) ?? 0);
    const maxX = Math.max(safeMargin, viewportSize.width - panelSize.width - safeMargin);
    const maxY = Math.max(safeMargin, viewportSize.height - panelSize.height - safeMargin);
    return {
      x: Math.min(maxX, Math.max(safeMargin, position.x)),
      y: Math.min(maxY, Math.max(safeMargin, position.y))
    };
  }
  __name(clampPanelPosition, "clampPanelPosition");

  // src/dom.js
  var EMBEDDED_TWEET_SELECTORS = [
    '[data-testid="testCondensedMedia"]',
    '[data-testid="embeddedTweet"]',
    'div[aria-label="Embedded Tweet"]',
    'div[aria-label="Embedded Post"]',
    'div[aria-label="Embedded post"]'
  ];
  var GENERIC_CARD_SELECTOR = '[data-testid="card.wrapper"]';
  var ARTICLE_READ_VIEW_SELECTOR = 'article[data-testid="twitterArticleReadView"]';
  function isArticleReadView(element) {
    return typeof Element !== "undefined" && element instanceof Element && element.matches(ARTICLE_READ_VIEW_SELECTOR);
  }
  __name(isArticleReadView, "isArticleReadView");
  function isInsideEmbeddedTweet(element) {
    return EMBEDDED_TWEET_SELECTORS.some((selector) => !!element.closest(selector));
  }
  __name(isInsideEmbeddedTweet, "isInsideEmbeddedTweet");
  function isInsideGenericCard(element) {
    return !!element.closest(GENERIC_CARD_SELECTOR);
  }
  __name(isInsideGenericCard, "isInsideGenericCard");
  function findActionBar(tweetElement) {
    if (!tweetElement || !tweetElement.querySelectorAll) return null;
    const isArticle = typeof Element !== "undefined" && tweetElement instanceof Element && tweetElement.matches("article");
    const groups = Array.from(tweetElement.querySelectorAll('div[role="group"]')).filter((group) => {
      if (isArticle && group.closest("article") !== tweetElement) return false;
      return !isInsideEmbeddedTweet(group);
    });
    if (groups.length === 0) return null;
    const outsideCardGroups = groups.filter((group) => !isInsideGenericCard(group));
    const candidates = outsideCardGroups.length > 0 ? outsideCardGroups : groups;
    let bestGroup = null;
    let bestScore = -1;
    for (const group of candidates) {
      const hasReply = !!group.querySelector('[data-testid="reply"]');
      const hasRetweet = !!group.querySelector('[data-testid="retweet"]');
      const hasLike = !!group.querySelector('[data-testid="like"], [data-testid="unlike"]');
      const controlCount = Number(hasReply) + Number(hasRetweet) + Number(hasLike);
      if (controlCount === 0) continue;
      const score = controlCount + (hasReply ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestGroup = group;
      }
    }
    return bestGroup;
  }
  __name(findActionBar, "findActionBar");
  function getMutationArticle(node) {
    if (typeof Element === "undefined" || !(node instanceof Element)) return null;
    return node.matches("article") ? node : node.closest("article");
  }
  __name(getMutationArticle, "getMutationArticle");
  function removeStaleSaveButtons(tweetElement, actionBar) {
    if (!tweetElement.matches("article")) return;
    for (const button of tweetElement.querySelectorAll("button.xps-save-btn")) {
      if (button.closest("article") !== tweetElement) continue;
      if (!actionBar.contains(button)) button.remove();
    }
  }
  __name(removeStaleSaveButtons, "removeStaleSaveButtons");

  // src/main.css
  var main_default = "/*\n  Ioskeley Mono \u2014 Iosevka configured to mimic Berkeley Mono.\n  SIL Open Font License 1.1, (c) 2025 Ahmed Hatem.\n  https://github.com/ahatem/IoskeleyMono\n\n  Subset to the UI character set by scripts/gen-fonts.js. Hosted at\n  https://ahatem.github.io/IoskeleyMono/fonts/ and\n  https://cdn.jsdelivr.net/gh/ahatem/IoskeleyMono@main/site/fonts/\n  (full faces); x.com's CSP allows data: URIs but not those hosts, so the\n  built userscript embeds them.\n*/\n@font-face {\n  font-family: 'Ioskeley Mono';\n  font-style: normal;\n  font-weight: 400;\n  font-display: swap;\n  src: url('data:font/woff2;base64,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') format('woff2');\n}\n@font-face {\n  font-family: 'Ioskeley Mono';\n  font-style: normal;\n  font-weight: 700;\n  font-display: swap;\n  src: url('data:font/woff2;base64,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') format('woff2');\n}\n\nbutton.xps-save-btn {\n  appearance: none;\n  border: 1px solid rgba(128, 128, 128, 0.35);\n  background: transparent;\n  color: inherit;\n  cursor: pointer;\n  user-select: none;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  /* X action bars use align-items: stretch; with an explicit height the\n     pill would top-align, so center it against the native icon buttons. */\n  align-self: center;\n  height: 30px;\n  padding: 0 10px;\n  margin-left: 8px;\n  border-radius: 999px;\n  font-family: 'Ioskeley Mono', ui-monospace, 'SF Mono', Menlo, monospace;\n  font-size: 12px;\n  font-weight: 700;\n  line-height: 1;\n  letter-spacing: 0;\n}\n\nbutton.xps-save-btn:hover {\n  background: rgba(29, 155, 240, 0.12);\n  border-color: rgba(29, 155, 240, 0.6);\n}\n\nbutton.xps-save-btn.xps-saved {\n  border-color: rgba(0, 186, 124, 0.75);\n  color: rgba(0, 186, 124, 1);\n}\n\nbutton.xps-save-btn.xps-saved:hover {\n  background: rgba(0, 186, 124, 0.12);\n}\n\n.xps-save-label {\n  font-weight: 700;\n}\n";

  // src/main.js
  var STORAGE_KEY = "xSavedPosts";
  var STORAGE_SYNC_KEY = "xpsSync";
  var PANEL_POSITION_KEY = "xpsPanelPosition";
  var STORAGE_SOFT_LIMIT = 2e3;
  var STORAGE_WARN_THRESHOLD = 1800;
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
    safeLocalStorageSet(STORAGE_SYNC_KEY, `${Date.now()}:${Math.random()}`);
  }
  __name(broadcastStorageUpdate, "broadcastStorageUpdate");
  function loadSavedPosts() {
    const raw = storageGet(STORAGE_KEY);
    if (!raw) return [];
    if (Array.isArray(raw)) return normalizeSavedPosts(raw);
    if (typeof raw !== "string") return [];
    try {
      return normalizeSavedPosts(JSON.parse(raw));
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
  function commitSavedPosts(nextPosts) {
    const result = tryCommitSavedPosts(savedPosts, nextPosts, persistSavedPosts);
    if (!result.committed) return false;
    savedPosts = /** @type {typeof savedPosts} */
    result.posts;
    rebuildIndex();
    return true;
  }
  __name(commitSavedPosts, "commitSavedPosts");
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
  async function addPost(post) {
    return withSavedPostsLock(() => {
      savedPosts = loadSavedPosts();
      rebuildIndex();
      if (!post || typeof post !== "object" || !post.url) return false;
      if (isSaved(post.url)) return false;
      if (savedPosts.length >= STORAGE_SOFT_LIMIT) {
        toast("Storage limit reached. Export or clear before saving more.", { type: "error" });
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
    });
  }
  __name(addPost, "addPost");
  async function removePost(url) {
    return withSavedPostsLock(() => {
      savedPosts = loadSavedPosts();
      rebuildIndex();
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
    });
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
  function buildUrlList() {
    return savedPosts.map((p) => p.url).join("\n") + (savedPosts.length ? "\n" : "");
  }
  __name(buildUrlList, "buildUrlList");
  function downloadUrlList() {
    if (savedPosts.length === 0) {
      toast("No saved posts to export.");
      return;
    }
    const filename = `x-saved-posts-${nowIso().slice(0, 10)}.txt`;
    const blob = new Blob([buildUrlList()], { type: "text/plain;charset=utf-8" });
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
  __name(downloadUrlList, "downloadUrlList");
  async function copyUrlListToClipboard() {
    if (savedPosts.length === 0) {
      toast("No saved posts to copy.");
      return;
    }
    const text = buildUrlList();
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(text);
        toast("Copied URLs to clipboard.");
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
      toast("Copied URLs to clipboard.");
    } catch {
      toast("Copy failed (permission blocked?).", { type: "error" });
    }
  }
  __name(copyUrlListToClipboard, "copyUrlListToClipboard");
  async function clearAllPosts() {
    updateSavedPostsFromStorage();
    if (savedPosts.length === 0) {
      toast("Nothing to clear.");
      return;
    }
    if (!confirm(`Clear ${savedPosts.length} saved posts?`)) return;
    const committed = await withSavedPostsLock(() => {
      savedPosts = loadSavedPosts();
      rebuildIndex();
      return commitSavedPosts([]);
    });
    if (!committed) return;
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
    const panel = document.getElementById(UI.panelId);
    if (panel) {
      const rect = panel.getBoundingClientRect();
      setPanelPosition(panel, { x: rect.left, y: rect.top });
    }
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
    style.textContent = main_default + `    #${UI.panelId} {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483647;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 8px;
      box-sizing: border-box;
      max-width: calc(100vw - 16px);
      border-radius: 999px;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(6px);
      font-family: 'Ioskeley Mono', ui-monospace, 'SF Mono', Menlo, monospace;
    }

    #${UI.panelId} > button:not(.xps-drag-handle) {
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

    #${UI.panelId} > button:not(.xps-drag-handle):hover {
      background: rgba(255, 255, 255, 0.08);
    }

    #${UI.panelId} > .xps-drag-handle {
      appearance: none;
      align-self: stretch;
      width: 16px;
      min-height: 32px;
      padding: 0;
      border: 0;
      border-radius: 6px;
      background: radial-gradient(circle, rgba(255, 255, 255, 0.72) 1.25px, transparent 1.5px)
        center / 6px 6px;
      cursor: grab;
      touch-action: none;
      user-select: none;
    }

    #${UI.panelId}[data-dragging="1"] > .xps-drag-handle {
      cursor: grabbing;
    }

    #${UI.panelId} > .xps-drag-handle:focus-visible {
      outline: 2px solid rgb(29, 155, 240);
      outline-offset: 2px;
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
      font-family: 'Ioskeley Mono', ui-monospace, 'SF Mono', Menlo, monospace;
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

    /* button.xps-save-btn styles live in src/main.css (which also carries
       the embedded Ioskeley Mono @font-face); esbuild inlines both. */

  `;
    (document.head || document.documentElement).appendChild(style);
  }
  __name(ensureStyles, "ensureStyles");
  function setPanelPosition(panel, position, { persist = false } = {}) {
    const rect = panel.getBoundingClientRect();
    const constrained = clampPanelPosition(
      position,
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight }
    );
    panel.style.left = `${constrained.x}px`;
    panel.style.top = `${constrained.y}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    if (persist) storageSet(PANEL_POSITION_KEY, JSON.stringify(constrained));
    return constrained;
  }
  __name(setPanelPosition, "setPanelPosition");
  function makePanelDraggable(panel, handle) {
    const storedPosition = parsePanelPosition(storageGet(PANEL_POSITION_KEY));
    const initialRect = panel.getBoundingClientRect();
    setPanelPosition(panel, storedPosition || { x: initialRect.left, y: initialRect.top });
    let drag = null;
    handle.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary || event.button !== 0) return;
      const rect = panel.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top
      };
      panel.dataset.dragging = "1";
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    handle.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      setPanelPosition(panel, {
        x: event.clientX - drag.offsetX,
        y: event.clientY - drag.offsetY
      });
    });
    const finishDrag = /* @__PURE__ */ __name((event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const rect = panel.getBoundingClientRect();
      drag = null;
      delete panel.dataset.dragging;
      setPanelPosition(panel, { x: rect.left, y: rect.top }, { persist: true });
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    }, "finishDrag");
    handle.addEventListener("pointerup", finishDrag);
    handle.addEventListener("pointercancel", finishDrag);
    handle.addEventListener("keydown", (event) => {
      const movement = {
        ArrowLeft: [-16, 0],
        ArrowRight: [16, 0],
        ArrowUp: [0, -16],
        ArrowDown: [0, 16]
      }[event.key];
      if (!movement) return;
      const rect = panel.getBoundingClientRect();
      setPanelPosition(
        panel,
        { x: rect.left + movement[0], y: rect.top + movement[1] },
        { persist: true }
      );
      event.preventDefault();
    });
    window.addEventListener("resize", () => {
      const rect = panel.getBoundingClientRect();
      setPanelPosition(panel, { x: rect.left, y: rect.top });
    });
  }
  __name(makePanelDraggable, "makePanelDraggable");
  function ensurePanel() {
    if (document.getElementById(UI.panelId)) return;
    const panel = document.createElement("div");
    panel.id = UI.panelId;
    const dragHandle = document.createElement("button");
    dragHandle.type = "button";
    dragHandle.className = "xps-drag-handle";
    dragHandle.setAttribute("aria-label", "Move panel");
    dragHandle.title = "Drag to move";
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
    const exportUrlsBtn = document.createElement("button");
    exportUrlsBtn.type = "button";
    exportUrlsBtn.textContent = "Export URLs";
    exportUrlsBtn.addEventListener("click", downloadUrlList);
    const copyUrlsBtn = document.createElement("button");
    copyUrlsBtn.type = "button";
    copyUrlsBtn.textContent = "Copy URLs";
    copyUrlsBtn.addEventListener("click", () => {
      void copyUrlListToClipboard();
    });
    panel.appendChild(dragHandle);
    panel.appendChild(exportBtn);
    panel.appendChild(copyBtn);
    panel.appendChild(exportUrlsBtn);
    panel.appendChild(copyUrlsBtn);
    panel.appendChild(clearBtn);
    (document.documentElement || document.body).appendChild(panel);
    makePanelDraggable(panel, dragHandle);
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
        const canonical = canonicalizeStatusUrl(abs);
        if (canonical) return canonical;
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
        const canonical = canonicalizeStatusUrl(abs);
        if (canonical) candidates.push({ url: canonical, link });
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
  function findLongformTextElement(tweetElement, containerArticle) {
    return findFirstWithinArticle(tweetElement, '[data-testid="longformRichTextComponent"]', containerArticle) || findFirstWithinArticle(tweetElement, '[data-testid="twitterArticleRichTextView"]', containerArticle);
  }
  __name(findLongformTextElement, "findLongformTextElement");
  function findLongformTitleElement(tweetElement, containerArticle) {
    return findFirstWithinArticle(tweetElement, '[data-testid="twitter-article-title"]', containerArticle);
  }
  __name(findLongformTitleElement, "findLongformTitleElement");
  function extractTextFromElement(el) {
    if (!el) return "";
    return String(el.innerText || el.textContent || "").trim();
  }
  __name(extractTextFromElement, "extractTextFromElement");
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
    if (!textEl) {
      const title = extractTextFromElement(findLongformTitleElement(tweetElement, containerArticle));
      const longform = extractTextFromElement(findLongformTextElement(tweetElement, containerArticle));
      if (title && longform) {
        const normalizedTitle = normalizeUiLabel(title);
        const normalizedLongform = normalizeUiLabel(longform);
        if (normalizedTitle && normalizedLongform.startsWith(normalizedTitle)) return longform;
        return `${title}

${longform}`;
      }
      return longform || title;
    }
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
    const contentRoots = [];
    const textEl = findTweetTextElement(tweetElement, containerArticle);
    if (textEl) contentRoots.push(textEl);
    const longformEl = findLongformTextElement(tweetElement, containerArticle);
    if (longformEl && !contentRoots.includes(longformEl)) contentRoots.push(longformEl);
    const longformTitleEl = findLongformTitleElement(tweetElement, containerArticle);
    if (longformTitleEl && !contentRoots.includes(longformTitleEl)) contentRoots.push(longformTitleEl);
    for (const root of contentRoots) {
      const anchors = root.querySelectorAll ? root.querySelectorAll("a[href]") : [];
      for (const a of anchors) {
        const expanded = a.getAttribute("data-expanded-url");
        const title = a.getAttribute("title");
        const href = a.getAttribute("href");
        if (expanded && /^https?:\/\//i.test(expanded)) add(expanded);
        else if (title && /^https?:\/\//i.test(title)) add(title);
        else add(href);
      }
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
    let tweetElement = button.closest("article") || button.closest('div[data-testid="cellInnerDiv"]');
    if (!tweetElement) {
      toast("Could not locate the post container yet.", { type: "error" });
      return;
    }
    if (tweetElement instanceof Element && isArticleReadView(tweetElement)) {
      tweetElement = tweetElement.parentElement?.closest("article") || tweetElement;
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
      const shouldRemove = button.classList.contains("xps-saved");
      if (shouldRemove) {
        const ok = await removePost(post.url);
        if (ok) toast("Removed.");
      } else {
        const ok = await addPost(post);
        if (ok) toast("Saved.");
      }
    } finally {
      button.disabled = wasDisabled;
    }
  }
  __name(onSaveButtonClick, "onSaveButtonClick");
  function ensureSaveButton(tweetElement) {
    const url = getTweetPermalink(tweetElement);
    if (!url) return;
    const actionBar = findActionBar(tweetElement);
    if (!actionBar) return;
    let button = (
      /** @type {HTMLButtonElement|null} */
      actionBar.querySelector("button.xps-save-btn")
    );
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
    removeStaleSaveButtons(tweetElement, actionBar);
  }
  __name(ensureSaveButton, "ensureSaveButton");
  function ensureSaveButtonsForTweet(tweetElement) {
    ensureSaveButton(tweetElement);
    for (const nested of tweetElement.querySelectorAll(ARTICLE_READ_VIEW_SELECTOR)) {
      ensureSaveButton(nested);
    }
  }
  __name(ensureSaveButtonsForTweet, "ensureSaveButtonsForTweet");
  function scanForTweets(root) {
    if (!root) return;
    if (root instanceof Element && root.matches("article")) {
      if (!root.parentElement?.closest("article")) ensureSaveButtonsForTweet(root);
      else if (isArticleReadView(root)) ensureSaveButton(root);
      return;
    }
    const selector = "article";
    const articles = root.querySelectorAll ? root.querySelectorAll(selector) : [];
    for (const article of articles) {
      if (article.parentElement?.closest("article")) {
        if (isArticleReadView(article)) ensureSaveButton(article);
        continue;
      }
      ensureSaveButtonsForTweet(article);
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
        const targetArticle = getMutationArticle(mutation.target);
        if (targetArticle) scheduleScan(targetArticle);
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          const owningArticle = getMutationArticle(node);
          if (owningArticle) {
            scheduleScan(owningArticle);
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
