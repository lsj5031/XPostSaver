use anyhow::{Context, Result, anyhow};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use url::Url;

const POSTS_DIR: &str = "posts";
const INDEX_CSV: &str = "index.csv";
const PARSE_ERRORS_CSV: &str = "parse-errors.csv";

static TWEET_ID_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)/status/(\d+)").expect("valid tweet id regex"));
static USER_STATUS_PATH_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^/([^/]+)/status/(\d+)").expect("valid user status regex"));
static WEB_STATUS_PATH_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^/i/web/status/(\d+)").expect("valid web status regex"));
static STATUS_PATH_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^/status/(\d+)").expect("valid status regex"));

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Media {
    #[serde(rename = "type")]
    pub media_type: String,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QuotedPost {
    pub url: String,
    pub author: String,
    pub handle: String,
    pub text: String,
    pub date: String,
    pub links: Vec<String>,
    pub media: Vec<Media>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Post {
    pub id: String,
    pub url: String,
    pub author: String,
    pub handle: String,
    pub text: String,
    pub date: String,
    pub saved_at: String,
    pub links: Vec<String>,
    pub media: Vec<Media>,
    pub quoted: Option<QuotedPost>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ParseErrorRow {
    pub line_number: usize,
    pub error_snippet: String,
    pub error_message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedJsonl {
    pub values: Vec<Value>,
    pub parse_errors: Vec<ParseErrorRow>,
    pub total_non_empty_lines: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizationResult {
    pub posts: Vec<Post>,
    pub dropped_invalid: usize,
    pub duplicates_removed: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderOptions {
    pub strict: bool,
    pub include_frontmatter: bool,
    pub prefix: String,
}

impl Default for RenderOptions {
    fn default() -> Self {
        Self {
            strict: false,
            include_frontmatter: true,
            prefix: "post".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunSummary {
    pub total_non_empty_lines: usize,
    pub parsed_objects: usize,
    pub parse_errors: usize,
    pub kept_posts: usize,
    pub dropped_invalid: usize,
    pub duplicates_removed: usize,
    pub output_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
struct IndexRow {
    order: usize,
    id: String,
    url: String,
    handle: String,
    author: String,
    date: String,
    saved_at: String,
    text_chars: usize,
    links_count: usize,
    media_count: usize,
    has_quoted: bool,
    quoted_url: String,
    markdown_path: String,
}

pub fn process_export(
    input_path: &Path,
    out_dir: &Path,
    options: &RenderOptions,
) -> Result<RunSummary> {
    let input = fs::read_to_string(input_path)
        .with_context(|| format!("failed to read input file: {}", input_path.display()))?;

    let parsed = parse_jsonl(&input, options.strict)?;
    let normalized = normalize_saved_posts(&parsed.values);
    write_outputs(out_dir, &normalized.posts, &parsed.parse_errors, options)?;

    Ok(RunSummary {
        total_non_empty_lines: parsed.total_non_empty_lines,
        parsed_objects: parsed.values.len(),
        parse_errors: parsed.parse_errors.len(),
        kept_posts: normalized.posts.len(),
        dropped_invalid: normalized.dropped_invalid,
        duplicates_removed: normalized.duplicates_removed,
        output_dir: out_dir.to_path_buf(),
    })
}

pub fn parse_jsonl(input: &str, strict: bool) -> Result<ParsedJsonl> {
    let mut values = Vec::new();
    let mut parse_errors = Vec::new();
    let mut total_non_empty_lines = 0usize;

    for (idx, raw_line) in input.lines().enumerate() {
        if raw_line.trim().is_empty() {
            continue;
        }

        let line_number = idx + 1;
        total_non_empty_lines += 1;

        match serde_json::from_str::<Value>(raw_line) {
            Ok(value) => values.push(value),
            Err(err) => {
                if strict {
                    return Err(anyhow!(
                        "failed to parse JSONL at line {line_number}: {err}"
                    ));
                }

                parse_errors.push(ParseErrorRow {
                    line_number,
                    error_snippet: truncate_for_csv(raw_line, 180),
                    error_message: err.to_string(),
                });
            }
        }
    }

    Ok(ParsedJsonl {
        values,
        parse_errors,
        total_non_empty_lines,
    })
}

pub fn normalize_saved_posts(values: &[Value]) -> NormalizationResult {
    let mut posts = Vec::new();
    let mut seen = HashSet::new();
    let mut dropped_invalid = 0usize;
    let mut duplicates_removed = 0usize;

    for value in values {
        let Some(post) = sanitize_post(value, "") else {
            dropped_invalid += 1;
            continue;
        };

        let key = get_post_key(&post);
        if key.is_empty() {
            dropped_invalid += 1;
            continue;
        }

        if seen.contains(&key) {
            duplicates_removed += 1;
            continue;
        }

        seen.insert(key);
        posts.push(post);
    }

    NormalizationResult {
        posts,
        dropped_invalid,
        duplicates_removed,
    }
}

pub fn sanitize_post(value: &Value, default_saved_at: &str) -> Option<Post> {
    let obj = value.as_object()?;

    let url = string_field_trimmed(obj, "url");
    if url.is_empty() {
        return None;
    }

    let provided_id = string_field_trimmed(obj, "id");
    let resolved_id = if provided_id.is_empty() {
        tweet_id_from_url(&url).unwrap_or_default()
    } else {
        provided_id
    };

    let saved_at = match obj.get("saved_at") {
        Some(Value::String(s)) => s.clone(),
        _ => default_saved_at.to_string(),
    };

    Some(Post {
        id: resolved_id,
        url,
        author: string_field(obj, "author"),
        handle: string_field(obj, "handle"),
        text: string_field(obj, "text"),
        date: string_field(obj, "date"),
        saved_at,
        links: sanitize_links(obj.get("links")),
        media: sanitize_media(obj.get("media")),
        quoted: sanitize_quoted_post(obj.get("quoted")),
    })
}

pub fn tweet_id_from_url(url: &str) -> Option<String> {
    TWEET_ID_RE
        .captures(url)
        .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()))
}

pub fn canonicalize_status_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let parsed = parse_url_with_base(trimmed)?;
    let path = parsed.path();

    if let Some(caps) = USER_STATUS_PATH_RE.captures(path) {
        return Some(format!(
            "https://x.com/{}/status/{}",
            caps.get(1)?.as_str(),
            caps.get(2)?.as_str()
        ));
    }

    if let Some(caps) = WEB_STATUS_PATH_RE.captures(path) {
        return Some(format!(
            "https://x.com/i/web/status/{}",
            caps.get(1)?.as_str()
        ));
    }

    if let Some(caps) = STATUS_PATH_RE.captures(path) {
        return Some(format!("https://x.com/status/{}", caps.get(1)?.as_str()));
    }

    None
}

pub fn normalize_url_for_compare(url: &str) -> String {
    let canonical = canonicalize_status_url(url);
    let normalized = canonical.unwrap_or_else(|| url.to_string());

    if let Some(mut parsed) = parse_url_with_base(&normalized) {
        parsed.set_fragment(None);
        parsed.set_query(None);
        return parsed.to_string();
    }

    normalized
}

pub fn get_post_key_from_url(url: &str) -> String {
    if let Some(id) = tweet_id_from_url(url) {
        return id;
    }

    let normalized = normalize_url_for_compare(url);
    if !normalized.is_empty() {
        return normalized;
    }

    url.trim().to_string()
}

pub fn get_post_key(post: &Post) -> String {
    let id = post.id.trim();
    if !id.is_empty() {
        return id.to_string();
    }
    get_post_key_from_url(&post.url)
}

pub fn render_markdown(post: &Post, order: usize, include_frontmatter: bool) -> String {
    let mut out = String::new();

    if include_frontmatter {
        out.push_str("---\n");
        out.push_str(&format!("id: {}\n", yaml_quote(&post.id)));
        out.push_str(&format!("url: {}\n", yaml_quote(&post.url)));
        out.push_str(&format!("author: {}\n", yaml_quote(&post.author)));
        out.push_str(&format!("handle: {}\n", yaml_quote(&post.handle)));
        out.push_str(&format!("date: {}\n", yaml_quote(&post.date)));
        out.push_str(&format!("saved_at: {}\n", yaml_quote(&post.saved_at)));
        out.push_str(&format!("links_count: {}\n", post.links.len()));
        out.push_str(&format!("media_count: {}\n", post.media.len()));
        let quoted_url = post.quoted.as_ref().map(|q| q.url.as_str()).unwrap_or("");
        out.push_str(&format!("quoted_url: {}\n", yaml_quote(quoted_url)));
        out.push_str("---\n\n");
    }

    out.push_str(&format!("# Saved X Post {:04}\n\n", order));

    out.push_str("## Text\n");
    out.push_str(&format_block(&post.text));
    out.push('\n');

    out.push_str("## Links\n");
    if post.links.is_empty() {
        out.push_str("- (none)\n\n");
    } else {
        for link in &post.links {
            out.push_str(&format!("- {}\n", link));
        }
        out.push('\n');
    }

    out.push_str("## Media\n");
    if post.media.is_empty() {
        out.push_str("- (none)\n\n");
    } else {
        for media in &post.media {
            let media_type = if media.media_type.trim().is_empty() {
                "media"
            } else {
                media.media_type.as_str()
            };
            out.push_str(&format!("- [{}] {}\n", media_type, media.url));
        }
        out.push('\n');
    }

    if let Some(quoted) = &post.quoted {
        out.push_str("## Quoted Post\n");
        out.push_str(&format!("- URL: {}\n", quoted.url));
        out.push_str(&format!("- Author: {}\n", fallback_text(&quoted.author)));
        out.push_str(&format!("- Handle: {}\n", fallback_text(&quoted.handle)));
        out.push_str(&format!("- Date: {}\n\n", fallback_text(&quoted.date)));

        out.push_str("### Text\n");
        out.push_str(&format_block(&quoted.text));
        out.push('\n');

        out.push_str("### Links\n");
        if quoted.links.is_empty() {
            out.push_str("- (none)\n\n");
        } else {
            for link in &quoted.links {
                out.push_str(&format!("- {}\n", link));
            }
            out.push('\n');
        }

        out.push_str("### Media\n");
        if quoted.media.is_empty() {
            out.push_str("- (none)\n\n");
        } else {
            for media in &quoted.media {
                let media_type = if media.media_type.trim().is_empty() {
                    "media"
                } else {
                    media.media_type.as_str()
                };
                out.push_str(&format!("- [{}] {}\n", media_type, media.url));
            }
            out.push('\n');
        }
    }

    out.push_str("## Source URL\n");
    out.push_str(&format!("{}\n", post.url));

    out
}

fn write_outputs(
    out_dir: &Path,
    posts: &[Post],
    parse_errors: &[ParseErrorRow],
    options: &RenderOptions,
) -> Result<()> {
    fs::create_dir_all(out_dir)
        .with_context(|| format!("failed to create output directory: {}", out_dir.display()))?;

    let posts_dir = out_dir.join(POSTS_DIR);
    if posts_dir.exists() {
        fs::remove_dir_all(&posts_dir)
            .with_context(|| format!("failed to reset posts directory: {}", posts_dir.display()))?;
    }
    fs::create_dir_all(&posts_dir)
        .with_context(|| format!("failed to create posts directory: {}", posts_dir.display()))?;

    let index_path = out_dir.join(INDEX_CSV);
    let mut index_writer = csv::Writer::from_path(&index_path)
        .with_context(|| format!("failed to write {}", index_path.display()))?;

    for (idx, post) in posts.iter().enumerate() {
        let order = idx + 1;
        let fallback = format!("{}-{:04}", options.prefix, order);
        let id_or_fallback = if post.id.trim().is_empty() {
            fallback
        } else {
            post.id.clone()
        };

        let filename = format!(
            "{:04}-{}.md",
            order,
            sanitize_filename_component(&id_or_fallback)
        );
        let relative_path = format!("{POSTS_DIR}/{filename}");
        let file_path = posts_dir.join(&filename);

        let markdown = render_markdown(post, order, options.include_frontmatter);
        fs::write(&file_path, markdown)
            .with_context(|| format!("failed to write {}", file_path.display()))?;

        let row = IndexRow {
            order,
            id: post.id.clone(),
            url: post.url.clone(),
            handle: post.handle.clone(),
            author: post.author.clone(),
            date: post.date.clone(),
            saved_at: post.saved_at.clone(),
            text_chars: post.text.chars().count(),
            links_count: post.links.len(),
            media_count: post.media.len(),
            has_quoted: post.quoted.is_some(),
            quoted_url: post
                .quoted
                .as_ref()
                .map(|quoted| quoted.url.clone())
                .unwrap_or_default(),
            markdown_path: relative_path,
        };
        index_writer
            .serialize(row)
            .with_context(|| format!("failed to write {}", index_path.display()))?;
    }

    index_writer
        .flush()
        .with_context(|| format!("failed to flush {}", index_path.display()))?;

    let parse_errors_path = out_dir.join(PARSE_ERRORS_CSV);
    if parse_errors.is_empty() {
        if parse_errors_path.exists() {
            fs::remove_file(&parse_errors_path).with_context(|| {
                format!(
                    "failed to remove stale parse errors file: {}",
                    parse_errors_path.display()
                )
            })?;
        }
        return Ok(());
    }

    let mut parse_writer = csv::Writer::from_path(&parse_errors_path)
        .with_context(|| format!("failed to write {}", parse_errors_path.display()))?;
    for row in parse_errors {
        parse_writer
            .serialize(row)
            .with_context(|| format!("failed to write {}", parse_errors_path.display()))?;
    }
    parse_writer
        .flush()
        .with_context(|| format!("failed to flush {}", parse_errors_path.display()))?;

    Ok(())
}

fn parse_url_with_base(raw: &str) -> Option<Url> {
    if let Ok(url) = Url::parse(raw) {
        return Some(url);
    }

    let base = Url::parse("https://x.com").ok()?;
    base.join(raw).ok()
}

fn string_field(obj: &serde_json::Map<String, Value>, key: &str) -> String {
    match obj.get(key) {
        Some(Value::String(value)) => value.clone(),
        _ => String::new(),
    }
}

fn string_field_trimmed(obj: &serde_json::Map<String, Value>, key: &str) -> String {
    string_field(obj, key).trim().to_string()
}

fn sanitize_links(value: Option<&Value>) -> Vec<String> {
    let Some(Value::Array(items)) = value else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn sanitize_media(value: Option<&Value>) -> Vec<Media> {
    let Some(Value::Array(items)) = value else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(Value::as_object)
        .filter_map(|item| {
            let media_type = item
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();

            let url = item
                .get("url")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default()
                .to_string();

            if url.is_empty() {
                return None;
            }

            Some(Media { media_type, url })
        })
        .collect()
}

fn sanitize_quoted_post(value: Option<&Value>) -> Option<QuotedPost> {
    let obj = value?.as_object()?;

    let url = string_field_trimmed(obj, "url");
    if url.is_empty() {
        return None;
    }

    Some(QuotedPost {
        url,
        author: string_field(obj, "author"),
        handle: string_field(obj, "handle"),
        text: string_field(obj, "text"),
        date: string_field(obj, "date"),
        links: sanitize_links(obj.get("links")),
        media: sanitize_media(obj.get("media")),
    })
}

fn sanitize_filename_component(raw: &str) -> String {
    let mut out = String::new();
    let mut prev_was_dash = false;

    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
            out.push(ch);
            prev_was_dash = false;
        } else if !prev_was_dash {
            out.push('-');
            prev_was_dash = true;
        }
    }

    let cleaned = out.trim_matches('-');
    if cleaned.is_empty() {
        "item".to_string()
    } else {
        cleaned.to_string()
    }
}

fn truncate_for_csv(value: &str, max_chars: usize) -> String {
    let mut out = String::new();
    let mut count = 0usize;
    for ch in value.chars() {
        if count >= max_chars {
            out.push_str("...");
            break;
        }
        out.push(ch);
        count += 1;
    }
    out
}

fn yaml_quote(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r");
    format!("\"{escaped}\"")
}

fn format_block(value: &str) -> String {
    if value.trim().is_empty() {
        "(empty)\n".to_string()
    } else {
        format!("{}\n", value.trim_end())
    }
}

fn fallback_text(value: &str) -> &str {
    if value.trim().is_empty() {
        "(empty)"
    } else {
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sanitize_post_applies_defaults_and_extracts_id() {
        let input = json!({
            "url": "https://x.com/alice/status/12345",
            "links": ["  https://example.com  ", 42, ""],
            "media": [{"type": "photo", "url": " https://img.example/p.jpg "}, {"url": "  "}],
            "quoted": {
                "url": "https://x.com/bob/status/9",
                "links": [null, " https://q.example "],
                "media": [{"url": "https://img.example/q.jpg", "type": 1}]
            }
        });

        let post = sanitize_post(&input, "2026-01-01T00:00:00.000Z").expect("post should sanitize");
        assert_eq!(post.id, "12345");
        assert_eq!(post.saved_at, "2026-01-01T00:00:00.000Z");
        assert_eq!(post.links, vec!["https://example.com"]);
        assert_eq!(post.media.len(), 1);
        assert_eq!(post.media[0].media_type, "photo");
        assert_eq!(post.media[0].url, "https://img.example/p.jpg");
        assert!(post.quoted.is_some());
        let quoted = post.quoted.expect("quoted should exist");
        assert_eq!(quoted.links, vec!["https://q.example"]);
        assert_eq!(quoted.media[0].media_type, "");
    }

    #[test]
    fn normalize_saved_posts_deduplicates_by_id_or_url_key() {
        let values = vec![
            json!({"id": "1", "url": "https://x.com/a/status/1", "text": "first"}),
            json!({"id": "1", "url": "https://x.com/a/status/1", "text": "duplicate"}),
            json!({"url": "https://x.com/b/status/2", "text": "second"}),
            json!({"url": "https://x.com/b/status/2?foo=bar", "text": "duplicate-2"}),
        ];

        let result = normalize_saved_posts(&values);
        assert_eq!(result.posts.len(), 2);
        assert_eq!(result.duplicates_removed, 2);
        assert_eq!(result.dropped_invalid, 0);
        assert_eq!(result.posts[0].text, "first");
        assert_eq!(result.posts[1].id, "2");
    }

    #[test]
    fn render_markdown_includes_expected_sections() {
        let post = Post {
            id: "42".to_string(),
            url: "https://x.com/alice/status/42".to_string(),
            author: "Alice".to_string(),
            handle: "@alice".to_string(),
            text: "Hello world".to_string(),
            date: "2026-02-01T00:00:00.000Z".to_string(),
            saved_at: "2026-02-02T00:00:00.000Z".to_string(),
            links: vec!["https://example.com".to_string()],
            media: vec![Media {
                media_type: "photo".to_string(),
                url: "https://pbs.twimg.com/media/abc.jpg".to_string(),
            }],
            quoted: Some(QuotedPost {
                url: "https://x.com/bob/status/9".to_string(),
                author: "Bob".to_string(),
                handle: "@bob".to_string(),
                text: "Quoted text".to_string(),
                date: "2026-01-01".to_string(),
                links: vec![],
                media: vec![],
            }),
        };

        let markdown = render_markdown(&post, 1, true);
        assert!(markdown.contains("---"));
        assert!(markdown.contains("## Text"));
        assert!(markdown.contains("## Links"));
        assert!(markdown.contains("## Media"));
        assert!(markdown.contains("## Quoted Post"));
        assert!(markdown.contains("## Source URL"));
    }

    #[test]
    fn parse_jsonl_lenient_and_strict_modes() {
        let input = "{\"url\":\"https://x.com/a/status/1\"}\nnot-json\n{\"url\":\"https://x.com/b/status/2\"}\n";

        let lenient = parse_jsonl(input, false).expect("lenient parse should succeed");
        assert_eq!(lenient.values.len(), 2);
        assert_eq!(lenient.parse_errors.len(), 1);

        let strict = parse_jsonl(input, true);
        assert!(strict.is_err());
    }
}
