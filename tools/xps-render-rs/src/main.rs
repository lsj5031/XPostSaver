use anyhow::Result;
use clap::Parser;
use std::path::PathBuf;
use xps_render::{RenderOptions, process_export};

#[derive(Debug, Parser)]
#[command(
    name = "xps-render",
    version,
    about = "Render X Post Saver JSONL exports into Markdown dossiers"
)]
struct Cli {
    #[arg(long = "in", value_name = "FILE")]
    input: PathBuf,

    #[arg(long, value_name = "DIR")]
    out: PathBuf,

    #[arg(long)]
    strict: bool,

    #[arg(long = "no-frontmatter")]
    no_frontmatter: bool,

    #[arg(long, default_value = "post")]
    prefix: String,
}

fn run() -> Result<()> {
    let cli = Cli::parse();

    let options = RenderOptions {
        strict: cli.strict,
        include_frontmatter: !cli.no_frontmatter,
        prefix: cli.prefix,
    };

    let summary = process_export(&cli.input, &cli.out, &options)?;

    println!("Input: {}", cli.input.display());
    println!("Output directory: {}", summary.output_dir.display());
    println!("Non-empty lines: {}", summary.total_non_empty_lines);
    println!("Parsed objects: {}", summary.parsed_objects);
    println!("Parse errors: {}", summary.parse_errors);
    println!("Kept posts: {}", summary.kept_posts);
    println!("Dropped invalid objects: {}", summary.dropped_invalid);
    println!("Duplicates removed: {}", summary.duplicates_removed);

    Ok(())
}

fn main() {
    if let Err(err) = run() {
        eprintln!("Error: {err:#}");
        std::process::exit(1);
    }
}
