import { describe, it, expect } from 'vitest';
import { tryCommitSavedPosts, withSavedPostsLock } from '../src/storage.js';

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

describe('withSavedPostsLock', () => {
  it('serializes read-modify-write saves so concurrent tabs do not lose posts', async () => {
    let tail = Promise.resolve();
    const locks = {
      request(_name, callback) {
        const result = tail.then(callback);
        tail = result.catch(() => {});
        return result;
      },
    };

    let releaseFirst;
    const firstPaused = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted;
    const firstEntered = new Promise((resolve) => {
      firstStarted = resolve;
    });
    let stored = [];

    const save = (id, pause = false) =>
      withSavedPostsLock(async () => {
        const current = [...stored];
        if (pause) {
          firstStarted();
          await firstPaused;
        }
        stored = [{ id }, ...current];
      }, locks);

    const first = save('1', true);
    await firstEntered;
    const second = save('2');
    releaseFirst();
    await Promise.all([first, second]);

    expect(stored).toEqual([{ id: '2' }, { id: '1' }]);
  });
});
