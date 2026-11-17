# Changelog

## 0.5.15

- Recover from an initially missing React bridge on the same feed container with
  bounded hydration retries and event-driven recovery, without permanent rejection.
- Discover native pagination callbacks in instance props even when React
  memoized props exist without the callback, matching the supplied upstream.
- Correct .14-only candidate restrictions: recognize wrapper-owned and primitive
  item keys, do not reject identity because position is structured, and preserve
  structured native coordinates/references instead of flattening them.
- Keep missing/repeated non-post loading-row labels from disabling the whole
  feed, without assigning anonymous slots to actual posts.
- Wait for delayed native React commits rather than permanently rejecting a
  known-post mismatch; suspend owned CSS until the commit can be matched.
- Give ambiguous loading-row/post commits a fixed six-second validation grace;
  resume matched commits automatically, otherwise restore native fallback.
- Show requested Masonry On separately from active, waiting or unsupported status
  in the existing panel control. Unknown candidates retain native layout with
  schema-only error context, never post content or identifiers.
- Add offline source/bundle page-world, hydration and native-restoration checks.
  Compare concrete regression shapes with exact .13/.14 release bundles.
  These shapes are modeled, not a live X candidate capture; live manager
  compatibility remains unverified.

## 0.5.14

- Keep placed posts in identity-stable columns as image/quote heights change;
  update downstream vertical positions without greedy cross-column repacking.
- Share synthetic native/rendered geometry, preserve columns through virtual DOM
  recycling and list edits, bound measurements and skip no-op native refreshes.
- Keep masonry badges and per-card keys stable across no-op events, counters and
  image reflow; reconcile geometry in bounded animation frames, not blanking debounce.
- Validate selected own-post mappings independently before background opening.
- Extend digit-first hints with d/e/q/y/z, retaining native navigation/audio
  prefix chains, media/typing guards and existing shortcuts.
- Avoid redundant engine layout writes and notify hints of actual placement changes.
- Add offline source/bundle frame-identity, expanded-pool and stale-key regressions.

## 0.5.13

- Replace the external masonry dependency with a default-on built-in feed engine.
- Adapt shortest-column placement and scoped virtual-scroller support from MIT
  X.com Masonry View 1.7.7, with bounded mounted items and native fallback.
- Keep the full-width landscape drawer, own-permalink digit badges, native quote
  relationships, stored posts/settings and draggable bookmark circle.
- Add a Masonry On/Off recovery control to the existing expanded panel.
- Add standalone source/bundle browser fixtures for absolute virtual lists,
  synthetic pagination, delayed media, replacement, routing and cleanup.
