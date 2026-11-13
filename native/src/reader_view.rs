use crate::ui;
use crate::{
    figures,
    library::{Article, Library, Settings},
    provider, reader_format, reading,
};
use gpui_kit::assets::IconName;
use gpui_kit::component::Icon;
use gpui_kit::component::button::ButtonVariants;
use gpui_kit::component::{
    ActiveTheme, Disableable, ElementExt, Selectable, Sizable,
    button::Button,
    input::{Input, InputState, Textarea, TextareaState},
    text::{MarkdownExtensions, TextView, TextViewStyle},
};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::Duration,
};
#[derive(Clone)]
pub(crate) struct ArticleChanged(pub(crate) Article);
struct Loaded {
    body: String,
    status: String,
    notes: String,
    history: Vec<(String, String)>,
    extensions: MarkdownExtensions,
    review: String,
}
enum Update {
    Loaded(i64, u64, Result<Loaded, String>),
    Prepared(
        i64,
        u64,
        MarkdownExtensions,
        Vec<figures::Block>,
        Vec<String>,
    ),
    Text(i64, String),
    Status(i64, String),
    Finished(i64, Result<String, String>),
    Page(i64, usize, Result<(PathBuf, f32), String>),
    Metadata(i64, Result<crate::metadata::Metadata, String>),
}
pub(crate) struct ReaderView {
    home: PathBuf,
    settings: Settings,
    article: Option<Article>,
    body: SharedString,
    status: String,
    extensions: MarkdownExtensions,
    notes: Entity<TextareaState>,
    question: Entity<InputState>,
    keywords: Entity<TextareaState>,
    history: Vec<(String, String)>,
    tab: u8,
    inspector_tab: u8,
    more_actions: bool,
    loaded_article: Option<i64>,
    review_text: String,
    notice: String,
    job_action: String,
    busy: bool,
    cancel: provider::Cancel,
    sender: mpsc::Sender<Update>,
    receiver: mpsc::Receiver<Update>,
    _poll: Task<()>,
    source_visible: bool,
    page: usize,
    page_image: Option<(PathBuf, f32)>,
    page_loading: bool,
    loaded_at: std::time::Instant,
    load_epoch: u64,
    blocks: Vec<figures::Block>,
    saved_notes: String,
    observed_notes: String,
    notes_changed_at: Option<std::time::Instant>,
    _quit: Subscription,
    font_size: f32,
    crop_mode: bool,
    crop_bounds: Option<Bounds<Pixels>>,
    crop_start: Option<Point<Pixels>>,
    crop_end: Option<Point<Pixels>>,
    crop_rect: Option<[f32; 4]>,
    figure_heading: usize,
    caption: Entity<InputState>,
    metadata_title: Entity<InputState>,
    metadata_authors: Entity<InputState>,
    metadata_year: Entity<InputState>,
    metadata_doi: Entity<InputState>,
}
impl EventEmitter<ArticleChanged> for ReaderView {}
impl Drop for ReaderView {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Relaxed);
    }
}
impl ReaderView {
    pub(crate) fn new(
        home: PathBuf,
        settings: Settings,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let (sender, receiver) = mpsc::channel();
        let poll = cx.spawn_in(window, async move |weak, cx| {
            loop {
                cx.background_executor()
                    .timer(Duration::from_millis(100))
                    .await;
                if weak
                    .update_in(cx, |this, window, cx| this.poll(window, cx))
                    .is_err()
                {
                    break;
                }
            }
        });
        let quit = cx.on_app_quit(|this, cx| {
            this.save_notes(cx);
            this.cancel.store(true, Ordering::Relaxed);
            async {}
        });
        Self {
            load_epoch: 0,
            blocks: vec![],
            saved_notes: String::new(),
            observed_notes: String::new(),
            notes_changed_at: None,
            _quit: quit,
            font_size: 17.,
            crop_mode: false,
            crop_bounds: None,
            crop_start: None,
            crop_end: None,
            crop_rect: None,
            figure_heading: 0,
            caption: cx.new(|cx| InputState::new(window, cx).placeholder("그림 번호와 설명")),
            metadata_title: cx.new(|cx| InputState::new(window, cx)),
            metadata_authors: cx.new(|cx| InputState::new(window, cx)),
            metadata_year: cx.new(|cx| InputState::new(window, cx)),
            metadata_doi: cx.new(|cx| InputState::new(window, cx)),
            home,
            settings,
            article: None,
            body: "".into(),
            status: "서재에서 논문을 선택하세요".into(),
            extensions: MarkdownExtensions::default(),
            notes: cx.new(|cx| {
                TextareaState::new(window, cx)
                    .placeholder("읽으며 떠오른 생각을 적으세요. 노트를 다시 작성해도 보존됩니다.")
            }),
            question: cx.new(|cx| {
                InputState::new(window, cx).placeholder("논문에서 더 알고 싶은 내용을 질문하세요")
            }),
            keywords: cx.new(|cx| {
                TextareaState::new(window, cx).placeholder("키워드를 한 줄에 하나씩 입력")
            }),
            history: vec![],
            tab: 0,
            inspector_tab: 0,
            more_actions: false,
            loaded_article: None,
            review_text: String::new(),
            notice: String::new(),
            job_action: String::new(),
            busy: false,
            cancel: Arc::new(AtomicBool::new(false)),
            sender,
            receiver,
            _poll: poll,
            source_visible: false,
            page: 1,
            page_image: None,
            page_loading: false,
            loaded_at: std::time::Instant::now(),
        }
    }
    pub(crate) fn clear(&mut self, cx: &mut Context<Self>) {
        self.save_notes(cx);
        self.cancel.store(true, Ordering::Relaxed);
        self.load_epoch += 1;
        self.article = None;
        self.loaded_article = None;
        self.body = "".into();
        self.blocks.clear();
        self.source_visible = false;
        cx.notify();
    }
    pub(crate) fn settings(&mut self, settings: Settings) {
        self.settings = settings;
    }
    pub(crate) fn select(&mut self, article: Article, window: &mut Window, cx: &mut Context<Self>) {
        self.save_notes(cx);
        self.article = Some(article.clone());
        self.keywords.update(cx, |input, cx| {
            input.set_value(article.keyword_list.join("\n"), window, cx)
        });
        for (input, value) in [
            (&self.metadata_title, article.title.clone()),
            (&self.metadata_authors, article.authors.clone()),
            (
                &self.metadata_year,
                article.year.map(|y| y.to_string()).unwrap_or_default(),
            ),
            (&self.metadata_doi, article.doi.clone()),
        ] {
            input.update(cx, |input, cx| input.set_value(value, window, cx));
        }
        self.body = "".into();
        self.blocks.clear();
        self.extensions = MarkdownExtensions::default();
        self.notes_changed_at = None;
        self.crop_mode = false;
        self.crop_rect = None;
        self.crop_start = None;
        self.crop_end = None;
        self.page_loading = false;
        self.loaded_article = None;
        self.review_text.clear();
        self.notice.clear();
        self.history.clear();
        self.tab = 0;
        self.page = 1;
        self.page_image = None;
        self.status = "노트를 읽고 있습니다".into();
        self.loaded_at = std::time::Instant::now();
        self.load();
        cx.notify();
    }
    fn load(&mut self) {
        self.load_epoch += 1;
        let epoch = self.load_epoch;
        let Some(article) = self.article.clone() else {
            return;
        };
        let home = self.home.clone();
        let sender = self.sender.clone();
        std::thread::spawn(move || {
            let result = (|| -> anyhow::Result<Loaded> {
                let library = Library::open(&home)?;
                let (body, status) = match reading::read_note(&article.path) {
                    Ok(note) => note,
                    Err(e) => {
                        let target = reading::output_path(&article.path);
                        if target.exists() {
                            return Err(e);
                        }
                        (
                            String::new(),
                            "아직 노트가 없습니다. ‘학습 노트 작성’을 눌러 시작하세요.".into(),
                        )
                    }
                };
                let body = reading::normalize(&body);
                let extensions = MarkdownExtensions::default();
                let review =
                    reading::review_description(&article.path).unwrap_or_else(|e| e.to_string());
                Ok(Loaded {
                    body,
                    status,
                    notes: library.notes(article.id)?,
                    history: library.messages(article.id)?,
                    extensions,
                    review,
                })
            })();
            let body = result.as_ref().ok().map(|loaded| loaded.body.clone());
            let _ = sender.send(Update::Loaded(
                article.id,
                epoch,
                result.map_err(|e| e.to_string()),
            ));
            if let Some(body) = body {
                let (extensions, warnings) = reader_format::prepare(&body, &home);
                let blocks = figures::blocks(&body, &article.path)
                    .unwrap_or_else(|_| vec![figures::Block::Text(body)]);
                let _ = sender.send(Update::Prepared(
                    article.id, epoch, extensions, blocks, warnings,
                ));
            }
        });
    }
    fn poll(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let mut changed = false;
        let mut latest_text = None;
        while let Ok(event) = self.receiver.try_recv() {
            changed = true;
            match event {
                Update::Loaded(id, epoch, result)
                    if epoch == self.load_epoch
                        && self.article.as_ref().is_some_and(|a| a.id == id) =>
                {
                    match result {
                        Ok(loaded) => {
                            self.body = loaded.body.into();
                            self.status = if self.notice.is_empty() {
                                loaded.status
                            } else {
                                format!("{} · {}", self.notice, loaded.status)
                            };
                            if self.loaded_article != Some(id) {
                                self.saved_notes = loaded.notes.clone();
                                self.observed_notes = loaded.notes.clone();
                                self.notes_changed_at = None;
                                self.notes.update(cx, |input, cx| {
                                    input.set_value(loaded.notes, window, cx)
                                });
                            }
                            self.loaded_article = Some(id);
                            self.review_text = loaded.review;
                            self.history = loaded.history;
                            self.extensions = loaded.extensions;
                        }
                        Err(e) => self.status = e,
                    }
                }
                Update::Prepared(id, epoch, extensions, blocks, warnings)
                    if epoch == self.load_epoch
                        && self.article.as_ref().is_some_and(|a| a.id == id) =>
                {
                    self.extensions = extensions;
                    self.blocks = blocks;
                    if !warnings.is_empty() {
                        self.status
                            .push_str(" · 일부 수식은 원문 표기로 표시됩니다");
                    }
                }
                Update::Text(id, text) if self.article.as_ref().is_some_and(|a| a.id == id) => {
                    latest_text = Some(text)
                }
                Update::Status(id, status) if self.article.as_ref().is_some_and(|a| a.id == id) => {
                    self.status = status
                }
                Update::Finished(id, result) => {
                    self.busy = false;
                    latest_text = None;
                    if self.article.as_ref().is_some_and(|a| a.id == id) {
                        match result {
                            Ok(status) => {
                                self.status = status;
                                self.load();
                            }
                            Err(e) => {
                                self.notice = e;
                                self.status = self.notice.clone();
                                self.load();
                            }
                        }
                    }
                }
                Update::Page(id, page, result)
                    if self.article.as_ref().is_some_and(|a| a.id == id) && self.page == page =>
                {
                    self.page_loading = false;
                    match result {
                        Ok(path) => self.page_image = Some(path),
                        Err(e) => {
                            self.status = e;
                            self.page = self.page.saturating_sub(1).max(1);
                        }
                    }
                }
                Update::Metadata(id, result)
                    if self.article.as_ref().is_some_and(|a| a.id == id) =>
                {
                    match result {
                        Ok(meta) => {
                            for (input, value) in [
                                (&self.metadata_title, meta.title),
                                (&self.metadata_authors, meta.authors),
                                (
                                    &self.metadata_year,
                                    meta.year.map(|y| y.to_string()).unwrap_or_default(),
                                ),
                                (&self.metadata_doi, meta.doi),
                            ] {
                                input.update(cx, |input, cx| input.set_value(value, window, cx));
                            }
                            self.status =
                                "Crossref 정보를 가져왔습니다. 내용을 확인하고 저장하세요.".into();
                        }
                        Err(e) => self.status = e,
                    }
                }
                _ => {}
            }
        }
        if let Some(text) = latest_text {
            if self.job_action == "ask" {
                if let Some(last) = self.history.last_mut()
                    && last.0 == "assistant"
                {
                    last.1 = text;
                }
            } else {
                self.blocks.clear();
                self.body = text.into();
            }
        }
        if self.loaded_article == self.article.as_ref().map(|a| a.id)
            && self.loaded_article.is_some()
        {
            let value = self.notes.read(cx).value().to_string();
            if value != self.observed_notes {
                self.observed_notes = value;
                self.notes_changed_at = Some(std::time::Instant::now());
            }
            if self
                .notes_changed_at
                .is_some_and(|t| t.elapsed() > Duration::from_millis(500))
            {
                self.save_notes(cx);
                self.notes_changed_at = None;
                changed = true;
            }
        }
        if changed {
            cx.notify();
        }
    }
    pub(crate) fn start(
        &mut self,
        action: &'static str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.busy {
            return;
        }
        let Some(article) = self.article.clone() else {
            return;
        };
        self.save_notes(cx);
        let question = self.question.read(cx).value().to_string();
        if action == "ask" && question.trim().is_empty() {
            return;
        }
        self.load_epoch += 1;
        self.notice.clear();
        self.busy = true;
        self.job_action = action.into();
        self.cancel = Arc::new(AtomicBool::new(false));
        self.status = match action {
            "review" => "원문과 대조하고 있습니다",
            "ask" => "질문에 답하고 있습니다",
            _ => "작성 준비 중 · 이전 노트는 보존됩니다",
        }
        .into();
        let (home, settings, cancel, sender) = (
            self.home.clone(),
            self.settings.clone(),
            self.cancel.clone(),
            self.sender.clone(),
        );
        let history = self.history.clone();
        if action == "ask" {
            self.inspector_tab = 1;
            self.history.push(("user".into(), question.clone()));
            self.history.push(("assistant".into(), String::new()));
            self.question
                .update(cx, |input, cx| input.set_value("", window, cx));
        } else {
            self.tab = if action == "review" { 3 } else { 0 };
        }
        std::thread::spawn(move || {
            let id = article.id;
            let mut last = std::time::Instant::now() - Duration::from_secs(1);
            let result = (|| -> anyhow::Result<String> {
                let mut on_text = |text: &str| {
                    if last.elapsed() > Duration::from_millis(100) {
                        let _ = sender.send(Update::Text(id, text.into()));
                        last = std::time::Instant::now();
                    }
                };
                match action {
                    "review" => {
                        let result = reading::review(&article, &settings, &home, cancel)?;
                        if result["passed"] == true {
                            Ok("원문 대조 완료".into())
                        } else {
                            Ok(format!("확인이 필요한 내용: {}", result["findings"]))
                        }
                    }
                    "ask" => {
                        let answer = reading::ask(
                            &article,
                            &settings,
                            &home,
                            &question,
                            &history,
                            cancel,
                            &mut on_text,
                        )?;
                        Library::open(&home)?.save_exchange(id, &question, &answer)?;
                        Ok("답변을 저장했습니다".into())
                    }
                    _ => {
                        reading::generate(
                            &article,
                            &settings,
                            &home,
                            cancel,
                            &mut on_text,
                            &mut |status| {
                                let _ = sender.send(Update::Status(id, status.into()));
                            },
                        )?;
                        Ok("학습 노트를 저장했습니다".into())
                    }
                }
            })();
            let _ = sender.send(Update::Finished(id, result.map_err(|e| e.to_string())));
        });
        cx.notify();
    }
    pub(crate) fn save_notes(&mut self, cx: &mut Context<Self>) {
        let Some(a) = &self.article else { return };
        if self.loaded_article != Some(a.id) {
            return;
        }
        let notes = self.notes.read(cx).value().to_string();
        if notes == self.saved_notes {
            return;
        }
        match Library::open(&self.home).and_then(|library| library.save_notes(a.id, &notes)) {
            Ok(()) => {
                self.saved_notes = notes;
                self.status = "메모를 저장했습니다".into();
            }
            Err(e) => self.status = format!("메모 저장 실패: {e}"),
        }
    }
    fn lookup_metadata(&mut self, cx: &mut Context<Self>) {
        let Some(article) = self.article.clone() else {
            return;
        };
        let doi = self.metadata_doi.read(cx).value().to_string();
        let sender = self.sender.clone();
        self.status = "DOI로 서지정보를 찾고 있습니다".into();
        std::thread::spawn(move || {
            let result = crate::metadata::lookup(&doi).map_err(|e| e.to_string());
            let _ = sender.send(Update::Metadata(article.id, result));
        });
        cx.notify();
    }
    fn save_metadata(&mut self, cx: &mut Context<Self>) {
        let Some(a) = self.article.as_mut() else {
            return;
        };
        let title = self.metadata_title.read(cx).value().trim().to_owned();
        if title.is_empty() {
            self.status = "제목을 입력하세요".into();
            cx.notify();
            return;
        }
        let authors = self.metadata_authors.read(cx).value().to_string();
        let doi = self.metadata_doi.read(cx).value().to_string();
        let year_text = self.metadata_year.read(cx).value().to_string();
        let year = if year_text.trim().is_empty() {
            None
        } else {
            match year_text.trim().parse::<i64>() {
                Ok(y) if (1000..=3000).contains(&y) => Some(y),
                _ => {
                    self.status = "연도를 확인하세요".into();
                    cx.notify();
                    return;
                }
            }
        };
        match Library::open(&self.home)
            .and_then(|l| l.update_metadata(a.id, &title, &authors, year, &doi))
        {
            Ok(()) => {
                a.title = title;
                a.authors = authors;
                a.year = year;
                a.doi = doi;
                self.status = "논문 정보를 저장했습니다".into();
            }
            Err(e) => self.status = e.to_string(),
        };
        cx.notify();
    }
    fn flag(&mut self, key: bool, cx: &mut Context<Self>) {
        if let Some(a) = &mut self.article {
            let value = if key { !a.is_key } else { !a.is_read };
            match Library::open(&self.home).and_then(|library| library.flag(a.id, key, value)) {
                Ok(()) => {
                    if key {
                        a.is_key = value
                    } else {
                        a.is_read = value
                    }
                    cx.emit(ArticleChanged(a.clone()));
                }
                Err(e) => self.status = e.to_string(),
            };
            cx.notify();
        }
    }
    fn source_page(&mut self, cx: &mut Context<Self>) {
        if self.page_loading {
            return;
        }
        let Some(article) = self.article.clone() else {
            return;
        };
        self.source_visible = true;
        self.page_loading = true;
        self.page_image = None;
        self.crop_rect = None;
        self.crop_start = None;
        self.crop_end = None;
        let (home, page, sender) = (self.home.clone(), self.page, self.sender.clone());
        std::thread::spawn(move || {
            let result = reading::render_page(&article.path, page, &home)
                .and_then(|path| {
                    let ratio = figures::png_aspect_ratio(&std::fs::read(&path)?)
                        .ok_or_else(|| anyhow::anyhow!("원문 이미지 크기를 읽지 못했습니다"))?;
                    Ok((path, ratio))
                })
                .map_err(|e| e.to_string());
            let _ = sender.send(Update::Page(article.id, page, result));
        });
        cx.notify();
    }
    fn restore(&mut self, cx: &mut Context<Self>) {
        let Some(article) = &self.article else { return };
        let target = reading::output_path(&article.path);
        let previous = target.with_file_name(format!(
            "{}.previous",
            target.file_name().unwrap().to_string_lossy()
        ));
        let result = std::fs::read(previous)
            .map_err(anyhow::Error::from)
            .and_then(|bytes| reading::atomic_write(&target, &bytes, true));
        match result {
            Ok(()) => self.load(),
            Err(_) => self.status = "복구할 이전 버전이 없습니다".into(),
        };
        cx.notify();
    }
    fn export(&mut self, cx: &mut Context<Self>) {
        let Some(article) = self.article.clone() else {
            return;
        };
        let (home, body, sender) = (
            self.home.clone(),
            self.body.to_string(),
            self.sender.clone(),
        );
        self.status = "HTML 파일을 만들고 있습니다".into();
        std::thread::spawn(move || {
            let target = reading::output_path(&article.path).with_extension("html");
            let status = match reader_format::export_html(
                &article.title,
                &body,
                &article.path,
                &home,
                &target,
            ) {
                Ok(()) => {
                    let _ = std::process::Command::new("/usr/bin/open")
                        .arg(&target)
                        .spawn();
                    "HTML 파일을 저장했습니다".into()
                }
                Err(e) => e.to_string(),
            };
            let _ = sender.send(Update::Status(article.id, status));
        });
        cx.notify();
    }
    fn crop_down(&mut self, event: &MouseDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        if !self.crop_mode {
            return;
        }
        if let Some(bounds) = self.crop_bounds {
            self.crop_start = Some(event.position - bounds.origin);
            self.crop_end = self.crop_start;
            self.crop_rect = None;
            cx.notify();
        }
    }
    fn crop_move(&mut self, event: &MouseMoveEvent, _: &mut Window, cx: &mut Context<Self>) {
        if self.crop_mode
            && self.crop_start.is_some()
            && event.pressed_button == Some(MouseButton::Left)
            && let Some(bounds) = self.crop_bounds
        {
            self.crop_end = Some(point(
                (event.position.x - bounds.origin.x).clamp(px(0.), bounds.size.width),
                (event.position.y - bounds.origin.y).clamp(px(0.), bounds.size.height),
            ));
            cx.notify();
        }
    }
    fn crop_up(&mut self, _: &MouseUpEvent, _: &mut Window, cx: &mut Context<Self>) {
        if let (Some(start), Some(end), Some(bounds)) =
            (self.crop_start, self.crop_end, self.crop_bounds)
        {
            let width = f32::from(bounds.size.width);
            let height = f32::from(bounds.size.height);
            let x = f32::from(start.x.min(end.x)).clamp(0., width) / width;
            let y = f32::from(start.y.min(end.y)).clamp(0., height) / height;
            let w = f32::from((end.x - start.x).abs()) / width;
            let h = f32::from((end.y - start.y).abs()) / height;
            if w > 0.02 && h > 0.02 {
                self.crop_rect = Some([x, y, w.min(1. - x), h.min(1. - y)]);
                self.status = "그림 전체와 축·범례가 포함되었는지 확인한 뒤 붙이세요".into();
            }
            cx.notify();
        }
    }
    fn attach_figure(&mut self, cx: &mut Context<Self>) {
        let (Some(article), Some(rect)) = (self.article.clone(), self.crop_rect) else {
            return;
        };
        let headings = figures::headings(&self.body);
        let Some(heading) = headings.get(self.figure_heading).cloned() else {
            return;
        };
        let caption = self.caption.read(cx).value().to_string();
        let caption = if caption.trim().is_empty() {
            format!("원문 {}쪽의 선택 영역", self.page)
        } else {
            caption
        };
        self.busy = true;
        self.status = "선택한 그림을 저장하고 있습니다".into();
        let (sender, page) = (self.sender.clone(), self.page);
        std::thread::spawn(move || {
            let result = figures::attach(&article.path, page, rect, &heading, &caption)
                .map(|_| "그림을 연결했습니다".into())
                .map_err(|e| e.to_string());
            let _ = sender.send(Update::Finished(article.id, result));
        });
        cx.notify();
    }
    fn note_style(&self) -> TextViewStyle {
        let mut style = TextViewStyle::default()
            .paragraph_gap(rems(1.05))
            .heading_font_size(|level, base| {
                base * match level {
                    1 => 1.85,
                    2 => 1.4,
                    3 => 1.2,
                    _ => 1.05,
                }
            });
        style.heading_base_font_size = px(self.font_size);
        style
    }
    fn note_content(&self, cx: &mut Context<Self>) -> AnyElement {
        if self.blocks.is_empty() {
            return TextView::markdown("learning-note", reader_format::display_body(&self.body))
                .markdown_extensions(self.extensions.clone())
                .style(self.note_style())
                .selectable(true)
                .on_link_click(|url, _, _, cx| {
                    if url.starts_with("https://") || url.starts_with("http://") {
                        cx.open_url(url);
                    }
                })
                .into_any_element();
        }
        div()
            .flex()
            .flex_col()
            .gap_3()
            .children(self.blocks.iter().enumerate().map(|(ix, block)| {
                match block {
                    figures::Block::Text(text) => {
                        TextView::markdown(("note-part", ix), reader_format::display_body(text))
                            .markdown_extensions(self.extensions.clone())
                            .style(self.note_style())
                            .selectable(true)
                            .on_link_click(|url, _, _, cx| {
                                if url.starts_with("https://") || url.starts_with("http://") {
                                    cx.open_url(url);
                                }
                            })
                            .into_any_element()
                    }
                    figures::Block::Figure(f, path, context) => div()
                        .flex()
                        .flex_wrap()
                        .items_start()
                        .gap_6()
                        .my_4()
                        .pl_4()
                        .border_l_2()
                        .border_color(cx.theme().primary)
                        .child(
                            div()
                                .w(rems(20.))
                                .max_w_full()
                                .flex_shrink_0()
                                .flex()
                                .flex_col()
                                .gap_2()
                                .child(
                                    div()
                                        .w_full()
                                        .aspect_ratio(f.aspect_ratio)
                                        .relative()
                                        .child(
                                            img(path.clone())
                                                .absolute()
                                                .size_full()
                                                .object_fit(ObjectFit::Contain),
                                        ),
                                )
                                .child(
                                    div()
                                        .text_sm()
                                        .text_color(cx.theme().muted_foreground)
                                        .child(format!("{} · 원문 {}쪽", f.caption, f.page)),
                                ),
                        )
                        .when(!context.is_empty(), |view| {
                            view.child(
                                div().flex_1().min_w(rems(16.)).child(
                                    TextView::markdown(
                                        ("figure-context", ix),
                                        reader_format::display_body(context),
                                    )
                                    .markdown_extensions(self.extensions.clone())
                                    .style(self.note_style())
                                    .selectable(true)
                                    .on_link_click(
                                        |url, _, _, cx| {
                                            if url.starts_with("https://")
                                                || url.starts_with("http://")
                                            {
                                                cx.open_url(url);
                                            }
                                        },
                                    ),
                                ),
                            )
                        })
                        .into_any_element(),
                }
            }))
            .into_any_element()
    }
    pub(crate) fn zoom(&mut self, delta: f32, cx: &mut Context<Self>) {
        self.font_size = (self.font_size + delta).clamp(13., 28.);
        cx.notify();
    }
    pub(crate) fn close_auxiliary(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        self.source_visible = false;
        self.crop_mode = false;
        self.tab = 0;
        cx.notify();
    }
    fn export_zip(&mut self, cx: &mut Context<Self>) {
        let Some(article) = self.article.clone() else {
            return;
        };
        let sender = self.sender.clone();
        self.status = "논문 꾸러미를 저장하고 있습니다".into();
        std::thread::spawn(move || {
            let result = crate::exports::article_zip(&article);
            let message = match result {
                Ok(path) => {
                    let _ = std::process::Command::new("/usr/bin/open")
                        .arg("-R")
                        .arg(path)
                        .spawn();
                    "PDF·노트·그림·서지정보를 ZIP으로 저장했습니다".into()
                }
                Err(e) => e.to_string(),
            };
            let _ = sender.send(Update::Status(article.id, message));
        });
        cx.notify();
    }
    fn content(&self, tab: u8, cx: &mut Context<Self>) -> AnyElement {
        match tab {
            1 => div()
                .flex()
                .flex_col()
                .gap_6()
                .children(self.history.iter().enumerate().map(|(ix, (role, text))| {
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .child(div().text_sm().font_weight(FontWeight::SEMIBOLD).child(
                            if role == "user" {
                                "나의 질문"
                            } else {
                                "논문과 함께 읽기"
                            },
                        ))
                        .child(
                            TextView::markdown(("message", ix), reader_format::display_body(text))
                                .selectable(true)
                                .on_link_click(|url, _, _, cx| {
                                    if url.starts_with("https://") || url.starts_with("http://") {
                                        cx.open_url(url);
                                    }
                                }),
                        )
                }))
                .into_any_element(),
            2 => div()
                .flex()
                .flex_col()
                .gap_4()
                .child("나의 메모")
                .child(
                    div()
                        .text_sm()
                        .text_color(cx.theme().muted_foreground)
                        .child("요약을 다시 작성해도 이 메모는 바뀌지 않습니다."),
                )
                .child(
                    Textarea::new(&self.notes)
                        .disabled(self.loaded_article != self.article.as_ref().map(|a| a.id))
                        .h(rems(24.)),
                )
                .child(
                    Button::new("save-notes")
                        .label("메모 저장")
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.save_notes(cx);
                            cx.notify();
                        })),
                )
                .child("키워드")
                .child(
                    div()
                        .text_xs()
                        .text_color(cx.theme().muted_foreground)
                        .child("한 줄에 하나씩 입력하세요. 키워드 안의 쉼표는 그대로 보존합니다."),
                )
                .child(Textarea::new(&self.keywords).h(rems(9.)))
                .child(
                    Button::new("save-keywords")
                        .label("키워드 저장")
                        .on_click(cx.listener(|this, _, _, cx| {
                            if let Some(a) = &this.article {
                                let words = this
                                    .keywords
                                    .read(cx)
                                    .value()
                                    .lines()
                                    .map(str::trim)
                                    .filter(|s| !s.is_empty())
                                    .map(str::to_owned)
                                    .collect::<Vec<_>>();
                                match Library::open(&this.home)
                                    .and_then(|mut l| l.set_keyword_list(a.id, &words))
                                {
                                    Ok(()) => {
                                        this.status = "키워드를 저장했습니다".into();
                                        if let Some(a) = &mut this.article {
                                            a.keywords = words.join(", ");
                                            a.keyword_list = words;
                                            cx.emit(ArticleChanged(a.clone()));
                                        }
                                    }
                                    Err(e) => this.status = e.to_string(),
                                };
                                cx.notify();
                            }
                        })),
                )
                .into_any_element(),
            3 => TextView::markdown(
                "review-result",
                reader_format::display_body(&self.review_text),
            )
            .into_any_element(),
            4 => div()
                .flex()
                .flex_col()
                .gap_3()
                .child("제목")
                .child(Input::new(&self.metadata_title))
                .child("저자")
                .child(Input::new(&self.metadata_authors))
                .child("연도")
                .child(Input::new(&self.metadata_year))
                .child("DOI")
                .child(Input::new(&self.metadata_doi))
                .child(
                    Button::new("lookup-doi")
                        .label("DOI로 정보 가져오기")
                        .on_click(cx.listener(|this, _, _, cx| this.lookup_metadata(cx))),
                )
                .child(
                    Button::new("save-metadata")
                        .label("논문 정보 저장")
                        .on_click(cx.listener(|this, _, _, cx| this.save_metadata(cx))),
                )
                .into_any_element(),
            _ => self.note_content(cx),
        }
    }
}
impl Render for ReaderView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(article) = self.article.clone() else {
            return div().size_full().flex().items_center().justify_center().child(div().max_w(rems(32.)).flex().flex_col().gap_4().child(div().text_2xl().child("논문에서 배우는 시간")).child("논문을 선택하면 기존 노트를 읽거나 새로운 학습 노트를 작성할 수 있습니다.")).into_any_element();
        };
        let content = if self.body.is_empty() && self.tab == 0 {
            div().py_16().flex().flex_col().items_center().gap_4()
                .child(Icon::new(IconName::BookOpen).size_12().text_color(cx.theme().primary.opacity(0.6)))
                .child(div().text_xl().font_weight(FontWeight::SEMIBOLD).child("이 논문을 함께 읽어볼까요"))
                .child(div().max_w(rems(26.)).text_sm().text_color(cx.theme().muted_foreground).child("핵심 아이디어부터 방법과 결과까지, 흐름을 따라 이해할 수 있는 학습 노트를 작성합니다."))
                .into_any_element()
        } else {
            self.content(self.tab, cx)
        };
        let source_only = self.source_visible && window.viewport_size().width < px(1100.);
        let mut reader = div()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .flex()
            .items_stretch()
            .when(!source_only, |view| {
                view.child(
                    div()
                        .id("note-scroll")
                        .bg(if cx.theme().is_dark() {
                            rgb(0x1e222a).into()
                        } else {
                            cx.theme().background
                        })
                        .flex_1()
                        .min_w_0()
                        .overflow_y_scroll()
                        .child(
                            div()
                                .max_w(rems(52.))
                                .mx_auto()
                                .p_6()
                                .text_size(px(self.font_size))
                                .line_height(relative(1.85))
                                .child(content),
                        ),
                )
            });
        if self.source_visible {
            reader = reader.child(
                div()
                    .w(if source_only { rems(52.) } else { rems(23.) })
                    .max_w_full()
                    .min_w(rems(15.))
                    .h_full()
                    .flex()
                    .flex_col()
                    .border_l_1()
                    .border_color(cx.theme().border)
                    .child(
                        div()
                            .p_3()
                            .flex()
                            .gap_2()
                            .items_center()
                            .child(
                                Button::new("page-prev")
                                    .small()
                                    .label("이전")
                                    .disabled(self.page <= 1 || self.page_loading)
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.page -= 1;
                                        this.source_page(cx)
                                    })),
                            )
                            .child(format!("{}쪽", self.page))
                            .child(
                                Button::new("page-next")
                                    .small()
                                    .label("다음")
                                    .disabled(self.page_loading)
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.page += 1;
                                        this.source_page(cx)
                                    })),
                            )
                            .child(
                                Button::new("source-close")
                                    .small()
                                    .ghost()
                                    .label("닫기")
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.source_visible = false;
                                        cx.notify()
                                    })),
                            ),
                    )
                    .child(
                        div()
                            .px_3()
                            .pb_3()
                            .flex()
                            .flex_col()
                            .gap_2()
                            .child(
                                Button::new("crop-mode")
                                    .small()
                                    .label(if self.crop_mode {
                                        "그림 선택 끝내기"
                                    } else {
                                        "그림 영역 선택"
                                    })
                                    .disabled(self.busy || self.body.is_empty())
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.crop_mode = !this.crop_mode;
                                        cx.notify();
                                    })),
                            )
                            .when(self.crop_mode, |view| {
                                let headings = figures::headings(&self.body);
                                view.child(
                                    div()
                                        .text_xs()
                                        .child("그림 전체를 드래그한 뒤 연결할 절을 선택하세요."),
                                )
                                .child(
                                    Button::new("figure-heading")
                                        .small()
                                        .label(
                                            headings
                                                .get(self.figure_heading)
                                                .map(|h| {
                                                    h.trim_start_matches('#').trim().to_owned()
                                                })
                                                .unwrap_or_else(|| "연결할 절".into()),
                                        )
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            let n = figures::headings(&this.body).len();
                                            if n > 0 {
                                                this.figure_heading = (this.figure_heading + 1) % n;
                                            }
                                            cx.notify();
                                        })),
                                )
                                .child(Input::new(&self.caption))
                                .child(
                                    Button::new("attach-figure")
                                        .small()
                                        .label("선택 영역 붙이기")
                                        .disabled(self.busy || self.crop_rect.is_none())
                                        .on_click(
                                            cx.listener(|this, _, _, cx| this.attach_figure(cx)),
                                        ),
                                )
                                .child(
                                    Button::new("remove-figure")
                                        .small()
                                        .ghost()
                                        .label("마지막 그림 연결 해제")
                                        .disabled(self.busy)
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            if let Some(a) = &this.article {
                                                match figures::remove_last(&a.path) {
                                                    Ok(()) => this.load(),
                                                    Err(e) => this.status = e.to_string(),
                                                };
                                                cx.notify();
                                            }
                                        })),
                                )
                            }),
                    )
                    .child(
                        div()
                            .id("page-scroll")
                            .flex_1()
                            .min_h_0()
                            .overflow_y_scroll()
                            .children(self.page_image.clone().map(|(p, aspect_ratio)| {
                                let entity = cx.entity();
                                let mut picture = div()
                                    .id("crop-surface")
                                    .w_full()
                                    .aspect_ratio(aspect_ratio)
                                    .relative()
                                    .on_prepaint(move |bounds, _, cx| {
                                        entity.update(cx, |this, _| this.crop_bounds = Some(bounds))
                                    })
                                    .on_mouse_down(MouseButton::Left, cx.listener(Self::crop_down))
                                    .on_mouse_move(cx.listener(Self::crop_move))
                                    .on_mouse_up(MouseButton::Left, cx.listener(Self::crop_up))
                                    .child(
                                        img(p)
                                            .absolute()
                                            .size_full()
                                            .object_fit(ObjectFit::Contain),
                                    );
                                if self.crop_mode {
                                    picture = picture.cursor_crosshair();
                                    if let (Some(start), Some(end)) =
                                        (self.crop_start, self.crop_end)
                                    {
                                        picture = picture.child(
                                            div()
                                                .absolute()
                                                .left(start.x.min(end.x))
                                                .top(start.y.min(end.y))
                                                .w((end.x - start.x).abs())
                                                .h((end.y - start.y).abs())
                                                .border_2()
                                                .border_color(cx.theme().primary),
                                        );
                                    }
                                }
                                picture
                            })),
                    ),
            );
        }
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .child(
                div()
                    .px_4()
                    .py_3()
                    .flex()
                    .items_center()
                    .gap_3()
                    .border_b_1()
                    .border_color(cx.theme().border)
                    .bg(cx.theme().sidebar)
                    .child(
                        ui::tool("back-library", IconName::ArrowLeft, "논문 목록으로").on_click(
                            |_, w, cx| w.dispatch_action(Box::new(crate::CloseStudy), cx),
                        ),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(
                                div()
                                    .text_sm()
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .truncate()
                                    .child(article.title.clone()),
                            )
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(cx.theme().muted_foreground)
                                    .truncate()
                                    .child(format!(
                                        "{} · {}",
                                        article.authors,
                                        article.year.map(|y| y.to_string()).unwrap_or_default()
                                    )),
                            ),
                    )
                    .child(
                        ui::tool(
                            "reader-sidebar",
                            IconName::PanelLeft,
                            "키워드 패널 표시 / 숨기기",
                        )
                        .on_click(|_, w, cx| w.dispatch_action(Box::new(crate::ToggleLibrary), cx)),
                    )
                    .child(
                        ui::tool(
                            "reader-inspector",
                            IconName::PanelRight,
                            "상세 패널 표시 / 숨기기",
                        )
                        .on_click(|_, w, cx| {
                            w.dispatch_action(Box::new(crate::ToggleInspector), cx)
                        }),
                    ),
            )
            .child(
                div()
                    .px_4()
                    .py_2()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap_2()
                    .border_b_1()
                    .border_color(cx.theme().border)
                    .child(
                        Button::new("write-note")
                            .small()
                            .primary()
                            .icon(IconName::NotebookPen)
                            .label(if self.body.is_empty() {
                                "학습 노트 작성"
                            } else {
                                "다시 작성"
                            })
                            .disabled(
                                self.busy
                                    || self.loaded_article != self.article.as_ref().map(|a| a.id),
                            )
                            .on_click(cx.listener(|this, _, w, cx| this.start("generate", w, cx))),
                    )
                    .child(
                        Button::new("reader-learning")
                            .ghost()
                            .small()
                            .label("학습 노트")
                            .selected(self.tab == 0)
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.tab = 0;
                                cx.notify();
                            })),
                    )
                    .when(!self.review_text.is_empty(), |v| {
                        v.child(
                            Button::new("reader-review")
                                .ghost()
                                .small()
                                .label("원문 대조 결과")
                                .selected(self.tab == 3)
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.tab = 3;
                                    cx.notify();
                                })),
                        )
                    })
                    .child(div().flex_1())
                    .child(
                        ui::tool(
                            "source",
                            IconName::PanelsTopLeft,
                            "원문 함께 보기 / 그림 연결",
                        )
                        .selected(self.source_visible)
                        .on_click(cx.listener(|this, _, _, cx| {
                            if this.source_visible {
                                this.source_visible = false;
                                cx.notify();
                            } else {
                                this.source_page(cx);
                            }
                        })),
                    )
                    .child(
                        ui::tool("open-pdf", IconName::FileText, "원본 PDF 열기")
                            .on_click(move |_, _, cx| cx.open_with_system(&article.path)),
                    )
                    .child(
                        ui::tool("export-html", IconName::Download, "HTML 내보내기")
                            .disabled(self.busy || self.body.is_empty())
                            .on_click(cx.listener(|this, _, _, cx| this.export(cx))),
                    )
                    .child(
                        ui::tool("reader-smaller", IconName::Minus, "본문 작게")
                            .on_click(cx.listener(|this, _, _, cx| this.zoom(-1., cx))),
                    )
                    .child(
                        ui::tool("reader-larger", IconName::Plus, "본문 크게")
                            .on_click(cx.listener(|this, _, _, cx| this.zoom(1., cx))),
                    )
                    .child(
                        ui::tool("reader-more", IconName::Ellipsis, "추가 작업")
                            .selected(self.more_actions)
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.more_actions = !this.more_actions;
                                cx.notify();
                            })),
                    ),
            )
            .when(self.more_actions, |v| {
                v.child(
                    div()
                        .px_4()
                        .py_2()
                        .flex()
                        .flex_wrap()
                        .gap_2()
                        .bg(cx.theme().sidebar)
                        .border_b_1()
                        .border_color(cx.theme().border)
                        .child(
                            Button::new("review-note")
                                .small()
                                .ghost()
                                .icon(IconName::CheckCheck)
                                .label("원문 대조")
                                .disabled(self.busy || self.body.is_empty())
                                .on_click(cx.listener(|this, _, w, cx| {
                                    this.more_actions = false;
                                    this.start("review", w, cx);
                                })),
                        )
                        .child(
                            Button::new("export-zip")
                                .small()
                                .ghost()
                                .icon(IconName::Archive)
                                .label("논문 ZIP 저장")
                                .disabled(self.busy)
                                .on_click(cx.listener(|this, _, _, cx| this.export_zip(cx))),
                        )
                        .child(
                            Button::new("restore-note")
                                .small()
                                .ghost()
                                .icon(IconName::RotateCcw)
                                .label("이전 버전 복구")
                                .disabled(self.busy)
                                .on_click(cx.listener(|this, _, _, cx| this.restore(cx))),
                        ),
                )
            })
            .child(reader)
            .child(
                div()
                    .px_4()
                    .py_2()
                    .border_t_1()
                    .border_color(cx.theme().border)
                    .flex()
                    .gap_2()
                    .items_center()
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .text_xs()
                            .text_color(cx.theme().muted_foreground)
                            .child(self.status.clone()),
                    )
                    .when(self.busy, |view| {
                        view.child(Button::new("cancel").small().label("취소").on_click(
                            cx.listener(|this, _, _, cx| {
                                this.cancel.store(true, Ordering::Relaxed);
                                this.status = "취소 중 · 이전 노트는 유지됩니다".into();
                                cx.notify();
                            }),
                        ))
                    }),
            )
            .into_any_element()
    }
}

impl ReaderView {
    pub(crate) fn show_note(&mut self, cx: &mut Context<Self>) {
        self.tab = 0;
        cx.notify();
    }
    fn inspector(&mut self, _: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let Some(article) = self.article.clone() else {
            return div()
                .size_full()
                .bg(cx.theme().sidebar)
                .flex()
                .items_center()
                .justify_center()
                .child(
                    div()
                        .p_6()
                        .flex()
                        .flex_col()
                        .items_center()
                        .gap_4()
                        .text_color(cx.theme().muted_foreground)
                        .child(Icon::new(IconName::Files).size_12().opacity(0.45))
                        .child(
                            div()
                                .text_sm()
                                .child("논문을 선택하면 상세 정보가 표시됩니다"),
                        ),
                )
                .into_any_element();
        };
        let details = if self.inspector_tab == 0 {
            let doi = article.doi.clone();
            let pdf = article.path.clone();
            div()
                .flex()
                .flex_col()
                .gap_5()
                .child(
                    div()
                        .text_size(px(20.))
                        .font_weight(FontWeight::BOLD)
                        .line_height(relative(1.4))
                        .child(article.title.clone()),
                )
                .child(
                    div()
                        .text_sm()
                        .line_height(relative(1.6))
                        .child(article.authors.clone()),
                )
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .items_center()
                        .gap_2()
                        .text_xs()
                        .text_color(cx.theme().muted_foreground)
                        .child(
                            div()
                                .rounded_full()
                                .px_2()
                                .py_1()
                                .bg(cx.theme().muted)
                                .child(
                                    article
                                        .year
                                        .map(|y| y.to_string())
                                        .unwrap_or_else(|| "연도 미확인".into()),
                                ),
                        )
                        .child(article.journal.clone()),
                )
                .when(!doi.is_empty(), |v| {
                    v.child(
                        Button::new("detail-doi")
                            .ghost()
                            .small()
                            .w_full()
                            .accessibility_label(format!("DOI {doi}"))
                            .child(
                                div()
                                    .w_full()
                                    .truncate()
                                    .text_color(cx.theme().primary)
                                    .child(format!("DOI  {doi}")),
                            )
                            .on_click(move |_, _, cx| {
                                cx.open_url(&format!("https://doi.org/{doi}"))
                            }),
                    )
                })
                .child(
                    Button::new("detail-open-note")
                        .small()
                        .icon(IconName::BookOpen)
                        .label("학습 노트 열기")
                        .on_click(|_, w, cx| {
                            w.dispatch_action(Box::new(crate::OpenCurrentStudy), cx)
                        }),
                )
                .child(
                    div()
                        .border_t_1()
                        .border_color(cx.theme().border)
                        .pt_3()
                        .child(
                            Button::new("detail-pdf")
                                .ghost()
                                .small()
                                .w_full()
                                .accessibility_label("원문 PDF 열기")
                                .icon(IconName::FileText)
                                .child(
                                    div()
                                        .w_full()
                                        .truncate()
                                        .text_xs()
                                        .text_color(cx.theme().muted_foreground)
                                        .child(
                                            pdf.file_name()
                                                .map(|s| s.to_string_lossy().into_owned())
                                                .unwrap_or_default(),
                                        ),
                                )
                                .on_click(move |_, _, cx| cx.open_with_system(&pdf)),
                        ),
                )
                .when(!article.abstract_text.is_empty(), |v| {
                    v.child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_3()
                            .child(
                                div()
                                    .text_xs()
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(cx.theme().muted_foreground)
                                    .child("ABSTRACT"),
                            )
                            .child(
                                TextView::markdown(
                                    "article-abstract",
                                    article.abstract_text.clone(),
                                )
                                .selectable(true)
                                .text_sm()
                                .text_color(cx.theme().muted_foreground),
                            ),
                    )
                })
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_3()
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .child(
                                    div()
                                        .text_xs()
                                        .font_weight(FontWeight::SEMIBOLD)
                                        .text_color(cx.theme().muted_foreground)
                                        .child("KEYWORDS"),
                                )
                                .child(
                                    ui::tool("edit-keywords", IconName::Pencil, "키워드 편집")
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.inspector_tab = 2;
                                            cx.notify();
                                        })),
                                ),
                        )
                        .child(
                            div().flex().flex_wrap().gap_2().children(
                                article
                                    .keyword_list
                                    .iter()
                                    .map(|w| w.trim())
                                    .filter(|s| !s.is_empty())
                                    .map(|word| {
                                        div()
                                            .px_2()
                                            .py_1()
                                            .rounded_md()
                                            .border_1()
                                            .border_color(cx.theme().border)
                                            .bg(cx.theme().muted.opacity(0.45))
                                            .text_xs()
                                            .child(word.to_owned())
                                    }),
                            ),
                        ),
                )
                .into_any_element()
        } else {
            self.content(self.inspector_tab, cx)
        };
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(cx.theme().sidebar)
            .child(
                div()
                    .px_3()
                    .py_3()
                    .flex()
                    .items_center()
                    .gap_1()
                    .border_b_1()
                    .border_color(cx.theme().border)
                    .child(
                        ui::tool("detail-key", IconName::Star, "중요 논문")
                            .selected(article.is_key)
                            .when(article.is_key, |b| b.text_color(rgb(0xfacc70)))
                            .on_click(cx.listener(|this, _, _, cx| this.flag(true, cx))),
                    )
                    .child(
                        ui::tool("detail-read", IconName::Check, "읽음 표시")
                            .selected(article.is_read)
                            .on_click(cx.listener(|this, _, _, cx| this.flag(false, cx))),
                    )
                    .child(div().mx_2().w(px(1.)).h(px(20.)).bg(cx.theme().border))
                    .children(
                        [
                            (0, IconName::Info, "논문 정보"),
                            (1, IconName::MessagesSquare, "논문에 질문"),
                            (2, IconName::NotebookPen, "나의 메모"),
                            (4, IconName::Pencil, "정보 편집"),
                        ]
                        .into_iter()
                        .map(|(tab, icon, label)| {
                            Button::new(("inspector-tab", tab as u64))
                                .ghost()
                                .small()
                                .icon(icon)
                                .tooltip(label)
                                .accessibility_label(label)
                                .selected(self.inspector_tab == tab)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.inspector_tab = tab;
                                    cx.notify();
                                }))
                        }),
                    )
                    .child(div().flex_1())
                    .child(
                        ui::tool(
                            "close-inspector",
                            IconName::PanelRightClose,
                            "상세 패널 닫기",
                        )
                        .on_click(|_, w, cx| {
                            w.dispatch_action(Box::new(crate::ToggleInspector), cx)
                        }),
                    ),
            )
            .child(
                div()
                    .id("inspector-scroll")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .p_5()
                    .text_sm()
                    .line_height(relative(1.65))
                    .child(details),
            )
            .when(self.inspector_tab == 1, |v| {
                v.child(
                    div()
                        .p_3()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .border_t_1()
                        .border_color(cx.theme().border)
                        .when(self.history.is_empty(), |v| {
                            v.child(
                                div()
                                    .text_xs()
                                    .text_color(cx.theme().muted_foreground)
                                    .child("논문의 방법, 수식, 결과를 자유롭게 질문하세요."),
                            )
                        })
                        .child(Input::new(&self.question))
                        .child(
                            Button::new("ask-paper")
                                .primary()
                                .small()
                                .icon(IconName::Send)
                                .label("질문하기")
                                .disabled(self.busy)
                                .on_click(cx.listener(|this, _, w, cx| this.start("ask", w, cx))),
                        ),
                )
            })
            .child(
                div()
                    .px_4()
                    .py_2()
                    .border_t_1()
                    .border_color(cx.theme().border)
                    .flex()
                    .gap_2()
                    .items_center()
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .text_xs()
                            .text_color(cx.theme().muted_foreground)
                            .line_clamp(2)
                            .child(self.status.clone()),
                    )
                    .when(self.busy, |v| {
                        v.child(
                            ui::tool("inspector-cancel", IconName::Square, "작업 취소").on_click(
                                cx.listener(|this, _, _, cx| {
                                    this.cancel.store(true, Ordering::Relaxed);
                                    cx.notify();
                                }),
                            ),
                        )
                    }),
            )
            .into_any_element()
    }
}
pub(crate) struct InspectorView {
    reader: Entity<ReaderView>,
    _subscription: Subscription,
}
impl InspectorView {
    pub(crate) fn new(reader: Entity<ReaderView>, cx: &mut Context<Self>) -> Self {
        let subscription = cx.observe(&reader, |_, _, cx| cx.notify());
        Self {
            reader,
            _subscription: subscription,
        }
    }
}
impl Render for InspectorView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.reader.update(cx, |r, cx| r.inspector(window, cx))
    }
}
