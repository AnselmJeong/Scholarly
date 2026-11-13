use crate::reading::{atomic_write, hash, output_path};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Figure {
    pub id: String,
    pub page: usize,
    /// Normalized top-left rectangle in the displayed physical PDF page.
    pub rect: [f32; 4],
    pub heading: String,
    pub caption: String,
    pub source_sha256: String,
    pub image_sha256: String,
    pub image_file: String,
    #[serde(skip)]
    pub aspect_ratio: f32,
}
#[derive(Clone)]
pub(crate) enum Block {
    Text(String),
    Figure(Figure, PathBuf, String),
}
fn manifest(pdf: &Path) -> PathBuf {
    output_path(pdf).with_extension("figures.json")
}
fn assets(pdf: &Path) -> PathBuf {
    output_path(pdf).with_extension("assets")
}
pub(crate) fn load(pdf: &Path) -> Result<Vec<Figure>> {
    let file = manifest(pdf);
    if !file.exists() {
        return Ok(vec![]);
    }
    let entries: Vec<Figure> = serde_json::from_slice(&fs::read(file)?)?;
    let source = hash(fs::read(pdf)?);
    Ok(entries
        .into_iter()
        .filter_map(|mut f| {
            if f.source_sha256 != source || Path::new(&f.image_file).components().count() != 1 {
                return None;
            }
            let bytes = fs::read(assets(pdf).join(&f.image_file)).ok()?;
            if hash(&bytes) != f.image_sha256 {
                return None;
            }
            f.aspect_ratio = png_aspect_ratio(&bytes).unwrap_or(1.);
            Some(f)
        })
        .collect())
}
pub(crate) fn attach(
    pdf: &Path,
    page: usize,
    rect: [f32; 4],
    heading: &str,
    caption: &str,
) -> Result<()> {
    if page == 0
        || rect.iter().any(|v| !v.is_finite() || *v < 0. || *v > 1.)
        || rect[2] < 0.02
        || rect[3] < 0.02
        || rect[0] + rect[2] > 1.001
        || rect[1] + rect[3] > 1.001
    {
        bail!("그림 영역을 다시 선택하세요")
    }
    let source_sha256 = hash(fs::read(pdf)?);
    let id = hash(format!(
        "{source_sha256}:{page}:{rect:?}:{}",
        crate::reading::now()
    ));
    let image_file = format!("{}.png", &id[..16]);
    let directory = assets(pdf);
    fs::create_dir_all(&directory)?;
    let target = directory.join(&image_file);
    let out = Command::new(crate::reading::helper()?)
        .arg("crop")
        .arg(pdf)
        .arg(page.to_string())
        .arg(&target)
        .args(rect.map(|v| v.to_string()))
        .output()?;
    if !out.status.success() {
        bail!(
            "그림을 저장하지 못했습니다: {}",
            String::from_utf8_lossy(&out.stderr)
        )
    }
    if source_sha256 != hash(fs::read(pdf)?) {
        bail!("그림 선택 중 원본이 변경되었습니다")
    }
    let image_sha256 = hash(fs::read(&target)?);
    let mut entries = load(pdf)?;
    entries.push(Figure {
        id,
        page,
        rect,
        heading: heading.into(),
        caption: caption.into(),
        source_sha256,
        image_sha256,
        image_file,
        aspect_ratio: 1.,
    });
    atomic_write(&manifest(pdf), &serde_json::to_vec_pretty(&entries)?, true)
}
pub(crate) fn headings(body: &str) -> Vec<String> {
    body.lines()
        .filter(|l| l.starts_with("# ") || l.starts_with("## ") || l.starts_with("### "))
        .map(str::to_owned)
        .collect()
}
/// PDFKit emits PNGs. Read dimensions off the UI thread before laying out an image.
pub(crate) fn png_aspect_ratio(bytes: &[u8]) -> Option<f32> {
    if bytes.len() < 24 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
    let height = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
    (width > 0 && height > 0).then_some(width as f32 / height as f32)
}
fn figure_number(text: &str) -> Option<u32> {
    static NUMBER: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"(?i)(?:\bfig(?:ure)?s?\.?|그림)\s*(\d+)").unwrap()
    });
    NUMBER.captures(text)?.get(1)?.as_str().parse().ok()
}
fn references_figure(text: &str, number: u32) -> bool {
    static REFERENCES: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"(?i)(?:\bfig(?:ure)?s?\.?|그림)\s*(\d+)(?:\s*[-–]\s*(\d+))?").unwrap()
    });
    REFERENCES.captures_iter(text).any(|reference| {
        let start = reference[1].parse::<u32>().unwrap_or(0);
        let end = reference
            .get(2)
            .and_then(|n| n.as_str().parse().ok())
            .unwrap_or(start);
        (start..=end).contains(&number)
    })
}
/// Match the exact chosen heading. A rewritten heading never silently relocates an image.
pub(crate) fn blocks(body: &str, pdf: &Path) -> Result<Vec<Block>> {
    let mut figures = load(pdf)?;
    if figures.is_empty() {
        return Ok(vec![Block::Text(body.into())]);
    }
    let mut result = Vec::new();
    let mut pending = String::new();
    let mut lines = body.lines().peekable();
    while let Some(line) = lines.next() {
        pending.push_str(line);
        pending.push('\n');
        if figures.iter().any(|f| f.heading == line) {
            let mut section_figures = Vec::new();
            while let Some(index) = figures.iter().position(|f| f.heading == line) {
                section_figures.push(figures.remove(index));
            }
            let mut section = String::new();
            while lines.peek().is_some_and(|l| !l.starts_with('#')) {
                section.push_str(lines.next().unwrap());
                section.push('\n');
            }
            for paragraph in section.split("\n\n") {
                // A heading alone does not establish that its first paragraph explains
                // this figure. Pair only an explicit reference, preserving prose order.
                let matched = section_figures.iter().position(|f| {
                    figure_number(&f.caption).is_some_and(|n| references_figure(paragraph, n))
                });
                if let Some(index) = matched {
                    result.push(Block::Text(std::mem::take(&mut pending)));
                    let f = section_figures.remove(index);
                    let path = assets(pdf).join(&f.image_file);
                    result.push(Block::Figure(f, path, paragraph.trim().into()));
                } else {
                    pending.push_str(paragraph);
                    pending.push_str("\n\n");
                }
            }
            // Without a matching explanation, keep the captioned image separate.
            for f in section_figures {
                result.push(Block::Text(std::mem::take(&mut pending)));
                let path = assets(pdf).join(&f.image_file);
                result.push(Block::Figure(f, path, String::new()));
            }
        }
    }
    if !pending.trim().is_empty() {
        result.push(Block::Text(pending));
    }
    if !figures.is_empty() {
        result.push(Block::Text("## 보관한 원문 그림\n\n이전 절 제목이 바뀌었거나 같은 절에 그림이 여러 개 있습니다. 연결 위치를 확인하세요.\n".into()));
    }
    for f in figures {
        let path = assets(pdf).join(&f.image_file);
        result.push(Block::Figure(f, path, String::new()));
    }
    Ok(result)
}
pub(crate) fn remove_last(pdf: &Path) -> Result<()> {
    let mut entries: Vec<Figure> =
        serde_json::from_slice(&fs::read(manifest(pdf)).context("보관된 그림이 없습니다")?)?;
    entries.pop();
    atomic_write(&manifest(pdf), &serde_json::to_vec_pretty(&entries)?, true)
}
