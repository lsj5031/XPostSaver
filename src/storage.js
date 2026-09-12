// @ts-check

/**
 * Persist a candidate post list before making it the in-memory state.
 *
 * @param {unknown[]} currentPosts
 * @param {unknown[]} nextPosts
 * @param {(posts: unknown[]) => boolean} persist
 */
export function tryCommitSavedPosts(currentPosts, nextPosts, persist) {
  try {
    if (!persist(nextPosts)) return { committed: false, posts: currentPosts };
  } catch {
    return { committed: false, posts: currentPosts };
  }

  return { committed: true, posts: nextPosts };
}

/**
 * Serialize saved-post mutations across tabs sharing the same origin.
 *
 * @template T
 * @param {() => T} task
 * @param {LockManager | undefined} [locks]
 * @returns {Promise<Awaited<T>>}
 */
export function withSavedPostsLock(task, locks = globalThis.navigator?.locks) {
  if (!locks || typeof locks.request !== 'function') {
    return /** @type {Promise<Awaited<T>>} */ (Promise.resolve().then(task));
  }
  return /** @type {Promise<Awaited<T>>} */ (locks.request('xps-saved-posts', task));
}
