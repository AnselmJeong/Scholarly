//! Protect display TeX before CommonMark can interpret `=` as a heading or
//! underscores as emphasis. Recover delimiter omissions without changing TeX.
use crate::reader_html::escape;

pub(crate) struct MathBlocks(Vec<(String, String)>);
impl MathBlocks {
    pub(crate) fn restore(&self, mut html: String) -> String {
        for (token, tex) in &self.0 {
            html = html.replace(
                &format!("<p>{token}</p>"),
                &format!(
                    "<div class=\"math-display\" data-tex=\"{}\"></div>",
                    escape(tex)
                ),
            );
        }
        html
    }
}
fn prose(line: &str) -> bool {
    let line = line.trim();
    if line.starts_with('#') || line.starts_with("[Source:") || line.starts_with("| ") {
        return true;
    }
    static TEXT: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"\\(?:text|textrm|mathrm|operatorname)\{[^}]*\}").unwrap()
    });
    let bare = TEXT.replace_all(line, "");
    bare.chars().any(|c| ('가'..='힣').contains(&c))
        || (!line.contains(['\\', '=', '^', '_', '{', '}'])
            && (line.split_whitespace().filter(|w| w.len() >= 3).count() >= 2
                || line.ends_with('.') && line.chars().any(char::is_alphabetic)))
}

pub(crate) fn protect(body: &str) -> (String, MathBlocks) {
    let lines: Vec<_> = body.lines().collect();
    let mut output = String::new();
    let mut blocks = MathBlocks(Vec::new());
    let mut fence = None;
    let mut i = 0;
    let nonce = crate::reading::hash(body.as_bytes());
    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            let ch = trimmed.chars().next().unwrap();
            let len = trimmed.chars().take_while(|c| *c == ch).count();
            if fence.is_none() {
                fence = Some((ch, len));
            } else if fence.is_some_and(|(c, n)| c == ch && len >= n) {
                fence = None;
            }
            output.push_str(line);
            output.push('\n');
            i += 1;
            continue;
        }
        if fence.is_some() || line.starts_with("    ") || line.starts_with('\t') {
            output.push_str(line);
            output.push('\n');
            i += 1;
            continue;
        }
        if let Some(first) = trimmed.strip_prefix("$$") {
            let mut tex = String::new();
            let mut part = first;
            loop {
                let closing = part.split_once("$$").or_else(|| {
                    // A lone closing dollar is a common generation omission.
                    // Only recover it inside an already opened display block.
                    part.trim_end()
                        .strip_suffix('$')
                        .filter(|v| !v.ends_with('\\'))
                        .map(|v| (v, ""))
                });
                if let Some((before, after)) = closing {
                    tex.push_str(before);
                    i += 1;
                    // Preserve prose following a closing delimiter.
                    if !tex.trim().is_empty() {
                        let token = format!("SCHOLARLYMATH{nonce}X{}END", blocks.0.len());
                        blocks.0.push((token.clone(), tex.trim().to_owned()));
                        output.push_str(&format!("\n\n{token}\n\n"));
                    }
                    if !after.trim().is_empty() {
                        output.push_str(after);
                        output.push('\n');
                    }
                    break;
                }
                tex.push_str(part);
                tex.push('\n');
                i += 1;
                if i == lines.len() || prose(lines[i]) || tex.len() > 32_000 {
                    if !tex.trim().is_empty() {
                        let token = format!("SCHOLARLYMATH{nonce}X{}END", blocks.0.len());
                        blocks.0.push((token.clone(), tex.trim().to_owned()));
                        output.push_str(&format!("\n\n{token}\n\n"));
                    }
                    break;
                }
                part = lines[i];
            }
        } else if let Some(tex) = trimmed.strip_suffix("$$")
            && !tex.trim().is_empty()
            && !prose(tex)
            && tex.contains(['\\', '=', '^', '_'])
        {
            let token = format!("SCHOLARLYMATH{nonce}X{}END", blocks.0.len());
            blocks.0.push((token.clone(), tex.trim().to_owned()));
            output.push_str(&format!("\n\n{token}\n\n"));
            i += 1;
        } else {
            output.push_str(line);
            output.push('\n');
            i += 1;
        }
    }
    (output, blocks)
}

#[cfg(test)]
mod tests {
    use crate::reader_html::markup;

    #[test]
    fn equality_line_in_real_equation_is_not_a_setext_heading() {
        let html = markup(
            "$$\nF[q_\\mu,o]\n=\nD_{\\mathrm{KL}}\\!\\left[q_\\mu(s)\\,\\|\\,p(s\\mid o)\\right]\n-\\log p(o).\n$$\n\n첫 항은 현재 믿음과 목표 사후분포의 차이다.",
        );
        assert_eq!(html.matches("class=\"math-display\"").count(), 1);
        assert!(html.contains("F[q_\\mu,o]\n=\nD_"));
        assert!(!html.contains("<h"));
        assert!(html.contains("<p>첫 항은"));
    }

    #[test]
    fn omitted_and_single_closing_dollars_preserve_following_prose() {
        for ending in ["", "$", "$$"] {
            for prose in ["다음 문단입니다.", "Next paragraph.", "## Next section"] {
                let html = markup(&format!("$$\nx^2 + y^2 = z^2\n{ending}\n\n{prose}"));
                assert_eq!(html.matches("class=\"math-display\"").count(), 1, "{html}");
                assert!(html.contains("data-tex=\"x^2 + y^2 = z^2\""), "{html}");
                assert!(
                    html.contains(if prose.starts_with('#') {
                        "<h2>Next section"
                    } else {
                        "<p>"
                    }),
                    "{html}"
                );
            }
        }
    }

    #[test]
    fn protects_code_and_recovers_standalone_missing_opener() {
        let html = markup(
            "```tex\n$$\nx = y\n```\n\nInline `$x$` and $a_i$.\n\nx^2 = y$$\n\n$$a=b$$ After the equation.",
        );
        assert!(html.contains("<code class=\"language-tex\">$$\nx = y"));
        assert!(html.contains("<code>$x$</code>"));
        assert_eq!(html.matches("class=\"math-display\"").count(), 2);
        assert_eq!(html.matches("class=\"math-inline\"").count(), 1);
        assert!(html.contains("After the equation."));
    }

    #[test]
    fn textual_terms_inside_math_remain_tex_and_html_is_escaped() {
        let html = markup("$$\\text{한국어 설명} + \\text{a longer English label} = x < y$$");
        assert!(html.contains("data-tex=\"\\text{한국어 설명}"));
        assert!(html.contains("x &lt; y"));
    }
}
