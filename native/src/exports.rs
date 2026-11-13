use crate::{library::Article, reading};
use anyhow::{Context, Result};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
fn tex(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_control())
        .map(|c| match c {
            '{' | '}' => String::new(),
            '\\' => "\\textbackslash{}".into(),
            '&' => "\\&".into(),
            '%' => "\\%".into(),
            '_' => "\\_".into(),
            '#' => "\\#".into(),
            '$' => "\\$".into(),
            _ => c.to_string(),
        })
        .collect()
}
pub(crate) fn bibtex(articles: &[Article]) -> String {
    articles.iter().map(|a|format!("@article{{scholarly{},\n  title = {{{}}},\n  author = {{{}}},\n  year = {{{}}},\n  doi = {{{}}}\n}}\n",a.id,tex(&a.title),tex(&a.authors),a.year.map(|y|y.to_string()).unwrap_or_default(),tex(&a.doi))).collect::<Vec<_>>().join("\n")
}
pub(crate) fn export_bibtex(articles: &[Article], root: &Path) -> Result<PathBuf> {
    let target = root.join("exports/references.bib");
    reading::atomic_write(&target, bibtex(articles).as_bytes(), true)?;
    Ok(target)
}
pub(crate) fn article_zip(article: &Article) -> Result<PathBuf> {
    let root = article.path.parent().context("PDF folder")?.join("exports");
    fs::create_dir_all(&root)?;
    let target = root.join(format!(
        "{}.zip",
        article
            .path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
    ));
    let file = tempfile::NamedTempFile::new_in(&root)?;
    let mut archive = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let mut paths = vec![article.path.clone()];
    let note = reading::output_path(&article.path);
    if note.is_file() {
        paths.push(note.clone());
    }
    let legacy = note.with_file_name(format!(
        "{}.md",
        article
            .path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
    ));
    if legacy.is_file() {
        paths.push(legacy);
    }
    for ext in ["figures.json", "review.json", "html"] {
        let sidecar = note.with_extension(ext);
        if sidecar.is_file() {
            paths.push(sidecar);
        }
    }
    let assets = note.with_extension("assets");
    if assets.is_dir() {
        for entry in fs::read_dir(assets)? {
            let entry = entry?;
            if entry.file_type()?.is_file() {
                paths.push(entry.path());
            }
        }
    }
    for path in paths {
        let relative = path
            .strip_prefix(article.path.parent().unwrap())?
            .to_string_lossy()
            .replace('\\', "/");
        archive.start_file(relative, options)?;
        std::io::copy(&mut fs::File::open(path)?, &mut archive)?;
    }
    archive.start_file("references.bib", options)?;
    archive.write_all(bibtex(std::slice::from_ref(article)).as_bytes())?;
    let mut file = archive.finish()?;
    file.as_file_mut().sync_all()?;
    if target.exists() {
        let mut bytes = Vec::new();
        fs::File::open(&target)?.read_to_end(&mut bytes)?;
        reading::atomic_write(&target.with_extension("zip.previous"), &bytes, false)?;
    }
    file.persist(&target).map_err(|e| e.error)?;
    Ok(target)
}
