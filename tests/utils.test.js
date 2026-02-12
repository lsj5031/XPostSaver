import { describe, it, expect } from 'vitest';
import {
  tweetIdFromUrl,
  sanitizeLinks,
  sanitizeMedia,
  sanitizeQuotedPost,
  sanitizePost,
  canonicalizeStatusUrl,
  normalizeUrlForCompare,
  getPostKeyFromUrl,
  getPostKey,
  normalizeSavedPosts,
  buildJsonl,
  isLikelyImageMediaUrl,
  withOriginalImageSize,
  normalizeUiLabel,
} from '../src/utils.js';

describe('tweetIdFromUrl', () => {
  it('extracts ID from x.com URL', () => {
    expect(tweetIdFromUrl('https://x.com/user/status/123456789')).toBe('123456789');
  });

  it('extracts ID from twitter.com URL', () => {
    expect(tweetIdFromUrl('https://twitter.com/user/status/987654321')).toBe('987654321');
  });

  it('extracts ID from URL with query params', () => {
    expect(tweetIdFromUrl('https://x.com/user/status/111?s=20')).toBe('111');
  });

  it('returns null when no status segment', () => {
    expect(tweetIdFromUrl('https://x.com/user')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(tweetIdFromUrl(undefined)).toBeNull();
    expect(tweetIdFromUrl(null)).toBeNull();
    expect(tweetIdFromUrl(42)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(tweetIdFromUrl('')).toBeNull();
  });
});

describe('sanitizeLinks', () => {
  it('returns valid string array unchanged', () => {
    expect(sanitizeLinks(['https://a.com', 'https://b.com'])).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('filters out non-string values', () => {
    expect(sanitizeLinks(['https://a.com', 42, null, undefined, true])).toEqual(['https://a.com']);
  });

  it('returns empty array for non-array input', () => {
    expect(sanitizeLinks('not array')).toEqual([]);
    expect(sanitizeLinks(null)).toEqual([]);
    expect(sanitizeLinks(undefined)).toEqual([]);
  });

  it('trims whitespace from strings', () => {
    expect(sanitizeLinks(['  https://a.com  ', '\thttps://b.com\n'])).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('filters out empty strings and whitespace-only strings', () => {
    expect(sanitizeLinks(['', '   ', 'https://a.com'])).toEqual(['https://a.com']);
  });
});

describe('sanitizeMedia', () => {
  it('returns valid media objects', () => {
    const input = [{ type: 'photo', url: 'https://example.com/img.jpg' }];
    expect(sanitizeMedia(input)).toEqual([{ type: 'photo', url: 'https://example.com/img.jpg' }]);
  });

  it('filters out objects missing url', () => {
    expect(sanitizeMedia([{ type: 'photo' }])).toEqual([]);
  });

  it('filters out objects with empty url', () => {
    expect(sanitizeMedia([{ type: 'photo', url: '' }])).toEqual([]);
    expect(sanitizeMedia([{ type: 'photo', url: '   ' }])).toEqual([]);
  });

  it('filters out non-objects', () => {
    expect(sanitizeMedia([null, 42, 'str', undefined])).toEqual([]);
  });

  it('returns empty array for non-array input', () => {
    expect(sanitizeMedia(null)).toEqual([]);
    expect(sanitizeMedia('bad')).toEqual([]);
  });

  it('defaults type to empty string if not a string', () => {
    const result = sanitizeMedia([{ url: 'https://example.com/img.jpg' }]);
    expect(result).toEqual([{ type: '', url: 'https://example.com/img.jpg' }]);
  });

  it('trims url whitespace', () => {
    const result = sanitizeMedia([{ type: 'photo', url: '  https://example.com/img.jpg  ' }]);
    expect(result[0].url).toBe('https://example.com/img.jpg');
  });
});

describe('sanitizeQuotedPost', () => {
  it('returns sanitized quoted post for valid input', () => {
    const input = {
      url: 'https://x.com/user/status/1',
      author: 'Author',
      handle: '@handle',
      text: 'hello',
      date: '2024-01-01',
      links: ['https://a.com'],
      media: [{ type: 'photo', url: 'https://img.com/a.jpg' }],
    };
    const result = sanitizeQuotedPost(input);
    expect(result).toEqual({
      url: 'https://x.com/user/status/1',
      author: 'Author',
      handle: '@handle',
      text: 'hello',
      date: '2024-01-01',
      links: ['https://a.com'],
      media: [{ type: 'photo', url: 'https://img.com/a.jpg' }],
    });
  });

  it('returns null for null/undefined', () => {
    expect(sanitizeQuotedPost(null)).toBeNull();
    expect(sanitizeQuotedPost(undefined)).toBeNull();
  });

  it('returns null for post without url', () => {
    expect(sanitizeQuotedPost({ author: 'A' })).toBeNull();
  });

  it('returns null for post with empty url', () => {
    expect(sanitizeQuotedPost({ url: '' })).toBeNull();
    expect(sanitizeQuotedPost({ url: '   ' })).toBeNull();
  });

  it('defaults missing optional fields', () => {
    const result = sanitizeQuotedPost({ url: 'https://x.com/user/status/1' });
    expect(result.author).toBe('');
    expect(result.handle).toBe('');
    expect(result.text).toBe('');
    expect(result.date).toBe('');
    expect(result.links).toEqual([]);
    expect(result.media).toEqual([]);
  });
});

describe('sanitizePost', () => {
  it('returns sanitized post with all fields', () => {
    const input = {
      id: '999',
      url: 'https://x.com/user/status/999',
      author: 'Author',
      handle: '@handle',
      text: 'content',
      date: '2024-01-01',
      saved_at: '2024-01-02T00:00:00.000Z',
      links: ['https://a.com'],
      media: [{ type: 'photo', url: 'https://img.com/a.jpg' }],
      quoted: { url: 'https://x.com/q/status/1', text: 'quote' },
    };
    const result = sanitizePost(input);
    expect(result).not.toBeNull();
    expect(result.id).toBe('999');
    expect(result.url).toBe('https://x.com/user/status/999');
    expect(result.author).toBe('Author');
    expect(result.saved_at).toBe('2024-01-02T00:00:00.000Z');
    expect(result.quoted).not.toBeNull();
    expect(result.quoted.url).toBe('https://x.com/q/status/1');
  });

  it('returns null for post without url', () => {
    expect(sanitizePost({ id: '1' })).toBeNull();
  });

  it('resolves id from url when id is missing', () => {
    const result = sanitizePost({ url: 'https://x.com/user/status/555' });
    expect(result.id).toBe('555');
  });

  it('uses defaultSavedAt when saved_at is missing', () => {
    const result = sanitizePost(
      { url: 'https://x.com/user/status/1' },
      { defaultSavedAt: '2024-06-01T00:00:00.000Z' },
    );
    expect(result.saved_at).toBe('2024-06-01T00:00:00.000Z');
  });

  it('prefers post saved_at over defaultSavedAt', () => {
    const result = sanitizePost(
      { url: 'https://x.com/user/status/1', saved_at: '2024-01-01' },
      { defaultSavedAt: '2024-06-01' },
    );
    expect(result.saved_at).toBe('2024-01-01');
  });

  it('returns null for null input', () => {
    expect(sanitizePost(null)).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(sanitizePost('string')).toBeNull();
    expect(sanitizePost(42)).toBeNull();
  });
});

describe('canonicalizeStatusUrl', () => {
  it('canonicalizes x.com URL', () => {
    expect(canonicalizeStatusUrl('https://x.com/user/status/123')).toBe(
      'https://x.com/user/status/123',
    );
  });

  it('converts twitter.com to x.com', () => {
    expect(canonicalizeStatusUrl('https://twitter.com/user/status/123')).toBe(
      'https://x.com/user/status/123',
    );
  });

  it('handles relative URL', () => {
    expect(canonicalizeStatusUrl('/user/status/123')).toBe('https://x.com/user/status/123');
  });

  it('handles /i/web/status/ URL', () => {
    expect(canonicalizeStatusUrl('https://x.com/i/web/status/123')).toBe(
      'https://x.com/i/web/status/123',
    );
  });

  it('strips extra path segments', () => {
    expect(canonicalizeStatusUrl('https://x.com/user/status/123/photo/1')).toBe(
      'https://x.com/user/status/123',
    );
  });

  it('strips query params', () => {
    expect(canonicalizeStatusUrl('https://x.com/user/status/123?s=20&t=abc')).toBe(
      'https://x.com/user/status/123',
    );
  });

  it('returns null for invalid input', () => {
    expect(canonicalizeStatusUrl(42)).toBeNull();
    expect(canonicalizeStatusUrl(null)).toBeNull();
    expect(canonicalizeStatusUrl(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(canonicalizeStatusUrl('')).toBeNull();
    expect(canonicalizeStatusUrl('   ')).toBeNull();
  });

  it('returns null for URL without status', () => {
    expect(canonicalizeStatusUrl('https://x.com/user')).toBeNull();
  });
});

describe('normalizeUrlForCompare', () => {
  it('strips hash and search from URL', () => {
    const result = normalizeUrlForCompare('https://x.com/user/status/123?s=20#section');
    expect(result).toBe('https://x.com/user/status/123');
  });

  it('returns empty string for non-string', () => {
    expect(normalizeUrlForCompare(null)).toBe('');
    expect(normalizeUrlForCompare(42)).toBe('');
    expect(normalizeUrlForCompare(undefined)).toBe('');
  });

  it('normalizes a standard URL', () => {
    const result = normalizeUrlForCompare('https://x.com/user/status/123');
    expect(result).toBe('https://x.com/user/status/123');
  });
});

describe('getPostKeyFromUrl', () => {
  it('returns status ID when URL contains one', () => {
    expect(getPostKeyFromUrl('https://x.com/user/status/789')).toBe('789');
  });

  it('returns normalized URL when no status ID', () => {
    const result = getPostKeyFromUrl('https://x.com/user');
    expect(result).toBe('https://x.com/user');
  });

  it('returns empty string for non-string', () => {
    expect(getPostKeyFromUrl(null)).toBe('');
    expect(getPostKeyFromUrl(undefined)).toBe('');
    expect(getPostKeyFromUrl(42)).toBe('');
  });
});

describe('getPostKey', () => {
  it('returns id when post has id', () => {
    expect(getPostKey({ id: 'abc123', url: 'https://x.com/user/status/1' })).toBe('abc123');
  });

  it('returns key from url when post has no id', () => {
    expect(getPostKey({ url: 'https://x.com/user/status/456' })).toBe('456');
  });

  it('trims whitespace from id', () => {
    expect(getPostKey({ id: '  abc  ' })).toBe('abc');
  });

  it('falls back to url key when id is empty string', () => {
    expect(getPostKey({ id: '', url: 'https://x.com/user/status/789' })).toBe('789');
  });

  it('returns empty string for null', () => {
    expect(getPostKey(null)).toBe('');
  });

  it('returns empty string for non-object', () => {
    expect(getPostKey('string')).toBe('');
    expect(getPostKey(42)).toBe('');
  });
});

describe('normalizeSavedPosts', () => {
  it('sanitizes valid posts', () => {
    const input = [
      { url: 'https://x.com/a/status/1', text: 'hello' },
      { url: 'https://x.com/b/status/2', text: 'world' },
    ];
    const result = normalizeSavedPosts(input);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('1');
    expect(result[1].id).toBe('2');
  });

  it('deduplicates posts with same ID', () => {
    const input = [
      { id: '1', url: 'https://x.com/a/status/1', text: 'first' },
      { id: '1', url: 'https://x.com/a/status/1', text: 'duplicate' },
    ];
    const result = normalizeSavedPosts(input);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('first');
  });

  it('filters out invalid items', () => {
    const input = [null, undefined, 42, 'str', { url: 'https://x.com/a/status/1' }];
    const result = normalizeSavedPosts(input);
    expect(result).toHaveLength(1);
  });

  it('returns empty array for non-array input', () => {
    expect(normalizeSavedPosts(null)).toEqual([]);
    expect(normalizeSavedPosts('bad')).toEqual([]);
    expect(normalizeSavedPosts(42)).toEqual([]);
  });

  it('filters out posts without url', () => {
    const result = normalizeSavedPosts([{ id: '1' }]);
    expect(result).toEqual([]);
  });
});

describe('buildJsonl', () => {
  it('builds JSONL string with trailing newline', () => {
    const input = [{ a: 1 }, { b: 2 }];
    const result = buildJsonl(input);
    expect(result).toBe('{"a":1}\n{"b":2}\n');
  });

  it('returns empty string for empty array', () => {
    expect(buildJsonl([])).toBe('');
  });

  it('handles single item', () => {
    expect(buildJsonl([{ x: 'y' }])).toBe('{"x":"y"}\n');
  });
});

describe('isLikelyImageMediaUrl', () => {
  it('returns true for twimg.com /media/ URL', () => {
    expect(isLikelyImageMediaUrl('https://pbs.twimg.com/media/abc.jpg')).toBe(true);
  });

  it('returns true for twimg.com /ext_tw_video_thumb/ URL', () => {
    expect(isLikelyImageMediaUrl('https://pbs.twimg.com/ext_tw_video_thumb/123/thumb.jpg')).toBe(
      true,
    );
  });

  it('returns true for twimg.com /tweet_video_thumb/ URL', () => {
    expect(isLikelyImageMediaUrl('https://pbs.twimg.com/tweet_video_thumb/abc.jpg')).toBe(true);
  });

  it('returns true for twimg.com /amplify_video_thumb/ URL', () => {
    expect(isLikelyImageMediaUrl('https://pbs.twimg.com/amplify_video_thumb/abc.jpg')).toBe(true);
  });

  it('returns false for non-twimg domain', () => {
    expect(isLikelyImageMediaUrl('https://example.com/media/img.jpg')).toBe(false);
  });

  it('returns false for twimg without matching path', () => {
    expect(isLikelyImageMediaUrl('https://pbs.twimg.com/profile_images/abc.jpg')).toBe(false);
  });

  it('returns false for non-string', () => {
    expect(isLikelyImageMediaUrl(null)).toBe(false);
    expect(isLikelyImageMediaUrl(42)).toBe(false);
    expect(isLikelyImageMediaUrl(undefined)).toBe(false);
  });
});

describe('withOriginalImageSize', () => {
  it('replaces name param with orig', () => {
    const result = withOriginalImageSize('https://pbs.twimg.com/media/abc.jpg?name=small');
    expect(result).toContain('name=orig');
    expect(result).not.toContain('name=small');
  });

  it('leaves URL without name param unchanged', () => {
    const url = 'https://pbs.twimg.com/media/abc.jpg';
    expect(withOriginalImageSize(url)).toBe(url);
  });

  it('returns input as-is for non-string', () => {
    expect(withOriginalImageSize(null)).toBeNull();
    expect(withOriginalImageSize(undefined)).toBeUndefined();
    expect(withOriginalImageSize(42)).toBe(42);
  });

  it('handles URL with multiple params', () => {
    const result = withOriginalImageSize(
      'https://pbs.twimg.com/media/abc.jpg?format=jpg&name=medium',
    );
    expect(result).toContain('name=orig');
    expect(result).toContain('format=jpg');
  });
});

describe('normalizeUiLabel', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeUiLabel('  Show  more  ')).toBe('Show more');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeUiLabel('')).toBe('');
  });

  it('collapses tabs, newlines, and multiple spaces', () => {
    expect(normalizeUiLabel('\t  hello\n\n  world  ')).toBe('hello world');
  });

  it('handles falsy values', () => {
    expect(normalizeUiLabel(null)).toBe('');
    expect(normalizeUiLabel(undefined)).toBe('');
  });
});
