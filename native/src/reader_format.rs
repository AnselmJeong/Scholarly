use anyhow::{Context, Result, bail};
use gpui_kit::component::ActiveTheme;
use gpui_kit::component::text::{
    InlineElement, InlineRenderContext, MarkdownExtensions, MarkdownNode, MarkdownParseContext,
    MarkdownPlugin, markdown_ast,
};
use gpui_kit::*;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
};
#[derive(Clone)]
struct Formula {
    image: Arc<Image>,
    image_dark: Arc<Image>,
    svg: Vec<u8>,
    width: f32,
    height: f32,
}
#[derive(Clone)]
struct MathPlugin {
    block: bool,
    formulae: Arc<HashMap<String, Formula>>,
}
impl MarkdownPlugin for MathPlugin {
    fn name(&self) -> &str {
        if self.block {
            "scholarly-display-math"
        } else {
            "scholarly-inline-math"
        }
    }
    fn is_block(&self) -> bool {
        self.block
    }
    fn parse(
        &self,
        node: &markdown_ast::Node,
        _: &MarkdownParseContext<'_>,
    ) -> Option<MarkdownNode> {
        let text = match node {
            markdown_ast::Node::Math(n) if self.block => &n.value,
            markdown_ast::Node::InlineMath(n) if !self.block => &n.value,
            _ => return None,
        };
        // The Markdown parser strips a display fence's surrounding line breaks.
        // Use the same canonical key as the background formula cache.
        Some(MarkdownNode::new(self.name(), text.trim().to_owned()).text(format!("${text}$")))
    }
    fn render(&self, node: &MarkdownNode, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let key = node.data::<String>();
        if let Some(f) = key.and_then(|k| self.formulae.get(k)) {
            div()
                .id(SharedString::from(format!(
                    "formula-{}",
                    crate::reading::hash(node.as_text())
                )))
                .max_w_full()
                .overflow_x_scroll()
                .py_3()
                .child(
                    img(if cx.theme().is_dark() {
                        f.image_dark.clone()
                    } else {
                        f.image.clone()
                    })
                    .w(px(f.width))
                    .h(px(f.height)),
                )
                .into_any_element()
        } else {
            div().child(node.as_text().to_string()).into_any_element()
        }
    }
    fn render_inline(
        &self,
        node: &MarkdownNode,
        context: &InlineRenderContext,
        _: &mut Window,
        cx: &mut App,
    ) -> Option<InlineElement> {
        let f = self.formulae.get(node.data::<String>()?)?;
        let scale = context.font_size() / 16.0;
        Some(
            InlineElement::new(
                img(if cx.theme().is_dark() {
                    f.image_dark.clone()
                } else {
                    f.image.clone()
                })
                .w(scale * f.width)
                .h(scale * f.height),
            )
            .with_baseline(scale * f.height * 0.8),
        )
    }
}
fn typst() -> Result<PathBuf> {
    let exe = std::env::current_exe()?;
    let bundled = exe.parent().unwrap().join("../Resources/typst");
    if bundled.exists() {
        return Ok(bundled);
    }
    let dev = PathBuf::from("/opt/homebrew/bin/typst");
    if dev.exists() {
        return Ok(dev);
    }
    bail!("수식 렌더러가 없습니다")
}
fn formula(text: &str, home: &Path) -> Result<Formula> {
    if text.len() > 20_000 {
        bail!("수식이 너무 큽니다")
    }
    let key = crate::reading::hash(format!("math-v2:{text}"));
    let cache = home.join("cache").join(format!("{key}.svg"));
    if !cache.exists() {
        let converted = mitex::convert_math(text, None).map_err(|e| anyhow::anyhow!(e))?;
        // Convert MiTeX's text helper to a quoted Typst math string. All remaining code markers are rejected below.
        let converted = regex::Regex::new(r"#textmath\[([^\]]*)\];")?
            .replace_all(&converted, |c: &regex::Captures| {
                serde_json::to_string(&c[1]).unwrap()
            })
            .into_owned();
        // Only the math conversion is compiled, never model-authored Typst code.
        if converted.contains('#')
            || converted.contains('@')
            || converted.contains("read(")
            || converted.contains("eval(")
            || converted.contains("import")
            || converted.contains("include")
        {
            bail!("지원하지 않는 수식 명령")
        }
        let temp = tempfile::tempdir()?;
        let input = temp.path().join("math.typ");
        let output = temp.path().join("math.svg");
        fs::write(
            &input,
            format!(
                "#set page(width: auto, height: auto, margin: 2pt, fill: none)\n#set text(size: 12pt)\n#let big(body)=math.lr(body,size:1.3em)\n#let Big(body)=math.lr(body,size:1.6em)\n#let bigg(body)=math.lr(body,size:1.9em)\n#let Bigg(body)=math.lr(body,size:2.2em)\n#let negthinspace=h(-0.1667em)\n#let negmedspace=h(-0.2222em)\n#let negthickspace=h(-0.2778em)\n$ {converted} $"
            ),
        )?;
        let mut child = Command::new(typst()?)
            .arg("compile")
            .args(["--format", "svg", "--root"])
            .arg(temp.path())
            .arg(&input)
            .arg(&output)
            .stdout(std::process::Stdio::null())
            .stderr(fs::File::create(temp.path().join("error.txt"))?)
            .spawn()?;
        let start = std::time::Instant::now();
        loop {
            if let Some(status) = child.try_wait()? {
                if !status.success() {
                    bail!(
                        "수식을 렌더링할 수 없습니다: {}",
                        fs::read_to_string(temp.path().join("error.txt")).unwrap_or_default()
                    )
                };
                break;
            }
            if start.elapsed().as_secs() > 5 {
                let _ = child.kill();
                let _ = child.wait();
                bail!("수식 렌더링 시간 초과")
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        crate::reading::atomic_write(&cache, &fs::read(output)?, false)?;
    }
    let bytes = fs::read(cache)?;
    let svg = std::str::from_utf8(&bytes)?;
    let capture = regex::Regex::new(r#"viewBox="[^"]*?([\d.]+) ([\d.]+)""#)?
        .captures(svg)
        .context("수식 크기를 읽지 못했습니다")?;
    let width: f32 = capture[1].parse()?;
    let height: f32 = capture[2].parse()?;
    let dark = svg
        .replace("fill=\"#000000\"", "fill=\"#ededed\"")
        .replace("fill=\"#000\"", "fill=\"#ededed\"")
        .replace("stroke=\"#000000\"", "stroke=\"#ededed\"")
        .replacen("<svg ", "<svg fill=\"#ededed\" ", 1);
    Ok(Formula {
        image_dark: Arc::new(Image::from_bytes(ImageFormat::Svg, dark.into_bytes())),
        svg: bytes.clone(),
        image: Arc::new(Image::from_bytes(ImageFormat::Svg, bytes)),
        width: width * 1.333,
        height: height * 1.333,
    })
}
pub(crate) fn prepare(body: &str, home: &Path) -> (MarkdownExtensions, Vec<String>) {
    let mut formulae = HashMap::new();
    let mut warnings = Vec::new();
    let pattern = regex::Regex::new(r"(?s)\$\$(.+?)\$\$|\$([^$\n]+)\$").unwrap();
    for cap in pattern.captures_iter(body) {
        let math = cap.get(1).or_else(|| cap.get(2)).unwrap().as_str().trim();
        if formulae.contains_key(math) {
            continue;
        }
        match formula(math, home) {
            Ok(f) => {
                formulae.insert(math.to_owned(), f);
            }
            Err(_) => warnings.push(math.to_owned()),
        }
    }
    let formulae = Arc::new(formulae);
    (
        MarkdownExtensions::default()
            .plugin(MathPlugin {
                block: false,
                formulae: formulae.clone(),
            })
            .plugin(MathPlugin {
                block: true,
                formulae,
            }),
        warnings,
    )
}
fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
fn markup(body: &str, home: &Path) -> String {
    use base64::Engine;
    use pulldown_cmark::{Event, Options, Parser, Tag, html};
    let body = display_body(body);
    let mut content = String::new();
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_MATH;
    let parser=Parser::new_ext(&body,options).map(|event|match event {
        Event::Html(s)|Event::InlineHtml(s)=>Event::Text(s),
        Event::InlineMath(s)|Event::DisplayMath(s)=>{
            match formula(&s,home){
                Ok(f)=>Event::Html(format!("<img class=\"math\" alt=\"{}\" width=\"{}\" height=\"{}\" src=\"data:image/svg+xml;base64,{}\">",escape(&s),f.width,f.height,base64::engine::general_purpose::STANDARD.encode(f.svg)).into()),
                Err(_)=>Event::Text(format!("${s}$").into())
            }
        },
        Event::Start(Tag::Link{link_type,dest_url,title,id})=>Event::Start(Tag::Link{link_type,dest_url:if dest_url.starts_with("https://")||dest_url.starts_with("http://")||dest_url.starts_with('#'){dest_url}else{"".into()},title,id}),
        Event::Start(Tag::Image{link_type,title,id,..})=>Event::Start(Tag::Image{link_type,dest_url:"".into(),title,id}),
        other=>other
    });
    html::push_html(&mut content, parser);
    content
}
pub(crate) fn export_html(
    title: &str,
    body: &str,
    pdf: &Path,
    home: &Path,
    target: &Path,
) -> Result<()> {
    use base64::Engine;
    let mut content = String::new();
    for block in crate::figures::blocks(body, pdf)? {
        match block {
            crate::figures::Block::Text(text) => content.push_str(&markup(&text, home)),
            crate::figures::Block::Figure(figure, path, context) => {
                let data = base64::engine::general_purpose::STANDARD.encode(fs::read(path)?);
                content.push_str(&format!("<section class=\"figure-explainer\"><figure><img alt=\"{}\" src=\"data:image/png;base64,{data}\"><figcaption>{} · 원문 {}쪽</figcaption></figure><div>{}</div></section>",escape(&figure.caption),escape(&figure.caption),figure.page,markup(&context,home)));
            }
        }
    }
    let title = escape(title);
    let page = format!(
        r#"<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>{title}</title><style>
html{{color-scheme:light}}body{{margin:0;background:#f8f7f2;color:#292d30;font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;line-height:1.85;font-size:17px}}main{{max-width:1020px;margin:auto;padding:64px 48px}}header{{border-bottom:1px solid #d6d8d1;margin-bottom:48px;padding-bottom:24px}}h1,h2,h3{{line-height:1.35;letter-spacing:-.025em;text-wrap:balance}}h1{{margin-top:2.2em;font-size:1.6rem}}h2{{margin-top:2em;font-size:1.3rem}}h3{{font-size:1.1rem}}p{{margin:1.1em 0;max-width:80ch;overflow-wrap:anywhere}}table{{border-collapse:collapse;width:100%;font-size:.95em;display:block;overflow-x:auto}}th,td{{border-bottom:1px solid #d6d8d1;padding:12px;text-align:left}}blockquote{{margin:1.5em 0;padding:8px 24px;border-left:3px solid #b37057}}a{{color:#7a4f3e}}img{{max-width:100%;height:auto}}.math{{vertical-align:middle;display:inline;max-width:100%}}code{{font-family:ui-monospace,monospace}}pre{{overflow-x:auto}}.figure-explainer{{display:grid;grid-template-columns:minmax(220px,40%) minmax(0,1fr);gap:32px;margin:32px 0;padding-left:24px;border-left:3px solid #c47d60}}figure{{margin:0}}figure>img{{background:white;border:1px solid #e0ded7;border-radius:8px}}figcaption{{font-size:.85em;color:#666b65;line-height:1.5;margin-top:12px}}@media(max-width:720px){{main{{padding:24px}}.figure-explainer{{grid-template-columns:1fr;padding-left:16px}}}}@media print{{body{{background:white}}main{{padding:0}}figure{{break-inside:avoid}}}}</style><main><header><small>Scholarly · 학습 노트</small><h1>{title}</h1></header>{content}</main></html>"#
    );
    crate::reading::atomic_write(target, page.as_bytes(), true)
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
            Event::Start(Tag::Image { .. }) => replacements.push((
                range,
                "[원문 그림은 ‘원문 함께 보기’에서 연결하세요]".to_owned(),
            )),
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

#[cfg(test)]
pub(crate) fn formula_svg(text: &str, home: &Path) -> Result<Vec<u8>> {
    Ok(formula(text, home)?.svg)
}
