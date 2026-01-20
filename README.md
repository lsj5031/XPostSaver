# X Post Saver (Enhanced)

A powerful userscript that adds a "Save" button to posts on X.com (formerly Twitter), enabling you to save posts locally and export them as JSONL (NDJSON) format.

## Demo

[Watch the demo video](demo.mp4) to see X Post Saver in action.

## Features

- **One-Click Saving**: Add a "Save" button to every post on X.com
- **Local Storage**: All saved posts are stored locally in your browser using localStorage
- **Rich Data Extraction**: Captures:
  - Post URL, author, handle, text, and date
  - External links shared in the post
  - Media (photos and videos) with original-quality image URLs
  - Quoted tweets (with full extraction of the quoted post's data)
- **Export Options**:
  - Download as JSONL file (timestamped filename)
  - Copy to clipboard for easy pasting
- **Persistent Storage**: Uses localStorage with quota-aware error handling
- **Smart UI**: 
  - Floating panel at bottom-right with Export, Copy, and Clear buttons
  - Save button state indicators (Save/Saved)
  - Toast notifications for user feedback
  - "Show more" expansion to capture full tweet text

## Installation

### Prerequisites

1. Install a userscript manager:
   - [Tampermonkey](https://www.tampermonkey.net/) (recommended)
   - [Greasemonkey](https://www.greasespot.net/)
   - [Violentmonkey](https://violentmonkey.github.io/)

### Install the Script

1. Download `x-post-saver-enhanced.user.js`
2. Open your userscript manager
3. Create a new script and paste the contents, or
4. Simply open the `.user.js` file in your browser and the userscript manager will prompt to install it

## Usage

### Saving Posts

1. Navigate to any post on X.com
2. Click the "Save" button in the post's action bar (next to Reply, Retweet, etc.)
3. The button will change to "Saved" and a toast notification will confirm
4. To unsave, click the "Saved" button again

### Exporting Saved Posts

The floating panel (bottom-right corner) provides three options:

- **Export (N)**: Downloads all saved posts as a JSONL file named `x-saved-posts-YYYY-MM-DD.jsonl`
- **Copy**: Copies all saved posts as JSONL to your clipboard
- **Clear**: Removes all saved posts (with confirmation dialog)

## Data Format

Saved posts are stored in JSONL (JSON Lines) format, with one JSON object per line:

```json
{"url":"https://x.com/user/status/123456789","author":"User Name","handle":"@username","text":"Post text here","date":"2026-01-20T12:00:00.000Z","saved_at":"2026-01-20T12:30:00.000Z","links":["https://example.com"],"media":[{"type":"photo","url":"https://pbs.twimg.com/media/..."}],"quoted":{...}}
```

### Fields

- `url`: Canonical post URL
- `author`: Display name of the author
- `handle`: Username (including @)
- `text`: Full post text (with "Show more" expanded)
- `date`: ISO 8601 timestamp from the post
- `saved_at`: ISO 8601 timestamp when you saved it
- `links`: Array of external URLs (excludes X.com/Twitter links)
- `media`: Array of media objects with `type` (photo/video/video_poster/thumb) and `url`
- `quoted`: Object containing full data of a quoted tweet (if present)

## Technical Details

### URL Canonicalization

The script normalizes various X.com URL formats:
- `https://x.com/username/status/123`
- `https://x.com/i/web/status/123`
- `https://x.com/status/123`
- URLs with query parameters, fragments, etc.

All are converted to the canonical format: `https://x.com/username/status/123`

### Media Quality

Image URLs are automatically enhanced to fetch original quality:
- Changes `?name=medium` to `?name=orig`
- Ensures highest resolution for photos and thumbnails

### Browser Compatibility

- Works on modern browsers with userscript manager support
- Requires localStorage access
- Uses ES6+ features (async/await, arrow functions, etc.)

### Storage

- Data is stored in `localStorage` under key `xSavedPosts`
- No external servers or API calls
- All data remains on your device
- Graceful handling of quota exceeded errors

## Version History

- **0.3.4**: Enhanced quote tweet detection, URL canonicalization
- **0.3.x**: Added support for links, media, and quoted tweet extraction
- Earlier versions: Initial functionality

## License

This userscript is provided as-is for personal use.

## Contributing

Feel free to submit issues, fork the repository, and create pull requests for any improvements.
