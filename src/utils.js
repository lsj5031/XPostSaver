// @ts-check

export function nowIso() {
  return new Date().toISOString();
}

/** @param {string} url */
export function tweetIdFromUrl(url) {
  if (typeof url !== 'string') return null;
  const match = url.match(/\/status\/(\d+)/i);
  return match ? match[1] : null;
}

/** @param {unknown[]} links */
export function sanitizeLinks(links) {
  if (!Array.isArray(links)) return [];
  return links
    .filter((l) => typeof l === 'string')
    .map((l) => /** @type {string} */ (l).trim())
    .filter(Boolean);
}

/** @param {unknown[]} media */
export function sanitizeMedia(media) {
  if (!Array.isArray(media)) return [];
  return media
    .filter((m) => m && typeof m === 'object')
    .map((m) => ({
      type: typeof /** @type {any} */ (m).type === 'string' ? /** @type {any} */ (m).type : '',
      url: typeof /** @type {any} */ (m).url === 'string' ? /** @type {any} */ (m).url.trim() : '',
    }))
    .filter((m) => m.url);
}

/** @param {any} post */
export function sanitizeQuotedPost(post) {
  if (!post || typeof post !== 'object') return null;
  const url = typeof post.url === 'string' ? post.url.trim() : '';
  if (!url) return null;
  return {
    url,
    author: typeof post.author === 'string' ? post.author : '',
    handle: typeof post.handle === 'string' ? post.handle : '',
    text: typeof post.text === 'string' ? post.text : '',
    date: typeof post.date === 'string' ? post.date : '',
    links: sanitizeLinks(post.links),
    media: sanitizeMedia(post.media),
  };
}

/**
 * @param {any} post
 * @param {{ defaultSavedAt?: string }} [options]
 */
export function sanitizePost(post, { defaultSavedAt = '' } = {}) {
  if (!post || typeof post !== 'object') return null;
  const url = typeof post.url === 'string' ? post.url.trim() : '';
  if (!url) return null;

  const providedId = typeof post.id === 'string' ? post.id.trim() : '';
  const resolvedId = providedId || tweetIdFromUrl(url) || '';
  const savedAt = typeof post.saved_at === 'string' ? post.saved_at : defaultSavedAt;

  return {
    id: resolvedId,
    url,
    author: typeof post.author === 'string' ? post.author : '',
    handle: typeof post.handle === 'string' ? post.handle : '',
    text: typeof post.text === 'string' ? post.text : '',
    date: typeof post.date === 'string' ? post.date : '',
    saved_at: savedAt,
    links: sanitizeLinks(post.links),
    media: sanitizeMedia(post.media),
    quoted: sanitizeQuotedPost(post.quoted),
  };
}

/** @param {string} raw */
export function canonicalizeStatusUrl(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  /** @type {URL} */
  let u;
  try {
    u = new URL(trimmed, 'https://x.com');
  } catch {
    return null;
  }

  const path = u.pathname || '';
  const matchUser = path.match(/^\/([^/]+)\/status\/(\d+)/i);
  if (matchUser) return `https://x.com/${matchUser[1]}/status/${matchUser[2]}`;

  const matchWeb = path.match(/^\/i\/web\/status\/(\d+)/i);
  if (matchWeb) return `https://x.com/i/web/status/${matchWeb[1]}`;

  const matchStatus = path.match(/^\/status\/(\d+)/i);
  if (matchStatus) return `https://x.com/status/${matchStatus[1]}`;

  return null;
}

/** @param {string} url */
export function normalizeUrlForCompare(url) {
  if (typeof url !== 'string') return '';
  const canonical = canonicalizeStatusUrl(url);
  const normalized = canonical || url;
  try {
    const u = new URL(normalized, 'https://x.com');
    u.hash = '';
    u.search = '';
    return u.toString();
  } catch {
    return normalized;
  }
}

/** @param {string} url */
export function getPostKeyFromUrl(url) {
  if (typeof url !== 'string') return '';
  const id = tweetIdFromUrl(url);
  if (id) return id;
  const normalized = normalizeUrlForCompare(url);
  if (normalized) return normalized;
  return url.trim();
}

/** @param {any} post */
export function getPostKey(post) {
  if (!post || typeof post !== 'object') return '';
  if (typeof post.id === 'string' && post.id.trim()) return post.id.trim();
  return getPostKeyFromUrl(post.url);
}

/** @param {unknown[]} input */
export function normalizeSavedPosts(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
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

/**
 * @param {Array<{url: string, [k: string]: any}>} posts
 */
export function buildJsonl(posts) {
  return posts.map((p) => JSON.stringify(p)).join('\n') + (posts.length ? '\n' : '');
}

/** @param {string} url */
export function isLikelyImageMediaUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (!host.endsWith('twimg.com')) return false;
    const path = u.pathname.toLowerCase();
    return (
      path.includes('/media/') ||
      path.includes('/ext_tw_video_thumb/') ||
      path.includes('/tweet_video_thumb/') ||
      path.includes('/amplify_video_thumb/')
    );
  } catch {
    return false;
  }
}

/** @param {string} url */
export function withOriginalImageSize(url) {
  if (typeof url !== 'string') return url;
  try {
    const u = new URL(url);
    if (u.searchParams.has('name')) u.searchParams.set('name', 'orig');
    return u.toString();
  } catch {
    return url;
  }
}

/** @param {string} value */
export function normalizeUiLabel(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}
