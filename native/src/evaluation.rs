use crate::{
    library::{Library, Settings},
    reader_format, reading,
};
use anyhow::{Context, Result};
use serde_json::json;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, atomic::AtomicBool},
    time::Instant,
};
/// An explicit developer command: all outputs and database changes stay in the chosen directory.
pub(crate) fn run(pdf: &Path, directory: &Path) -> Result<()> {
    fs::create_dir_all(directory)?;
    let copied = directory.join(pdf.file_name().context("PDF filename")?);
    if !copied.exists() {
        fs::copy(pdf, &copied)?;
    }
    let home = directory.join("app-data");
    fs::create_dir_all(&home)?;
    let _ = rusqlite::Connection::open(home.join("database.sqlite"))?;
    let mut settings = Settings::load(&home)?;
    settings.root = directory.to_string_lossy().into_owned();
    if let Ok(model) = std::env::var("SCHOLARLY_EVAL_MODEL") {
        settings.model = model;
    }
    let mut library = Library::open(&home)?;
    library.scan(directory)?;
    let article = library
        .articles(directory)?
        .into_iter()
        .find(|a| a.path == copied.canonicalize().unwrap_or(copied.clone()))
        .context("Evaluation article")?;
    let started = Instant::now();
    let mut first = None;
    let body = reading::generate(
        &article,
        &settings,
        &home,
        Arc::new(AtomicBool::new(false)),
        &mut |text| {
            if first.is_none() && text.len() >= 200 {
                first = Some(started.elapsed().as_millis());
                eprintln!("First readable text: {} ms", first.unwrap());
            }
        },
        &mut |message| eprintln!("{message}"),
    )?;
    let metrics = json!({"source":pdf.file_name().map(|s|s.to_string_lossy()),"duration_ms":started.elapsed().as_millis(),"first_text_ms":first,"eojeol":body.split_whitespace().count(),"engine":"native","path":reading::output_path(&copied)});
    reading::atomic_write(
        &directory.join("native-metrics.json"),
        &serde_json::to_vec_pretty(&metrics)?,
        true,
    )?;
    reader_format::export_html(
        &article.title,
        &body,
        &copied,
        &home,
        &reading::output_path(&copied).with_extension("html"),
    )?;
    println!("{}", serde_json::to_string_pretty(&metrics)?);
    if std::env::var_os("SCHOLARLY_EVAL_REVIEW").is_some() {
        let review = reading::review(&article, &settings, &home, Arc::new(AtomicBool::new(false)))?;
        println!("Review passed: {}", review["passed"]);
    }
    Ok(())
}
pub(crate) fn arguments() -> Option<Result<()>> {
    let args = std::env::args().collect::<Vec<_>>();
    if args.get(1).is_some_and(|a| a == "--list-models") {
        return Some((|| {
            let mut settings = Settings::load(&crate::library::app_home())?;
            if let Some(provider) = args.get(2) {
                settings.provider = provider.clone();
            }
            let models =
                crate::provider::models(&settings, Arc::new(AtomicBool::new(false)), None)?;
            println!("{}", serde_json::to_string_pretty(&models)?);
            Ok(())
        })());
    }
    if args.get(1).is_some_and(|a| a == "--export-html") {
        return Some((|| {
            let pdf = PathBuf::from(args.get(2).context("--export-html <PDF> <HTML>")?);
            let target = PathBuf::from(args.get(3).context("--export-html <PDF> <HTML>")?);
            let (body, _) = reading::read_note(&pdf)?;
            reader_format::export_html(
                &pdf.file_stem().unwrap_or_default().to_string_lossy(),
                &body,
                &pdf,
                &crate::library::app_home(),
                &target,
            )
        })());
    }
    if args.get(1).is_some_and(|a| a == "--attach-figure") {
        return Some((|| {
            let pdf = PathBuf::from(
                args.get(2)
                    .context("--attach-figure PDF page x y width height heading caption")?,
            );
            let page = args.get(3).context("page")?.parse()?;
            let mut rect = [0.; 4];
            for (i, v) in rect.iter_mut().enumerate() {
                *v = args.get(i + 4).context("rectangle")?.parse()?;
            }
            crate::figures::attach(
                &pdf,
                page,
                rect,
                args.get(8).context("heading")?,
                args.get(9).context("caption")?,
            )
        })());
    }
    if args.get(1).is_some_and(|a| a == "--evaluate") {
        Some((|| {
            run(
                &PathBuf::from(args.get(2).context("--evaluate <PDF> <directory>")?),
                &PathBuf::from(args.get(3).context("--evaluate <PDF> <directory>")?),
            )
        })())
    } else {
        None
    }
}
