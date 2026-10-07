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

### Per-post Grok Auto Fact-check (v0.5.1)

- Click **核查** beside Save, including the top action bar of a longform article, to **automatically send that selected post to Grok in Auto mode**. This is a manual action per post; no background checks run.
- Uses the currently loaded post text, source URL, and one level of quoted context to prepare a Chinese fact-check prompt. It does not expand Show more, fetch missing threads/media, or save/unsave the post.
- Opens X's native **Grok** navigation in the same tab, fills an empty composer, selects and verifies **Auto**, and clicks the unique visible, enabled native **Send** button once. It rechecks cancellation, navigation, the composer, exact prompt, mode, and Send control immediately before clicking. There is no retry, queue, xAI API, or private endpoint access.
- Requires a logged-in X account with access to Grok. Before-send failures (native UI changes, unavailable navigation, a nonempty draft, mode verification failure, or timeout) stop submission and leave a visible prompt with **复制提示词**. Existing Grok drafts are never replaced or sent. The explicit copy button can change the clipboard; clipboard failure leaves the prompt selected for ⌘C / Ctrl+C. Check the current conversation and draft before any manual fallback.
- Cancel/close or Escape stops work before Send; after the click it cannot undo submission. An inserted draft is left intact when work stops. Multiline text is inserted with a single native DataTransfer paste event, without reading or changing the system clipboard. Composer detection is bounded to 8 seconds, with up to 2 seconds each for paste verification, Auto menu/selection verification, and Send availability.
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

- Floating panel with:
  - `Export (N)`: downloads `x-saved-posts-YYYY-MM-DD.jsonl`
  - `Copy`: copies JSONL to clipboard
  - `Clear`: clears all saved posts after confirmation
- Toast notifications for success/error states.

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

### Userscript

1. Install a userscript manager:
   - [Tampermonkey](https://www.tampermonkey.net/) (recommended)
   - [Violentmonkey](https://violentmonkey.github.io/)
   - [Greasemonkey](https://www.greasespot.net/)
2. Install `x-post-saver-enhanced.user.js` in your userscript manager.

### Rust CLI

Prerequisite: Rust toolchain with `cargo` installed.

## Usage

### Userscript

1. Open X.com.
2. Click `Save` on posts you want to keep.
3. Use floating panel:
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
