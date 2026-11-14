//! One offline HTML renderer for the in-app reader and exported notes.
use crate::{
    reader_format,
    source_visuals::{self, Asset},
};
use anyhow::Result;
use base64::{Engine, engine::general_purpose::STANDARD};
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd, html};
use std::{collections::HashSet, fs, ops::Range, path::Path};

fn markdown_options() -> Options {
    Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_MATH
}

pub(crate) fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
pub(crate) fn markup(body: &str) -> String {
    let body = reader_format::display_body(body);
    let (body, math) = crate::reader_math::protect(&body);
    let parser = Parser::new_ext(&body, markdown_options()).map(|event| match event {
        Event::Html(text) | Event::InlineHtml(text) => Event::Text(text),
        Event::InlineMath(text) => Event::Html(
            format!(
                "<span class=\"math-inline\" data-tex=\"{}\"></span>",
                escape(&text)
            )
            .into(),
        ),
        Event::DisplayMath(text) => Event::Html(
            format!(
                "<div class=\"math-display\" data-tex=\"{}\"></div>",
                escape(&text)
            )
            .into(),
        ),
        Event::Start(Tag::Link {
            link_type,
            dest_url,
            title,
            id,
        }) => Event::Start(Tag::Link {
            link_type,
            dest_url: if dest_url.starts_with("https://")
                || dest_url.starts_with("http://")
                || dest_url.starts_with('#')
            {
                dest_url
            } else {
                "".into()
            },
            title,
            id,
        }),
        other => other,
    });
    let mut result = String::new();
    html::push_html(&mut result, parser);
    // Older summaries sometimes put a single-dollar equation in its own paragraph.
    static STANDALONE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r#"<p><span class="math-inline" data-tex="([^"]*)"></span></p>"#).unwrap()
    });
    math.restore(
        STANDALONE
            .replace_all(
                &result,
                "<div class=\"math-display\" data-tex=\"$1\"></div>",
            )
            .into_owned(),
    )
}
fn visual(asset: &Asset) -> Result<String> {
    let v = &asset.visual;
    let data = STANDARD.encode(fs::read(&asset.path)?);
    let label = format!(
        r#"<div class="visual-label"><span>{}</span><button data-page="{}">원문 {}쪽</button></div>"#,
        escape(&v.label),
        v.page,
        v.page
    );
    let image = format!(
        r#"<img tabindex="0" alt="{}" src="data:image/png;base64,{}">"#,
        escape(&v.label),
        data
    );
    let contents = if v.cropped {
        format!(
            r#"{}<figcaption>원문에서 자동으로 가져온 {} · 클릭하여 확대<details><summary>원문 캡션</summary>{}</details></figcaption>"#,
            image,
            if v.kind == "table" { "표" } else { "그림" },
            escape(&v.caption)
        )
    } else {
        // Do not present an uncertain full page as an extracted figure/table.
        format!(
            r#"<p class="source-note">이 자료의 영역을 정확히 분리하지 못했습니다.</p><details class="source-fallback"><summary>원문 페이지 확인</summary>{}<p class="source-note">{}</p></details>"#,
            image,
            escape(&v.caption)
        )
    };
    Ok(format!(
        r#"<figure data-visual="{}">{}{}</figure>"#,
        escape(&v.label),
        label,
        contents
    ))
}
// Associate verified source numbers with explanatory prose, not headings, code,
// tables, result lists, or the coverage inventory. Keep original Markdown ranges
// so inserting a visual never splits a fenced block, equation, or nested list.
struct Explanation {
    range: Range<usize>,
    references: Vec<(String, String)>,
    overview: bool,
}

fn explanations(body: &str) -> Vec<Explanation> {
    let mut result = Vec::new();
    let mut sections = Vec::<(u8, u8)>::new();
    let mut nested = 0;
    for (event, range) in Parser::new_ext(body, markdown_options()).into_offset_iter() {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                let level = level as u8;
                while sections.last().is_some_and(|(l, _)| *l >= level) {
                    sections.pop();
                }
                let title = body[range].to_lowercase();
                let role = if [
                    "coverage map",
                    "읽은 범위",
                    "참고문헌",
                    "references",
                    "목차",
                    "contents",
                ]
                .iter()
                .any(|t| title.contains(t))
                {
                    2
                } else if [
                    "snapshot",
                    "한눈에 보기",
                    "key findings",
                    "핵심 결과",
                    "integrated summary",
                    "종합 이해",
                ]
                .iter()
                .any(|t| title.contains(t))
                {
                    1
                } else {
                    0
                };
                sections.push((level, role));
            }
            Event::Start(Tag::List(_) | Tag::BlockQuote(_) | Tag::FootnoteDefinition(_)) => {
                nested += 1
            }
            Event::End(TagEnd::List(_) | TagEnd::BlockQuote(_) | TagEnd::FootnoteDefinition) => {
                nested -= 1
            }
            Event::Start(Tag::Paragraph)
                if nested == 0 && !sections.iter().any(|(_, role)| *role == 2) =>
            {
                let references = source_visuals::references(&body[range.clone()]);
                if !references.is_empty() {
                    result.push(Explanation {
                        range,
                        references,
                        overview: sections.iter().any(|(_, role)| *role == 1),
                    });
                }
            }
            _ => {}
        }
    }
    result
}

pub(crate) fn content(body: &str, assets: &[Asset]) -> Result<String> {
    let (protected, math) = crate::reader_math::protect(&crate::reading::normalize(body));
    let body = protected.as_str();
    let paragraphs = explanations(body);
    let mut groups = vec![Vec::new(); paragraphs.len()];
    let mut shown = HashSet::new();
    for asset in assets {
        let key = (asset.visual.kind.clone(), asset.visual.number.clone());
        // Detailed explanation wins over the opening synopsis. A reference to a
        // single visual wins over a broad range; equal candidates keep reading order.
        let best = paragraphs
            .iter()
            .enumerate()
            .filter(|(_, p)| p.references.contains(&key))
            .min_by_key(|(i, p)| {
                (
                    p.overview,
                    p.references
                        .iter()
                        .filter(|(kind, _)| kind == &key.0)
                        .count(),
                    *i,
                )
            });
        if let Some((i, _)) = best {
            groups[i].push(asset);
            shown.insert(asset.visual.label.clone());
        }
    }
    let mut html = String::new();
    let mut previous = 0;
    for (paragraph, matching) in paragraphs.iter().zip(groups) {
        if matching.is_empty() {
            continue;
        }
        html.push_str(&markup(&body[previous..paragraph.range.start]));
        let (figures, other): (Vec<_>, Vec<_>) = matching
            .into_iter()
            .partition(|a| a.visual.cropped && a.visual.kind == "figure");
        let explanation = markup(&body[paragraph.range.clone()]);
        if figures.is_empty() {
            html.push_str(&explanation);
        } else {
            // Prose comes first in both reading and keyboard order. CSS places
            // the figures beside it, or immediately below in a narrow pane.
            html.push_str(&format!("<section class=\"visual visual-pair\"><div class=\"explanation\">{explanation}</div><div class=\"visual-figures\">"));
            for asset in figures {
                html.push_str(&visual(asset)?);
            }
            html.push_str("</div></section>");
        }
        // Tables retain the full reading width; continued table pages stay together.
        for asset in other {
            html.push_str(&format!(
                "<section class=\"visual\">{}</section>",
                visual(asset)?
            ));
        }
        previous = paragraph.range.end;
    }
    html.push_str(&markup(&body[previous..]));
    let remaining: Vec<_> = assets
        .iter()
        .filter(|a| !shown.contains(&a.visual.label))
        .collect();
    if !remaining.is_empty() {
        html.push_str("<details class=\"visual-gallery\"><summary>원문의 그림과 표 더 보기</summary><p class=\"source-note\">본문에서 설명 위치를 확인하지 못한 자료입니다. 원문 캡션과 함께 확인할 수 있습니다.</p>");
        for asset in remaining {
            html.push_str(&format!(
                "<section class=\"visual\">{}</section>",
                visual(asset)?
            ));
        }
    }
    if !assets.is_empty() && assets.iter().any(|a| !shown.contains(&a.visual.label)) {
        html.push_str("</details>");
    }
    Ok(math.restore(html))
}
pub(crate) fn prepare(body: &str, pdf: &Path, home: &Path) -> Result<String> {
    let assets = source_visuals::extract(pdf, home)?;
    let blocks = crate::figures::blocks(body, pdf)?;
    let text = blocks
        .iter()
        .map(|b| match b {
            crate::figures::Block::Text(t) => t.as_str(),
            crate::figures::Block::Figure(_, _, context) => context.as_str(),
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    let mut html = content(&text, &assets)?;
    // Preserve optional user crops without duplicating automatically located labels.
    for block in blocks {
        if let crate::figures::Block::Figure(f, path, _) = block {
            let labels = source_visuals::references(&f.caption);
            if assets
                .iter()
                .any(|a| labels.contains(&(a.visual.kind.clone(), a.visual.number.clone())))
            {
                continue;
            }
            html.push_str(&format!("<section class=\"visual\"><figure><img alt=\"{}\" src=\"data:image/png;base64,{}\"><figcaption>{} · 원문 {}쪽</figcaption></figure></section>",escape(&f.caption),STANDARD.encode(fs::read(path)?),escape(&f.caption),f.page));
        }
    }
    Ok(html)
}
pub(crate) fn shell(content: &str, title: &str) -> String {
    let initial = serde_json::to_string(content)
        .unwrap()
        .replace('<', "\\u003c");
    format!(
        r#"<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-scholarly-reader-v1'; font-src data:; img-src data:; base-uri 'none'; form-action 'none'"><title>{}</title><style>{}
{}</style></head><body><main></main><dialog aria-label="원문 자료 확대"><div class="zoom-toolbar"><button data-zoom-out aria-label="축소">−</button><span data-zoom-label></span><button data-zoom-in aria-label="확대">+</button><button data-zoom-fit>맞춤</button><button data-close>닫기 · Esc</button></div><div class="zoom-viewport" tabindex="0"><img alt=""></div></dialog><script nonce="scholarly-reader-v1">{}</script><script nonce="scholarly-reader-v1">{}
renderNote({},true,17,true);send({{ready:true}});</script></body></html>"#,
        escape(title),
        include_str!("../assets/reader/katex-embedded.css"),
        include_str!("../assets/reader/reader.css"),
        include_str!("../assets/reader/katex.min.js"),
        include_str!("../assets/reader/reader.js"),
        initial
    )
}
pub(crate) fn export(
    title: &str,
    body: &str,
    pdf: &Path,
    home: &Path,
    target: &Path,
) -> Result<()> {
    crate::reading::atomic_write(
        target,
        shell(&prepare(body, pdf, home)?, title).as_bytes(),
        true,
    )
}
