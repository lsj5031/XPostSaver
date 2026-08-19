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
  var main_default = "/*\n  Ioskeley Mono \u2014 Iosevka configured to mimic Berkeley Mono.\n  SIL Open Font License 1.1, (c) 2025 Ahmed Hatem.\n  https://github.com/ahatem/IoskeleyMono\n\n  Subset to the UI character set by scripts/gen-fonts.js. Hosted at\n  https://ahatem.github.io/IoskeleyMono/fonts/ and\n  https://cdn.jsdelivr.net/gh/ahatem/IoskeleyMono@main/site/fonts/\n  (full faces); x.com's CSP allows data: URIs but not those hosts, so the\n  built userscript embeds them.\n*/\n@font-face {\n  font-family: 'Ioskeley Mono';\n  font-style: normal;\n  font-weight: 400;\n  font-display: swap;\n  src: url('data:font/woff2;base64,d09GMgABAAAAABKkABEAAAAAJeAAABJIACIKPQAAAAAAAAAAAAAAAAAAAAAAAAAAGhYbIBxwBmAAgRwIaAmcFREICpkElXgBNgIkAywLLAAEIAWMYAcgDIFAGwQjBeyYD7BxAHiZXkLx/+WAHmL1C/gmsuiAG+EX+2ObkHwnc3WFvZgMRCKEp1Gdftpq3dIyrS61WqUqrUb9P/ah4poJo/q2Z8Zg93w9jQViZrr7Z7vMd3iEJLN+37T9MrO0uleaozXhz5EoHjpEnXHQNULK86vp69uTXIvOLWUnNyeX2zTU2nNpRfrfHp4QlDEywUGlIhQAQ2gMHjf9ewlihSClSWidiTid01HziQsTk8pUYF4XNueLTcT5zf9O240lT6M+c460/UnTlbzRcacQEr2E43kkCqdZ1GWS7SQHAFTYpv62PM81aN7fwFqQsqCUxsPn7f397XY30UEkWUATS1IvCyTlJte2/ZF+oYBHQqZRirevVcwRs1DE/rWZXFQJKzDKT2U/bYAONiTTIegHpfOei9pFra4a7bE6Z1I60+xUCDF15VbbcXsO///X/LT3vplpUk6KvETCFdChUlVv381L5r038wFn/3yaLGU5k78lSlIAOB4l8cdAibKrCixcPaueKiBna3VlhZV9rKXnUZGSgu/tMdQ60zmypYoWEY1N7n7OAwLYRRj1hacgrXe2jVvwB+nd1xaHGnIAWAvwDOjIZTdKP6eWEfOmT0THmOmjJqBn4rCZk9FjNgGg0Kio/qhb6zSOWMqJU0ZMRK1NNcwR2B62oovQ2+lATiWRLRAD2kvVAPDfaspXyBK5TE6hRU4D8Lwvgdp4PRIj8AshzMvSukcA2Ef8gJslo5wwRRlLADS10iJ8+igWYECjF9PoZdOBc5cIFJAUI9Fg6l+CrDN0HAHZ30Xhd2EhzIXrwiXhonBCOCZkCulCmnBA2C/sA8FdvVjYF4xeUo8pGbA2U1nCd8RlYCTY0F+nn6w+VRizhG1kgbBh5F+Kl5+fzD6Z19nHBFPCXhgosHkLvVub5Hd+BeYmGDqKE+T9IUlMdyK0ozmWM2Mt4YhA6bcgYPSOaHRVE0diYsU6UkNzQYcfzPgetUSMvpDhni/+jCQ8moKyQMJeasg2py1xjtHTffXM7uKtoph9/wyTmPhWK0OEiYSwGc61NYhzCyxGE/UMhh+CQeq1atCA35tk5a82JD0cjAfk54IljXrwO3DiJp+Uq80P1cpdLLU3lo4URUWpYUjLPk5iKZ2Cw3cRJshf9QQkKuLaBdCSNitAIYiqjAYkkTKOCduBsLJTFnWNZo5Sx0q6VWEMe4VbDg3VJikxqfIA/QhpoHh15AwDkMXUgAL3AoXgKQreWKvEypGPOjeQ1heh4aEjgvZMEKLO9bzVYExuxrZOZNf1T0kl1RLJyv0Q90w60CBqFWztBKONOPKNJnMUjGJ2W3DJBlF9cfACQnifSBoTYrNcgMKMo9hA+QIKjm8ZGsDJs1WpZnfsVzNJrBX3ggPfsdMHpJefTp4M65UxCYFkMWKQvTWamHfBRFq20DXBVtwC0kjz+o6uj9xKJ32nCBXXoBBhFV3Iu5HN7dS2Rqx2rKPSCnFz/CRHjiqLJQCV3LDjQq8PXqnqw21URY5qGyk2NXHL0MzemmpG5JcWvgdSU2ObR6Gwy76+pvxKpjhoV+2HzcNDp7HR0s6tswKDPHY1sDGx9lQnJZAk+qJco6o20QtI414oCEYyNZC/1HmkmrHCzvZ4BgRkOaBzsVLJEVVy+apMyqpJZNMCGAp9Igmvv6HI6UPT20yBmzsK1ASPARXBUx5IK494YxqdxQDuwXsvA+heN7EuuvbEH+kLevNKHQ1WoEgDGBmCiREwMwoWxsDKOLAxHuxMAAcTgZOJh6MmiRiXfLV5FAQV8eyz4eHqMZ2Ewf5w9HgiYH981Fw2w0wBryLWVwehygWKblT0oKIXFX2o6EfFACoGUTGEimFUjKCuTBjqyQvJeKSpQk+mppfePFZMlG9Hyihuis/OjGPagBEym5e0JIt89TBt4gCZzD5fFK1zxTcR0zOFk2IQ3ipXPytT1cCVOcMn+kN5m1HXMec5JCZCFUf/WMD/AACY/SZLJSdFxxK9Y8FQYxRIQKD/BjkWrXpUO5ZeiIgcsxqUrRD4iAojQvh4Cuv5ayHcLSeEM2OVGHxbEinudxwrRvBfjMGTRUvatYsM7yll9zwnAlDnkjiWajeq3WaQD96kJvjaDGBrK1wwXVQD15eL4+oX3g0SInvNAhlGf62cvToufpkfqZdgjI2QY2pSxJgMouO1rOGKJDipU8owLRmhhEOS+CJftxmx1qKUrFUcInIxgbK6A2Tlu7CoKJQL62U8rlHHmiCLACBXBlIvbSTq3ZSA3KEUrkUu2xoACikjN8eX2g0VarEmd9Ag5zO9Tj5i11j/XSaTyorTXuZMh9K/epNOG5Om4587ZQPPJnp9ywSVlBzUNjLsmQMNqLUqKRnuUo7ZPu2B2bvuDkLVZo+4a6wkt8U9YzVlVxaFdjtz6QVOilgxdQb9bvBF6pXyB4myRBHQ6eIKczUqWfISH1iR5NHLK31i/yNGpSyYiQXtgbUsGVs0vVbJwnAYnidp1AjjudfKRnLKRQLHXvHxd7Uwz917y2Rh5vhMClMrILNOFk00M5ZfMJ8O/JygwjB7a8m6FjatOzmfxJbWAuYdrpjAeicEbpjoLRAX2E4o2O+EwAOT+NEuAKDFkyVw3hmBF0vgugdA8GYJ3HdG4MMS/fSMc+wlKnjbCYHvTPQHEBcZaV0oMHYC0GTEWORwltl0AmdnAF2LGE8Jhb5FINgZwNAiWyIrpGsaTdzXeUEJdoKqTmNPFWpu9u0DCLkDq3AAZT/pho2V3Q1ru5vXdKAGrQ896BxA7wCGftIdFUe7O052d5zt7rhIBasD2ByoXSZ64GH3wNPugZfdA2+p4HEAr4OVX9NW/k23iMXkZKjx1ZPEmoKS1XcpjLpgc9T0l/Y4ThgIRBCgxH2niuQ13vsY0GOAWwAoAHaBmIgcuPFcnZQnihSh1jab26ok9b1swZ18/P07aBX11Rfgz/JeKtWwdfdPVa4i531IL3VHxffqarcS159DTcFdEPu9ZW3lPWU8We8+3yh2bxbdX7mq7ivQ+L1jZW2h4558kbt+waWi4u6wdVeuKOvUufRayDh/OvuqdJW50ICCHDvqWHfkWurEHlD2vSeP8uXk7jpR4s8Hib3QjRpHupWieq31pcNcx0HY+Qs55qO5Z8eW8Ml4Dy29LGSxLGmmeNg6Y0+CJbqj+Dru3p1GrggpbGe4RWe/ww037ulqOJq5ISzJG5/36GyPQ5s6ViU7vOOBbeQedaPh1AnA5u3BYUP0LkUcHvI3drWry6K6BQxjTOuwsKL5eb9HYpHqJXmSk4I3H2f76iZ6asUwGGDBbzDYdPBcMpJx3KMDN3mi0xEqtwHnjY9JgqhAy9vRJ/co0vSVRchGPkHhPDU0nHvBRCBCpE57Im+tf1n9BogaQblwKNq0rQ/i6/q3qcVbQ/jn49/A2c4QBs863rvRrEgtBAuRvAPo+A76KA0sybLAgqBuQHFYBLennbys1K0NVibvTeP2Z5hSlQOVqSnK+ERlUrIiIS4+w11L3HETlx/E2KxxQRbJg7N834UyS5AqSGZZ2Jc/+6ApCbIGhSqqmshVoY4/n6m8SVWoIqjegXGn62G19AE2bCY1DE+w6apaztYv089uWaWzJQw3dJzo61k2IK6urzqEeXC/emQ1s4yBo/cfMCEfhbq4Acs8e1/f8EHOY9bYv/Vh+u+xYS3szpixHcIC4p0fTNbv/YauNPnuXrZ7/fz4KctNXZiotNiNQ5kuuuBlwlqlLpNNG8Y9fJLJcZlPf1y6tHNjqSlB6/r1ySSPFXOL9nMcJ9t3gDO5MvQ6+uXSl5iJf/THeaovz/elzv/x56FfjG2inGV/jJ/AmvLOG7Si37e+wkymTz9vaBO6NJFy5rqsr/9xfCyvOd37TNlSoyksO9P7tGb+PwL339esOrNZKjWWpCU5s42+3mO5wbNMU+O9vi7adSRTrS68fCr6dzUdI2Wb6Y69zrG6VvUa1ZXatmnXxPS6NKlQLO2vKbx8fegf6kFTdFrjz4tqraZ6WHbpcoVUyj51hK9OY11s2upwx9M8ayyOPtog9nHsgKPRxUapVfPAndvnrMalOdsn1/3VbN/khMZSw/BEmyg7aJbBZZgVnGWwJQ43XFKGrOBtWz+xF3N2VO7TH6O5VXpq2gsNFSNmu4dc8RiOtOA1sLYm8/Bp7aizTPcRYSei91hf7gdDDZpILVXGzg38OHor88BdO+oM42LOjKp1P2A6h5rF/cnlulmmt3+1H8PPf+w+WeyGEypng/CZvtH6Vm3aN1bf3es/Qmewsuk+5cuFjgt9jKetpw/EHvhs/WzUL5/QRZce5SmUpsxNmeUZPdoza3BTsNEg6yX6To1alNc+qv3fpL7jzxXbt8hky5EnbjnTdn8qk6h4FGyg0AEAm0D7f6doirEEg8DRhBqHIuBkFGnUcsbWDPY26HWMSOrTxFIPFASOjEPONI7k4GEiQiOLRg5XJwRerV3NCeOb1sSIlGMS35PlE4FFQ04rP2U4453NHjlpIQJvrQSYsBCkWsTCDqvJqNNAlmQ3hMFNKwYENOQVEk8ABsNkduNm1lwAlJAe3TkLpp4NNg6pt6RU9ZUSgwuYMArvpKhABZvOAGFoJdP2NvEWWbnYAgCtWgQywQz44Td7TEa3KAa/bAlYMoOfqKTeZbpnT1qQAmlSaJtMBP0qhXgTU3n+2spNkTwF75BHFk6rJO7vJu4c+y+H/Aab/2dewNIQqCg7fOsQCjdWpOhFzFsxS8Fby6YO93OiFXthNWRWI6/d9adzZDFVywi9d52W1UU2Ewm6HGa9Uo4SKW0Lg5v/Zh1h+S7KT+qBLUpXft4K3PRlxf+1uUGrwa66ba1OUz4uR+NkE0fVVTEZDXqVAuzEvhmZn6QKTFb4U4JEaqUUe0m8yWg1bb8pFZPxkN9h12mgQAoY2pdl073HuJQAUdcYUSPhKTnE3Kd4YbI6AtS2b84xBS8xFUAotgl0Q52U9xN/icEpbDQALlkoxofZxOpJ05anPXZ1KoBPJSCXYHCgGOywN/OrwznHN/8oWs5m6YAIih3r6sE27CrJ4T2WRbUSxiDjXGsw/Smrk8UXqE9bjqJElRK/u5SyVt7/SmidGfkvf2RRnAlWMLoEYe63dvAoYEPpMjPoIBVko8ArEczVAphklptRJaTHFy0BrlNdi9Daxueuk6q2q+IgD7g3uv07N/exy/rLZtLPAcC/eaptvf+fdXhO/79cvCrkAAAHAASyTzBbraQkPbeputy9npQkXGK+hHv0iqT2XdJJ2f6ruvSuvjm7NhzKA4r4D2bfVJwb7z0gl/oBShyg3x+hhMrQDaxmiXFvs5xen2dlnvq5eg6c1WLR/6xW49FRtUsn5ugdszr9RTCrJwOpnrN6PW3Dr97v5eoDRK5ejFp++3oRpAaFY1wGGDNi1KTBdr0xUwaAMyjSJCI3B/VWexA+YghYgwIBlEBgV6RCTmNc04LEVxgNUs0rUEOitNGrdvFQ800UEtPgMIwIEs8uEwsQCnxtsBsLxk0YqsVHXEHqXHOTcoDm84BhUETMEIxNJEy6RxIOmVldey+JxGCVYsTPSYTRaSKYGlEUZ+PQmx9iGW1gbJwhSkAEPU7byAUao8RSSZgSmIDQbijCMmNiE8twhWIFsGXoQJhxeY+V5gwbzpWevEjahw9h+FhXzDIknTcsgGBJBRBecM+XI6v0iFSneRBMJEwHnMWWUAoOECsiBEp4I4N153Yd6PCYVCNgC/+aBzg4UC6vlCsc1UCvsvcspfVEgojEYZJF417KWkDIe7jqtOfejTnJDtdsKpTMFnUYGMqNYqT1x7Yc0LnyhDJOyxh8YxUjySU5GlJfttuqc2DXdM+xYULPuBwTIzB88KPVmUpQozdZQMZGN44ZySgBHvVIxRb6OFB4sFHmLURZCQrcy+zm5UJSIOgLEdT5eIMxz5UyJks9i0DzA9HjM0iYCbo0710CZWlYEkKil+NHcM/xRZB7GoS/YtokCBARdggacqLyY2LcMXpFc9s+VDi+3vmCedbw8qwvW0LdRfez+t8lIwcx+YpFLyo2SQ5CNiVfIP9jH/d0QNrzEjCnMdNx0avNxCFinYxWHBZoTTWkeMlLK3rmKO1y5AWg6PLgtQDswA4s6jocF8vHTNZEJ12wrElScMkahtdk2JQCy2VyNNgVZcnsICJy34i4YXF/PVdbUvUpg4RWN75GhJUXRBsdVB7nlgy+KB4pwewOAAA=') format('woff2');\n}\n@font-face {\n  font-family: 'Ioskeley Mono';\n  font-style: normal;\n  font-weight: 700;\n  font-display: swap;\n  src: url('data:font/woff2;base64,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') format('woff2');\n}\n\nbutton.xps-save-btn {\n  appearance: none;\n  border: 1px solid rgba(128, 128, 128, 0.35);\n  background: transparent;\n  color: inherit;\n  cursor: pointer;\n  user-select: none;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  /* X action bars use align-items: stretch; with an explicit height the\n     pill would top-align, so center it against the native icon buttons. */\n  align-self: center;\n  height: 30px;\n  padding: 0 10px;\n  margin-left: 8px;\n  border-radius: 999px;\n  font-family: 'Ioskeley Mono', ui-monospace, 'SF Mono', Menlo, monospace;\n  font-size: 12px;\n  font-weight: 700;\n  line-height: 1;\n  letter-spacing: 0;\n}\n\nbutton.xps-save-btn:hover {\n  background: rgba(29, 155, 240, 0.12);\n  border-color: rgba(29, 155, 240, 0.6);\n}\n\nbutton.xps-save-btn.xps-saved {\n  border-color: rgba(0, 186, 124, 0.75);\n  color: rgba(0, 186, 124, 1);\n}\n\nbutton.xps-save-btn.xps-saved:hover {\n  background: rgba(0, 186, 124, 0.12);\n}\n\n.xps-save-label {\n  font-weight: 700;\n}\n";

  // src/main.js
  var STORAGE_KEY = "xSavedPosts";
  var STORAGE_SYNC_KEY = "xpsSync";
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
    safeLocalStorageSet(STORAGE_SYNC_KEY, String(Date.now()));
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
  function addPost(post) {
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
  }
  __name(addPost, "addPost");
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
  function clearAllPosts() {
    if (savedPosts.length === 0) {
      toast("Nothing to clear.");
      return;
    }
    if (!confirm(`Clear ${savedPosts.length} saved posts?`)) return;
    if (!commitSavedPosts([])) return;
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
    style.textContent = main_default + `    #${UI.panelId} {
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

    /* button.xps-save-btn styles live in src/main.css (which also carries
       the embedded Ioskeley Mono @font-face); esbuild inlines both. */

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
    panel.appendChild(exportBtn);
    panel.appendChild(copyBtn);
    panel.appendChild(exportUrlsBtn);
    panel.appendChild(copyUrlsBtn);
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
