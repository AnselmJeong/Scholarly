use anyhow::{Context, Result, bail};
use serde_json::Value;
#[derive(Clone)]
pub(crate) struct Metadata {
    pub title: String,
    pub authors: String,
    pub year: Option<i64>,
    pub doi: String,
}
pub(crate) fn lookup(doi: &str) -> Result<Metadata> {
    let doi = doi
        .trim()
        .trim_start_matches("https://doi.org/")
        .trim_start_matches("http://dx.doi.org/")
        .trim_start_matches("doi:")
        .trim();
    if !doi.starts_with("10.") || !doi.contains('/') || doi.chars().any(char::is_whitespace) {
        bail!("조회할 DOI를 입력하세요")
    }
    let mut url = reqwest::Url::parse("https://api.crossref.org/works/")?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("DOI 주소 오류"))?
        .pop_if_empty()
        .push(doi);
    let response = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent(concat!(
            "Scholarly/",
            env!("CARGO_PKG_VERSION"),
            " desktop DOI lookup"
        ))
        .build()?
        .get(url)
        .send()?
        .error_for_status()?;
    if response.content_length().is_some_and(|n| n > 2_000_000) {
        bail!("서지정보 응답이 너무 큽니다")
    }
    let v: Value = response.json()?;
    let m = &v["message"];
    let returned = m["DOI"].as_str().context("DOI 정보가 없습니다")?;
    if !returned.eq_ignore_ascii_case(doi) {
        bail!("다른 DOI가 반환되어 저장하지 않았습니다")
    }
    Ok(Metadata {
        title: m["title"][0].as_str().context("제목이 없습니다")?.into(),
        authors: m["author"]
            .as_array()
            .map(|authors| {
                authors
                    .iter()
                    .map(|a| {
                        format!(
                            "{} {}",
                            a["given"].as_str().unwrap_or(""),
                            a["family"].as_str().unwrap_or("")
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(" and ")
            })
            .unwrap_or_default(),
        year: m["published"]["date-parts"][0][0].as_i64(),
        doi: returned.into(),
    })
}
