# Changelog

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
