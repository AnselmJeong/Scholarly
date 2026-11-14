//! Source-numbered visuals are cached by PDF content, never by a generated heading.
use crate::reading::{atomic_write, hash, helper};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct Visual {
    pub label: String,
    pub kind: String,
    pub number: String,
    pub page: usize,
    pub caption: String,
    pub rect: [f32; 4],
    pub cropped: bool,
}
#[derive(Clone)]
pub(crate) struct Asset {
    pub visual: Visual,
    pub path: PathBuf,
}
#[derive(Serialize, Deserialize)]
struct Saved {
    visual: Visual,
    file: String,
    sha256: String,
}

pub(crate) fn extract(pdf: &Path, home: &Path) -> Result<Vec<Asset>> {
    let source_hash = hash(fs::read(pdf)?);
    let directory = home.join("source-visuals-v3").join(&source_hash);
    let manifest = directory.join("manifest.json");
    if let Ok(data) = fs::read(&manifest)
        && let Ok(saved) = serde_json::from_slice::<Vec<Saved>>(&data)
        && saved.iter().all(|s| {
            Path::new(&s.file).components().count() == 1
                && fs::read(directory.join(&s.file)).is_ok_and(|b| hash(b) == s.sha256)
        })
    {
        return Ok(saved
            .into_iter()
            .map(|s| Asset {
                visual: s.visual,
                path: directory.join(s.file),
            })
            .collect());
    }
    let output = Command::new(helper()?).arg("visuals").arg(pdf).output()?;
    if !output.status.success() {
        bail!(
            "원문 그림·표를 읽지 못했습니다: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let visuals: Vec<Visual> =
        serde_json::from_slice(&output.stdout).context("원문 그림·표 목록")?;
    fs::create_dir_all(&directory)?;
    let mut saved = Vec::new();
    for visual in visuals {
        let file = format!("{}-{}-p{}.png", visual.kind, visual.number, visual.page);
        // Only helper-produced figure/table labels may become a file name.
        if !matches!(visual.kind.as_str(), "figure" | "table")
            || !visual
                .number
                .chars()
                .all(|c| c.is_ascii_digit() || c.is_ascii_uppercase())
        {
            continue;
        }
        let target = directory.join(&file);
        let temporary = tempfile::NamedTempFile::new_in(&directory)?;
        let output = Command::new(helper()?)
            .arg("crop")
            .arg(pdf)
            .arg(visual.page.to_string())
            .arg(temporary.path())
            .args(visual.rect.map(|v| v.to_string()))
            .output()?;
        if !output.status.success() {
            bail!("원문 {}쪽을 표시하지 못했습니다", visual.page);
        }
        let bytes = fs::read(temporary.path())?;
        let sha256 = hash(&bytes);
        atomic_write(&target, &bytes, false)?;
        saved.push(Saved {
            visual,
            file,
            sha256,
        });
    }
    if source_hash != hash(fs::read(pdf)?) {
        bail!("그림을 읽는 중 원문이 변경되었습니다");
    }
    atomic_write(&manifest, &serde_json::to_vec(&saved)?, false)?;
    Ok(saved
        .into_iter()
        .map(|s| Asset {
            visual: s.visual,
            path: directory.join(s.file),
        })
        .collect())
}

/// Exact labels, including supplementary labels. Never pair Figure 1 with Table 1.
pub(crate) fn references(text: &str) -> Vec<(String, String)> {
    static RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        let item = r"[A-Za-z]?\d+(?:[a-h])?(?:\s*[-–]\s*[A-Za-z]?\d+(?:[a-h])?)?";
        regex::Regex::new(&format!(r"(?i)(?:\b(fig(?:ure)?s?\.?|tables?)|\b(그림|표))\s*({item}(?:(?:\s*,\s*(?:and\s+)?|\s+(?:and|&)\s+|\s*(?:및|와|과)\s*){item})*)")).unwrap()
    });
    static ITEM: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"(?i)([A-Za-z]?\d+)(?:[a-h])?(?:\s*[-–]\s*([A-Za-z]?\d+)(?:[a-h])?)?")
            .unwrap()
    });
    let mut found = Vec::new();
    for c in RE.captures_iter(text) {
        let label = c
            .get(1)
            .or_else(|| c.get(2))
            .unwrap()
            .as_str()
            .to_lowercase();
        let kind = if label.starts_with("tab") || label == "표" {
            "table"
        } else {
            "figure"
        };
        for item in ITEM.captures_iter(&c[3]) {
            let start = item[1].to_uppercase();
            found.push((kind.to_owned(), start.clone()));
            if let Some(end) = item.get(2) {
                let prefix = if start.starts_with(|c: char| c.is_ascii_alphabetic()) {
                    &start[..1]
                } else {
                    ""
                };
                if let (Ok(a), Ok(b)) = (
                    start
                        .trim_start_matches(|c: char| c.is_ascii_alphabetic())
                        .parse::<u32>(),
                    end.as_str()
                        .trim_start_matches(|c: char| c.is_ascii_alphabetic())
                        .parse::<u32>(),
                ) && b > a
                    && b - a < 20
                    && (!end.as_str().starts_with(|c: char| c.is_ascii_alphabetic())
                        || end.as_str()[..1].eq_ignore_ascii_case(prefix))
                {
                    for n in a + 1..=b {
                        found.push((kind.into(), format!("{prefix}{n}")));
                    }
                }
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    found.retain(|key| seen.insert(key.clone()));
    found
}
