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
- Data is stored locally in browser storage.

## License

Provided as-is for personal use.
