use crate::reader_html::escape;
use anyhow::Result;
use std::path::Path;
pub(crate) fn export_html(
    title: &str,
    body: &str,
    pdf: &Path,
    home: &Path,
    target: &Path,
) -> Result<()> {
    crate::reader_html::export(title, body, pdf, home, target)
}

/// Rendering accepts only text and explicit app-managed image attachments.
pub(crate) fn display_body(body: &str) -> String {
    use pulldown_cmark::{Event, Options, Parser, Tag};
    let normalized = crate::reading::normalize(body);
    // CommonMark treats a closing parenthesis followed by a Korean particle as
    // non-flanking emphasis. Move only that punctuation outside the bold span;
    // the displayed wording and stored source remain unchanged.
    let normalized = regex::Regex::new(r"\*\*([^*\n]+?)([)）])\*\*([가-힣])")
        .expect("Korean emphasis pattern")
        .replace_all(&normalized, "**$1**$2$3")
        .into_owned();
    let mut replacements = Vec::new();
    for (event, range) in Parser::new_ext(&normalized, Options::ENABLE_MATH).into_offset_iter() {
        match event {
            Event::Start(Tag::Image { .. }) => replacements.push((range, "[원문 그림]".to_owned())),
            Event::Html(text) | Event::InlineHtml(text) => {
                replacements.push((range, escape(&text)))
            }
            _ => {}
        }
    }
    replacements.sort_by_key(|(range, _)| range.start);
    let mut safe = String::new();
    let mut previous = 0;
    for (range, text) in replacements {
        if range.start < previous {
            continue;
        }
        safe.push_str(&normalized[previous..range.start]);
        safe.push_str(&text);
        previous = range.end;
    }
    safe.push_str(&normalized[previous..]);
    safe.lines()
        .map(|line| match line {
            "# 0. Snapshot" => "# 한눈에 보기",
            "# 1. Prerequisite Knowledge" => "# 먼저 알아둘 개념",
            "# 2. Purpose & Scope" => "# 연구 질문과 범위",
            "# 3. Section-by-Section Digest" => "# 본문 해설",
            "# 4. Key Findings & Details" => "# 핵심 결과",
            "# 5. Integrated Summary" => "# 종합 이해",
            "# 6. Coverage Map" => "# 읽은 범위",
            other => other,
        })
        .collect::<Vec<_>>()
        .join("\n")
}
