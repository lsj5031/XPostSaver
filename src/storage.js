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
