import { describe, it, expect } from 'vitest';
import { tryCommitSavedPosts } from '../src/storage.js';

describe('tryCommitSavedPosts', () => {
  it('keeps the current state when persistence fails', () => {
    const current = [{ id: '1' }];
    const next = [];

    const result = tryCommitSavedPosts(current, next, () => false);

    expect(result).toEqual({ committed: false, posts: current });
  });

  it('keeps the current state when persistence throws', () => {
    const current = [{ id: '1' }];
    const next = [];

    const result = tryCommitSavedPosts(current, next, () => {
      throw new Error('storage unavailable');
    });

    expect(result).toEqual({ committed: false, posts: current });
  });

  it('returns the next state only after persistence succeeds', () => {
    const current = [{ id: '1' }];
    const next = [{ id: '2' }];
    const persisted = [];

    const result = tryCommitSavedPosts(current, next, (posts) => {
      persisted.push(posts);
      return true;
    });

    expect(result).toEqual({ committed: true, posts: next });
    expect(persisted).toEqual([next]);
  });
});
