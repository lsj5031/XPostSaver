# X Post Saver (Enhanced)

X Post Saver is a userscript for saving posts on X.com locally, plus a Rust CLI that turns exported JSONL into Markdown dossiers and CSV indexes.

## Demo

[Watch the demo video](demo.mp4)

## Repository Components

- `x-post-saver-enhanced.user.js`: production userscript you install in Tampermonkey/Violentmonkey/Greasemonkey.
- `src/`: userscript source code.
- `tools/xps-render-rs`: standalone Rust CLI (`xps-render`) for postprocessing exported JSONL.

## Userscript Features

### Save and Manage Posts on X

- Injects a `Save`/`Saved` button into each post action bar.
- Supports save and unsave in place.
- Uses post-key dedupe (post `id` first, URL normalization fallback) to prevent duplicates.
- Scans dynamic timeline updates with `MutationObserver` and incremental rescans.
- Use userscript-owned unmodified **j/k** navigation (next/previous) to focus a post, then **w** to open it in a new background tab (**x** remains X’s native Block action), **v** to toggle Save/Saved, or **c** to run 核查, which **automatically sends the post’s fact-check prompt to Grok Auto**. Save and fact-check use the existing enabled buttons, including the longform top bar. Focus must be on the post, a descendant, or its single-post timeline cell; hovering alone does not select a post. Editors, unrelated dialogs, repeated/composing keys, extra modifier keys, and absent/disabled action buttons are ignored. All three shortcuts require no modifiers. Native **x**, Enter, and Shift+Enter pass through to X. **Space** smoothly scrolls down one viewport even after clicking a button; **Shift+Space** scrolls up. Holding Space does not restart the animation. Typing fields, dialogs, and media controls keep their normal Space behavior, and reduced-motion preferences are respected.
- **j/k** move from the actually focused post only while it intersects the usable timeline viewport. After manual scrolling or Space leaves focus offscreen, **j** anchors to the first visible post and **k** to the last, rather than jumping back to a stale selection. Tall intersecting posts count as visible; nested quotes/read views are not separate targets. Navigation uses the primary timeline when identifiable, accounts for its sticky header, focuses the real article without incidental scrolling, and reveals an offscreen next/previous target deliberately. Held repeats are consumed without traversal; boundaries with visible posts are consumed to prevent native stale-selection jumps. With no visible actionable posts, the key passes through. Editors, dialogs, media controls, modifiers (including Shift), and composition keep native behavior. This is a viewport-aware userscript policy, not a claim about X internals: [X documents j/k as next/previous](https://help.x.com/en/using-x/how-to-post), without promising viewport reanchoring.
- Background opening requires your userscript manager’s `GM_openInTab` API and grant. Missing permissions or opening failures show an error, with no focus-stealing `window.open` fallback. Shortcuts are covered by DOM fixtures and bundle tests, not verified against live X; tests use the local fallback when Grok is absent and do not send network requests.

### Per-post Grok Auto Fact-check (v0.5.1)

Firefox paste compatibility was fixed in v0.5.4: Firefox ignores the synthetic paste constructor’s `clipboardData` option, so the script supplies the populated data on that event when needed. This uses one paste event and does not access the system clipboard. Verified with local Firefox and Chromium composer fixtures; live X integration remains unverified.

- Click **核查** beside Save, including the top action bar of a longform article, to **automatically send that selected post to Grok in Auto mode**. This is a manual action per post; no background checks run.
- Uses the currently loaded post text, source URL, and one level of quoted context to prepare a Chinese fact-check prompt. It does not expand Show more, fetch missing threads/media, or save/unsave the post.
- Opens X's native **Grok** navigation in the same tab, fills an empty composer, selects and verifies **Auto**, and finds the nearest ancestor containing exactly one editor, mode button, and Send button, and clicks its unique visible, enabled native **Send** button once. It rechecks cancellation, navigation, the composer, exact prompt, mode, and Send control immediately before clicking. There is no retry, queue, xAI API, or private endpoint access.
- Requires a logged-in X account with access to Grok. Before-send failures (native UI changes, unavailable navigation, a nonempty draft, mode verification failure, or timeout) stop submission and leave a visible prompt with **复制提示词**. Existing Grok drafts are never replaced or sent. The explicit copy button can change the clipboard; clipboard failure leaves the prompt selected for ⌘C / Ctrl+C. Check the current conversation and draft before any manual fallback.
- Cancel/close or Escape stops work before Send; after the click it cannot undo submission. An inserted draft is left intact when work stops. Multiline text is inserted with a single native DataTransfer paste event, without reading or changing the system clipboard. Composer detection is bounded to 8 seconds, with up to 2 seconds each for paste verification, composer control detection, mode button availability, Auto menu/selection verification, and Send availability.
- Success requires a cleared composer and a newly visible copy of the exact prompt in native conversation content within 8 seconds after the click. Missing acknowledgement, navigation, cancellation, or an error after the click reports **uncertain send outcome**, never retries, and asks you to check Grok without resending. A send attempt blocks another check of that post for the current page session, including when its result is uncertain. This is a UI acknowledgement, not proof that Grok completed a response; no results are archived.
- Open **核查设置** in the floating panel to edit the prompt template, **恢复默认** to restore the Chinese default, then **保存设置**. {url}, {text}, and {quoted} insert the corresponding data; omitted fields are appended so source context is retained. Settings use the separate local key xpsFactCheckTemplate.
- The default asks for Chinese explanations, important factual claims, original evidence with source links, supported/refuted/unconfirmed conclusions, and explicit reading limitations. Post and quote content are treated as source material, not instructions.

### Rich Extraction

For each saved post, extracts:

- `id`, `url`, `author`, `handle`, `text`, `date`, `saved_at`
- External links (`links`) with X/Twitter domains excluded
- Media (`media`) including:
  - photos (normalized to original-size image URLs when possible)
  - video poster/thumb URLs
  - direct video source URLs (excluding blob URLs)
- Quoted post (`quoted`) as one nested level with its own fields (`url/author/handle/text/date/links/media`)

Extraction behavior details:

- Expands `Show more` when present to capture full text.
- Supports longform article layouts (`twitterArticleRichTextView` / longform components).
- Canonicalizes status URLs (`/user/status/:id`, `/i/web/status/:id`, `/status/:id`) for stable comparison.

### Storage and Sync

- Primary storage key: `xSavedPosts`.
- Uses userscript storage APIs (`GM_getValue`/`GM_setValue`) when available.
- Falls back to `localStorage` if GM APIs are unavailable.
- Migrates legacy `localStorage` data to GM storage when possible.
- Cross-tab refresh signal key: `xpsSync`.
- Soft limit/warnings:
  - warning toast at `1800` saved posts
  - save blocked at `2000` saved posts

### Export and UI

- Floating panel starts as a small bookmark circle on every page load. Click it
  (or focus it and press Enter/Space) to expand; the **−** button collapses it
  and keeps focus on the toggle. Hidden controls are not in the tab order.
  Drag the circle without opening it, or drag the expanded grip, to save the
  panel position across page loads. Arrow keys move either focused handle.
  Small click jitter still opens the circle; dragging does not.
  Expansion and viewport resizing keep it onscreen, including narrow layouts.
  Saved posts and fact-check settings are unchanged by opening/closing the panel.
- Expanded controls:
  - `Export (N)`: downloads `x-saved-posts-YYYY-MM-DD.jsonl`
  - `Copy`: copies JSONL to clipboard
  - `Export URLs` / `Copy URLs`: exports or copies saved post URLs
  - `Clear`: clears all saved posts after confirmation
  - `核查设置`: edits the fact-check prompt template
- Toast notifications for success/error states.

### Standalone masonry and compact navigation (v0.5.13)

Install **ONE script, X Post Saver**. Masonry is built in and **on by default**.
Remove the separate X.com Masonry View script; reinstalling it is not required.
The expanded bookmark panel has a **Masonry: On/Off** recovery control. Its
separate `xpsMasonryEnabled` setting does not replace saved posts or settings.
Newly placed posts choose the shortest column, with approximately 320px minimum
widths. Once placed, a post keeps its column for the current feed and column
count. Delayed image/quote growth moves downstream cards **within that column**,
without repacking existing posts across columns or fixing/clipping their heights.
Insertion, reorder and virtualized DOM replacement use own-post identities, not
recycled indexes. Changing the number of columns or the feed route legitimately
starts a new placement. Below 700px and on status/detail pages, layout is native.

The relevant layout/scroller logic is adapted from MIT X.com Masonry View 1.7.7,
not its network blocking, feed GC, global scheduling or media-resource hacks.
See [third-party notice](THIRD_PARTY_NOTICES.md). No remote runtime code is loaded.
The `unsafeWindow` grant accesses only the active timeline's React-scroller
capabilities through the userscript manager, without inline CSP injection.
Instance hooks are restored on route/disable/container replacement. Unsupported
absolute virtualizers remain native instead of freezing their navigation.
Rendering is windowed to at most 120 virtual items. Native candidate positions,
rendered slices and feed height share the same synthetic layout. Unmeasured
offscreen items are predictions until placed; replacing estimates can shift
vertical positions, but not committed column assignments. Measurement history
is capped at 2000 identities; small column records are retained only for the
current native loaded list and pruned on removal, never for historical DOM.
Ambiguous/missing native identities or an extreme layout that cannot cover all
visible cards in one bounded native window fall back to native rendering.
Native quotes are neither moved nor reconstructed.

When a connected masonry timeline is active, landscape windows
at least 1000px wide give the **entire available width to the feed**, with zero
sidebar reservation. A floating **☰** button (44px target, no letter shortcut)
opens the original navigation in a 280px scrollable overlay without moving the
feed. Click, Enter, or Space opens it and focuses its first native link. The
closed drawer is hidden and inert, with no hidden keyboard stops. Original links,
unread badges, compose, account, and More controls remain intact. Escape closes
the drawer and returns focus to the toggle; clicking outside closes it without
stealing focus from another control. Native menus keep their interaction and
first Escape. Width caps and margins on the feed's nested wrappers are removed;
the built-in engine owns masonry placement and responsive column counts.

Without active masonry, in portrait/narrow windows, or after timeline/header
replacement, native navigation is restored or re-detected automatically. Both
external-script load orders are supported cheaply when its engine is already
active, without a second layout/scroller hook. Saved posts, settings, and the draggable
bookmark panel are unaffected. Verified with offline native-shaped DOM/layout
fixtures, **not a live logged-in X account**; future X/upstream DOM changes may
require compatibility updates.

### Masonry single-key background opening (v0.5.14)

While a real primary masonry timeline is active, up to fifteen visible, exposed
posts receive digit-first badges **1 2 3 4 5 6 7 8 9 0 d e q y z**. Initial
assignment follows top-to-bottom, then left-to-right order. Visible surviving
posts keep their keys and badge nodes as counters, media and layout change;
newly exposed posts take free keys, without reshuffling existing labels. Extra
cards stay unlabelled when the pool is exhausted. Press the displayed key once
to open that post's own permalink in a **new background tab**, without moving
feed focus or scroll. No activation mode, sequence or Enter is needed.

Positions reconcile in animation frames, without clearing the whole layer or
waiting for a debounce. Scroll/reflow moves badges with their cards; removed,
recycled, covered and route-invalid mappings are discarded before the next
paint. Keypress independently checks the selected card's current own URL and
exposure, even before a pending reconciliation. Quotes, recommendations,
status detail pages, open drawers and visible dialogs/menus get no active hints.

The added lowercase pool is **d/e/q/y/z**, not every unused alphabet position.
The offline source/reference audit reserves **a/g** (native audio/navigation
prefixes), **b/x** (both reported Block bindings), **n/l/r/t/m/u/o** (native
post actions), **f** (media), **j/k** (navigation), **w/v/c** (existing XPostSaver
actions), and **h/i/p/s** (navigation destinations, conservatively reserved).
`d` is an audio-dock destination only after `a`; both **g** and **a**, and their
next character within 1.5 seconds, pass through without opening a badge.
Typing, select/range, focused media, menus, modifiers, IME and held repeats
remain guarded. Space, punctuation, native Enter and existing shortcuts are
unchanged. No added single-letter action for d/e/q/y/z was identified in the
available references, but those cached third-party lists are not authoritative
and live X bindings can vary. **Current authenticated X shortcut UI/source was
not accessible offline**, so this is a conservative compatibility policy, not a
claim of live verification. Check X's `?` menu when reviewing a live release.

Existing `GM_openInTab` permission,
options (`active: false`, `insert: true`, `setParent: true`), and error feedback
are reused, without `click()` or a foreground-tab fallback. Missing/failed APIs
show an error; promise-returning APIs are not treated as synchronous acceptance
for cancelling the digit event. Background behavior ultimately depends on the
userscript manager. These safeguards are fixture-tested, not an exhaustive
verification of live X's shortcut implementation.

Quote presentation is left to X's native content. Content
shown as two visually linked cards stays in two cards; this integration does
not restore, merge, move, or restyle quotes. Own-post keyboard targets exclude
native inline quote timestamps as well as nested quote articles. If only a
quoted permalink is available, the enclosing post receives no digit badge
rather than opening that quoted target.

## Rust CLI (`xps-render`) Features

`xps-render` ingests exported JSONL and renders per-post Markdown plus indexes.

### Input Processing

- Reads JSONL line-by-line.
- Modes:
  - default (lenient): skip malformed lines and record them in `parse-errors.csv`
  - `--strict`: fail on first malformed line
- Normalizes/sanitizes fields similarly to userscript logic:
  - trims URLs
  - normalizes links/media arrays
  - resolves `id` from URL when missing
  - removes invalid objects
- Deduplicates using `id` first, then canonicalized URL key.

### Output

Given `--out <dir>`, writes:

- `<dir>/posts/<NNNN>-<id-or-fallback>.md`
- `<dir>/index.csv`
- `<dir>/parse-errors.csv` (only when parse errors exist)

Rendering details:

- Preserves input/save order.
- Markdown includes sections:
  - `Text`
  - `Links`
  - `Media`
  - `Quoted Post` (when present)
  - `Source URL`
- YAML front matter is included by default and can be disabled with `--no-frontmatter`.
- If `<dir>/posts` already exists, it is replaced for a clean render.

## Installation

Current userscript release: **0.5.14**. See [changelog](CHANGELOG.md).

### Userscript

1. Install a userscript manager:
   - [Tampermonkey](https://www.tampermonkey.net/) (recommended)
   - [Violentmonkey](https://violentmonkey.github.io/)
   - [Greasemonkey](https://www.greasespot.net/)
2. Install `x-post-saver-enhanced.user.js` in your userscript manager.
   This is the only userscript needed, including masonry. Remove the former
   separate masonry script if installed.

### Rust CLI

Prerequisite: Rust toolchain with `cargo` installed.

## Usage

### Userscript

1. Open X.com.
2. Click `Save` on posts you want to keep.
3. Click the floating bookmark circle to expand the panel (drag it to move without opening):
   - `Export` to JSONL
   - `Copy` to clipboard
   - `Clear` to remove all saves

### Rust CLI

```bash
cargo run --manifest-path tools/xps-render-rs/Cargo.toml -- \
  --in ./x-saved-posts-2026-02-13.jsonl \
  --out ./rendered
```

Options:

- `--strict`: fail-fast on malformed JSONL
- `--no-frontmatter`: omit YAML front matter in markdown files
- `--prefix <value>`: fallback filename prefix when `id` is missing (default: `post`)

## JSONL Format

Each line is one JSON object.

Example:

```json
{"id":"123456789","url":"https://x.com/user/status/123456789","author":"User Name","handle":"@username","text":"Post text","date":"2026-01-20T12:00:00.000Z","saved_at":"2026-01-20T12:30:00.000Z","links":["https://example.com"],"media":[{"type":"photo","url":"https://pbs.twimg.com/media/..."}],"quoted":null}
```

Top-level fields:

- `id`: status ID (string; may be empty if not derivable)
- `url`: canonical post URL
- `author`: display name
- `handle`: username with `@`
- `text`: extracted post text
- `date`: post datetime from X
- `saved_at`: timestamp when saved locally
- `links`: external links array
- `media`: array of `{ type, url }`
- `quoted`: nested quoted post object or `null`

## Development

### Userscript

- Install JavaScript development dependencies:

```bash
npm ci
```

- Build bundled userscript:

```bash
npm run build
```

- Verify the checked-in bundle matches the source:

```bash
npm run build:check
```

- The build also (re)generates `src/main.css` by subsetting the Ioskeley
  Mono faces (see `scripts/gen-fonts.js`), which requires `pyftsubset`
  (fonttools). If it is not on `PATH`, create a virtualenv and install it:

```bash
python3 -m venv .fonttools-venv
./.fonttools-venv/bin/pip install fonttools brotli
```

- Run JS tests:

```bash
npm test
```

- Optional real Chromium shortcut fixture (no live X access or external requests):

```bash
XPS_PLAYWRIGHT="/absolute/path/to/playwright-core/index.js" \
XPS_CHROMIUM="/absolute/path/to/chromium" \
node scripts/check-navigation-browser.js
```

  Requires `XPS_PLAYWRIGHT` (absolute module path) and `XPS_CHROMIUM` (absolute
  executable path) for locally installed tools; no dependencies are added.
  Replace the placeholders above with your local paths. `XPS_EVIDENCE` sets the output directory
  (default `/tmp/xps-jk-evidence`) for ordered screenshots, trace, and measurements.
  Its stale native-navigation handler is an explicit simulation, not verified X internals.

- Optional offline Chromium panel fixture, using the same local tool environment:

```bash
XPS_PLAYWRIGHT="/absolute/path/to/playwright-core/index.js" \
XPS_CHROMIUM="/absolute/path/to/chromium" \
node scripts/check-panel-browser.js
```

  Tests source and bundle on desktop/narrow viewports, native Enter/Space toggle,
  copy/count, drag/reload, stored edge positions and resize clamping.
  `XPS_EVIDENCE` defaults to `/tmp/xps-circle-evidence` for ordered screenshots,
  a side-by-side preview and measurements. All network requests are blocked.

- Standalone offline Chromium acceptance gate, using those same local tools:

```bash
node scripts/check-standalone-masonry-browser.js
```

  Injects only source or the shipped XPostSaver bundle into a native one-column,
  absolute/transformed synthetic virtual list. No external script, CSS or
  `.xopt` class is supplied. Measures unequal-height columns, full width at
  1000/1440/1920/2560, intact nested quotes, non-overlap, real digit key background
  calls, native drawer controls, delayed media, item/container replacement,
  synthetic load-more, bounded rendered DOM, detail/back and toggle restoration,
  delayed mount and unsupported-scroller fallback. Evidence is written to
  `XPS_EVIDENCE` (default `/tmp/xps-standalone-evidence`).
  This does **not** validate live X pagination or a real userscript sandbox.

- Optional external-layout compatibility/navigation fixture, using those same local
  tool environment variables:

```bash
node scripts/check-masonry-browser.js
```

  Tests source and shipped bundle, both script load orders, late upstream CSS,
  nested fixed-width navigation/feed wrappers, original controls/menus, inert
  keyboard traversal, drawer toggling, viewport restoration, and SPA replacement.
  Also verifies digit badges/background calls, key exhaustion, guards,
  scrolling, occlusion, recycled cards/URLs, and stale-key/layout/route safety.
  `XPS_EVIDENCE` defaults to `/tmp/xps-masonry-sidebar-evidence`; its `v2/`
  directory contains before/full-feed/drawer/portrait/badge screenshots and
  `masonry-measurements.json` with widths and simulated tab calls.
  The fixture models upstream 1.7.7 layout rules; it never executes upstream
  network/React patches or uses a live account. At widths 1000, 1280, 1440,
  1920, and 2560 it verifies zero navigation reservation and full-width feed/
  masonry containers, with no horizontal overflow or column-count changes.

- Optional whole-upstream quote compatibility gate, using the same local browser
  variables and an independently supplied local upstream userscript:

```bash
XPS_MASONRY_UPSTREAM="/absolute/path/to/masonry.user.js" \
node scripts/check-masonry-quotes-browser.js
```

  Runs the complete external script unchanged in fresh, network-blocked offline
  contexts, with source/bundle and both load orders. Tests inline and nested
  quotes, media/delayed height changes, original linked-card node preservation,
  no clipping/overlap, outer action-bar ownership, quote link reachability and
  own-post digit targets. Evidence is under `XPS_EVIDENCE/v3-quotes/final/`.
  The linked-card fixture is synthetic, not a captured live-X representation;
  no React-derived quote navigation, video decoding, or live account is tested.

### Rust CLI

- Run Rust tests:

```bash
cargo test --manifest-path tools/xps-render-rs/Cargo.toml
```

## Privacy

- No external API calls are required for saving/exporting posts.
- Saved posts and prompt settings are stored locally in browser storage.
- Clicking 核查 authorizes automatically sending the selected post’s fact-check prompt through X’s native Grok UI in Auto mode. X/Grok processes it under your account and its policies. Automatic handoff does not access the system clipboard or any API; the fallback copy button changes the clipboard only when clicked.

## License

Provided as-is for personal use.
