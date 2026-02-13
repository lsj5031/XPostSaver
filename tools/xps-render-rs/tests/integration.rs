use std::fs;
use std::path::{Path, PathBuf};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use tempfile::tempdir;
use xps_render::{RenderOptions, process_export};

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(name)
}

fn read_csv_rows<T: DeserializeOwned>(path: &Path) -> Vec<T> {
    let mut reader = csv::Reader::from_path(path).expect("csv file should exist");
    reader
        .deserialize()
        .map(|row| row.expect("csv row should deserialize"))
        .collect()
}

#[derive(Debug, Deserialize)]
struct IndexRow {
    order: usize,
    id: String,
    has_quoted: bool,
    quoted_url: String,
    markdown_path: String,
}

#[derive(Debug, Deserialize)]
struct ParseErrorRow {
    line_number: usize,
    error_snippet: String,
    error_message: String,
}

#[test]
fn fixture_jsonl_generates_expected_outputs() {
    let tmp = tempdir().expect("tempdir should be created");
    let input = fixture_path("sample.jsonl");

    let options = RenderOptions::default();
    let summary = process_export(&input, tmp.path(), &options).expect("processing should succeed");

    assert_eq!(summary.total_non_empty_lines, 12);
    assert_eq!(summary.parsed_objects, 11);
    assert_eq!(summary.parse_errors, 1);
    assert_eq!(summary.kept_posts, 11);
    assert_eq!(summary.duplicates_removed, 0);

    let posts_dir = tmp.path().join("posts");
    let mut files = fs::read_dir(&posts_dir)
        .expect("posts directory should exist")
        .map(|entry| {
            entry
                .expect("entry should be valid")
                .file_name()
                .to_string_lossy()
                .to_string()
        })
        .collect::<Vec<_>>();
    files.sort();

    assert_eq!(files.len(), summary.kept_posts);
    assert_eq!(files[0], "0001-2021282023537819957.md");
    assert_eq!(files[10], "0011-2022092372855980459.md");

    let index_rows: Vec<IndexRow> = read_csv_rows(&tmp.path().join("index.csv"));
    assert_eq!(index_rows.len(), summary.kept_posts);
    assert_eq!(index_rows[0].order, 1);
    assert_eq!(index_rows[0].id, "2021282023537819957");
    assert_eq!(
        index_rows[0].markdown_path,
        "posts/0001-2021282023537819957.md"
    );

    let quoted_row = index_rows
        .iter()
        .find(|row| row.has_quoted)
        .expect("fixture should include one quoted post");
    assert_eq!(quoted_row.order, 10);
    assert_eq!(
        quoted_row.quoted_url,
        "https://x.com/sudo_goreng/status/2022185585717428382"
    );

    let markdown =
        fs::read_to_string(posts_dir.join("0010-2022191773624500454.md"))
            .expect("quoted markdown should exist");
    assert!(markdown.contains("## Quoted Post"));
    assert!(markdown.contains("quoted_url: \"https://x.com/sudo_goreng/status/2022185585717428382\""));

    let parse_rows: Vec<ParseErrorRow> = read_csv_rows(&tmp.path().join("parse-errors.csv"));
    assert_eq!(parse_rows.len(), 1);
    assert_eq!(parse_rows[0].line_number, 12);
    assert!(parse_rows[0].error_snippet.contains("not-json-line"));
    assert!(!parse_rows[0].error_message.is_empty());
}

#[test]
fn strict_mode_fails_on_malformed_jsonl_line() {
    let tmp = tempdir().expect("tempdir should be created");
    let input = fixture_path("sample.jsonl");

    let options = RenderOptions {
        strict: true,
        include_frontmatter: true,
        prefix: "post".to_string(),
    };

    let err = process_export(&input, tmp.path(), &options).expect_err("strict mode should fail");
    let message = format!("{err:#}");
    assert!(message.contains("line 12"));
}
