use crate::library::{Article, Library};
use crate::ui;
use gpui_kit::assets::IconName;
use gpui_kit::component::Icon;
use gpui_kit::component::button::ButtonVariants;
use gpui_kit::component::{
    ActiveTheme, Disableable, Selectable, Sizable,
    button::Button,
    input::{Input, InputEvent, InputState},
    v_virtual_list,
};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use std::collections::BTreeMap;
use std::{path::PathBuf, rc::Rc, sync::mpsc, time::Duration};
#[derive(Clone)]
pub(crate) struct Selected(pub(crate) Article);
#[derive(Clone)]
pub(crate) struct OpenStudy(pub(crate) Article);
pub(crate) struct LibraryView {
    home: PathBuf,
    root: PathBuf,
    search: Entity<InputState>,
    tag_search: Entity<InputState>,
    tag_query: String,
    nav_tab: u8,
    keyword: Option<String>,
    folder: Option<PathBuf>,
    keywords: Vec<(String, usize)>,
    folders: Vec<(PathBuf, usize)>,
    show_authors: bool,
    sort: u8,
    descending: bool,
    articles: Vec<Article>,
    filtered: Vec<usize>,
    sizes: Rc<Vec<Size<Pixels>>>,
    selected: Option<i64>,
    status: String,
    query: String,
    filter: u8,
    results: mpsc::Receiver<(u64, bool, Result<Vec<Article>, String>)>,
    sender: mpsc::Sender<(u64, bool, Result<Vec<Article>, String>)>,
    busy: bool,
    epoch: u64,
    _subscriptions: Vec<Subscription>,
    _poll: Task<()>,
    watcher: Option<notify::RecommendedWatcher>,
    watch_events: mpsc::Receiver<()>,
    watch_sender: mpsc::Sender<()>,
    dirty_at: Option<std::time::Instant>,
}
impl EventEmitter<Selected> for LibraryView {}
impl EventEmitter<OpenStudy> for LibraryView {}
impl LibraryView {
    pub(crate) fn new(
        home: PathBuf,
        root: PathBuf,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let search = cx.new(|cx| InputState::new(window, cx).placeholder("제목·저자·키워드 검색"));
        let subscription = cx.subscribe(&search, |this, state, event, cx| {
            if matches!(event, InputEvent::Change) {
                this.query = state.read(cx).value().to_string().to_lowercase();
                this.filter(cx);
            }
        });
        let tag_search = cx.new(|cx| InputState::new(window, cx).placeholder("키워드 검색…"));
        let tag_subscription = cx.subscribe(&tag_search, |this, state, event, cx| {
            if matches!(event, InputEvent::Change) {
                this.tag_query = state.read(cx).value().to_lowercase();
                cx.notify();
            }
        });
        let (sender, results) = mpsc::channel();
        let (watch_sender, watch_events) = mpsc::channel();
        let poll = cx.spawn(async move |weak, cx| {
            loop {
                cx.background_executor()
                    .timer(Duration::from_millis(150))
                    .await;
                if weak
                    .update(cx, |this, cx| {
                        while this.watch_events.try_recv().is_ok() {
                            this.dirty_at = Some(std::time::Instant::now());
                        }
                        if !this.busy
                            && this
                                .dirty_at
                                .is_some_and(|at| at.elapsed() > Duration::from_millis(600))
                        {
                            this.dirty_at = None;
                            this.refresh(cx);
                        }
                        while let Ok((epoch, finished, result)) = this.results.try_recv() {
                            if epoch != this.epoch {
                                continue;
                            }
                            this.busy = !finished;
                            match result {
                                Ok(items) => {
                                    this.articles = items;
                                    this.status = format!(
                                        "{}편{}",
                                        this.articles.len(),
                                        if finished {
                                            ""
                                        } else {
                                            " · 변경 확인 중"
                                        }
                                    );
                                    this.filter(cx)
                                }
                                Err(e) => this.status = e,
                            };
                            cx.notify();
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        });
        let mut this = Self {
            home,
            root,
            search,
            tag_search,
            tag_query: String::new(),
            nav_tab: 0,
            keyword: None,
            folder: None,
            keywords: vec![],
            folders: vec![],
            show_authors: true,
            sort: 2,
            descending: true,
            articles: vec![],
            filtered: vec![],
            sizes: Rc::new(vec![]),
            selected: None,
            status: "논문 폴더를 여세요".into(),
            query: String::new(),
            filter: 0,
            results,
            sender,
            busy: false,
            epoch: 0,
            _subscriptions: vec![subscription, tag_subscription],
            _poll: poll,
            watcher: None,
            watch_events,
            watch_sender,
            dirty_at: None,
        };
        this.install_watcher();
        if this.root.is_dir() {
            this.refresh(cx)
        };
        this
    }
    fn install_watcher(&mut self) {
        use notify::Watcher;
        self.watcher = None;
        if !self.root.is_dir() {
            return;
        }
        let sender = self.watch_sender.clone();
        if let Ok(mut watcher) =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                if let Ok(event) = event
                    && event
                        .paths
                        .iter()
                        .any(|p| p.extension().is_some_and(|s| s.eq_ignore_ascii_case("pdf")))
                {
                    let _ = sender.send(());
                }
            })
            && watcher
                .watch(&self.root, notify::RecursiveMode::Recursive)
                .is_ok()
        {
            self.watcher = Some(watcher);
        }
    }
    pub(crate) fn set_root(&mut self, root: PathBuf, cx: &mut Context<Self>) {
        self.root = root;
        self.epoch += 1;
        self.busy = false;
        self.articles.clear();
        self.keyword = None;
        self.folder = None;
        self.filter(cx);
        self.selected = None;
        self.install_watcher();
        self.refresh(cx);
    }
    pub(crate) fn refresh(&mut self, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        self.busy = true;
        self.status = "논문 목록을 읽고 있습니다".into();
        let (home, root, sender) = (self.home.clone(), self.root.clone(), self.sender.clone());
        self.epoch += 1;
        let epoch = self.epoch;
        std::thread::spawn(move || {
            let result = (|| {
                let mut library = Library::open(&home)?;
                let _ = sender.send((
                    epoch,
                    false,
                    library.articles(&root).map_err(|e| e.to_string()),
                ));
                library.scan(&root)?;
                library.articles(&root)
            })();
            let _ = sender.send((
                epoch,
                true,
                result.map_err(|e: anyhow::Error| e.to_string()),
            ));
        });
        cx.notify();
    }
    fn filter(&mut self, cx: &mut Context<Self>) {
        self.filtered = self
            .articles
            .iter()
            .enumerate()
            .filter(|(_, a)| {
                (self
                    .keyword
                    .as_ref()
                    .is_none_or(|k| a.keyword_list.iter().any(|w| w == k)))
                    && self.folder.as_ref().is_none_or(|f| a.path.starts_with(f))
                    && (self.filter != 1 || a.is_key)
                    && (self.filter != 2 || !a.is_read)
                    && (self.query.is_empty()
                        || format!("{} {} {}", a.title, a.authors, a.keywords)
                            .to_lowercase()
                            .contains(&self.query))
            })
            .map(|(ix, _)| ix)
            .collect();
        self.filtered.sort_by(|a, b| {
            let (a, b) = (&self.articles[*a], &self.articles[*b]);
            let ordering = match self.sort {
                0 => a.title.to_lowercase().cmp(&b.title.to_lowercase()),
                1 => a.authors.to_lowercase().cmp(&b.authors.to_lowercase()),
                3 => a.is_key.cmp(&b.is_key),
                _ => a.year.cmp(&b.year),
            };
            (if self.descending {
                ordering.reverse()
            } else {
                ordering
            })
            .then_with(|| a.title.cmp(&b.title))
        });
        let mut tags = BTreeMap::<String, usize>::new();
        let mut folders = BTreeMap::<PathBuf, usize>::new();
        for a in &self.articles {
            for word in a
                .keyword_list
                .iter()
                .map(|w| w.trim())
                .filter(|s| !s.is_empty())
            {
                *tags.entry(word.to_owned()).or_default() += 1;
            }
            let mut parent = a.path.parent();
            while let Some(path) = parent {
                if path == self.root || !path.starts_with(&self.root) {
                    break;
                }
                *folders.entry(path.to_owned()).or_default() += 1;
                parent = path.parent();
            }
        }
        self.keywords = tags.into_iter().collect();
        self.keywords
            .sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        self.folders = folders.into_iter().collect();
        self.sizes = Rc::new(vec![size(px(500.), px(55.)); self.filtered.len()]);
        cx.notify();
    }
    fn export(&mut self, cx: &mut Context<Self>) {
        let items = self
            .filtered
            .iter()
            .map(|i| self.articles[*i].clone())
            .collect::<Vec<_>>();
        match crate::exports::export_bibtex(&items, &self.root) {
            Ok(path) => {
                self.status = format!("{}편의 서지정보를 저장했습니다", items.len());
                cx.open_with_system(&path);
            }
            Err(e) => self.status = e.to_string(),
        };
        cx.notify();
    }
    pub(crate) fn update_article(&mut self, article: Article, cx: &mut Context<Self>) {
        if let Some(existing) = self.articles.iter_mut().find(|a| a.id == article.id) {
            *existing = article;
        }
        self.filter(cx);
    }
    pub(crate) fn focus_search(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.search.update(cx, |input, cx| input.focus(window, cx));
    }
}

impl LibraryView {
    fn toggle_flag(&mut self, article: &Article, key: bool, cx: &mut Context<Self>) {
        let mut next = article.clone();
        let value = if key { !next.is_key } else { !next.is_read };
        match Library::open(&self.home).and_then(|l| l.flag(next.id, key, value)) {
            Ok(()) => {
                if key {
                    next.is_key = value;
                } else {
                    next.is_read = value;
                }
                self.update_article(next.clone(), cx);
                if self.selected == Some(next.id) {
                    cx.emit(Selected(next));
                }
            }
            Err(e) => {
                self.status = e.to_string();
                cx.notify();
            }
        }
    }
    fn choose_sort(&mut self, column: u8, cx: &mut Context<Self>) {
        if self.sort == column {
            self.descending = !self.descending;
        } else {
            self.sort = column;
            self.descending = column == 2;
        }
        self.filter(cx);
    }
    pub(crate) fn navigation(&mut self, _: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let entries: Vec<(String, usize, Option<PathBuf>)> = if self.nav_tab == 0 {
            self.keywords
                .iter()
                .filter(|(k, _)| k.to_lowercase().contains(&self.tag_query))
                .map(|(k, n)| (k.clone(), *n, None))
                .collect()
        } else {
            self.folders
                .iter()
                .map(|(p, n)| {
                    (
                        p.strip_prefix(&self.root)
                            .unwrap_or(p)
                            .to_string_lossy()
                            .into_owned(),
                        *n,
                        Some(p.clone()),
                    )
                })
                .collect()
        };
        let entry_count = entries.len();
        let nav_list = v_virtual_list(
            cx.entity(),
            "navigation-items",
            Rc::new(vec![size(px(240.), px(34.)); entry_count]),
            move |this, range, _, cx| {
                range
                    .map(|i| {
                        let (name, count, path) = entries[i].clone();
                        let selected = if let Some(p) = &path {
                            this.folder.as_ref() == Some(p)
                        } else {
                            this.keyword.as_ref() == Some(&name)
                        };
                        let depth = path
                            .as_ref()
                            .map(|p| {
                                p.strip_prefix(&this.root)
                                    .unwrap_or(p)
                                    .components()
                                    .count()
                                    .saturating_sub(1)
                            })
                            .unwrap_or(0);
                        let title = path
                            .as_ref()
                            .and_then(|p| p.file_name())
                            .map(|s| s.to_string_lossy().into_owned())
                            .unwrap_or_else(|| name.clone());
                        Button::new(("nav-entry", i))
                            .ghost()
                            .w_full()
                            .h(px(34.))
                            .px_2()
                            .selected(selected)
                            .accessibility_label(format!("{} · {}편", name, count))
                            .tooltip(name.clone())
                            .child(
                                div()
                                    .w_full()
                                    .min_w_0()
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .pl(px((depth.min(4) * 10) as f32))
                                    .child(
                                        Icon::new(if path.is_some() {
                                            IconName::Folder
                                        } else {
                                            IconName::Tag
                                        })
                                        .size_3()
                                        .text_color(
                                            if selected {
                                                cx.theme().primary
                                            } else {
                                                cx.theme().muted_foreground
                                            },
                                        ),
                                    )
                                    .child(
                                        div().flex_1().min_w_0().truncate().text_sm().child(title),
                                    )
                                    .child(
                                        div()
                                            .px_2()
                                            .py(px(1.))
                                            .rounded_full()
                                            .bg(cx.theme().muted)
                                            .text_xs()
                                            .text_color(cx.theme().muted_foreground)
                                            .child(count.to_string()),
                                    ),
                            )
                            .on_click(cx.listener(move |this, _, _, cx| {
                                if let Some(p) = &path {
                                    this.folder = if this.folder.as_ref() == Some(p) {
                                        None
                                    } else {
                                        Some(p.clone())
                                    };
                                    this.keyword = None;
                                } else {
                                    this.keyword = if this.keyword.as_ref() == Some(&name) {
                                        None
                                    } else {
                                        Some(name.clone())
                                    };
                                    this.folder = None;
                                }
                                this.filter(cx);
                            }))
                    })
                    .collect()
            },
        )
        .flex_1()
        .min_h_0();
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(cx.theme().sidebar)
            .child(
                div()
                    .p_4()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_1()
                            .child(
                                div()
                                    .flex_1()
                                    .text_size(px(21.))
                                    .font_weight(FontWeight::BOLD)
                                    .child(
                                        div()
                                            .flex()
                                            .child(
                                                div()
                                                    .text_color(cx.theme().primary)
                                                    .child("Scholar"),
                                            )
                                            .child(div().text_color(rgb(0xb897ef)).child("ly")),
                                    ),
                            )
                            .child(
                                ui::tool("nav-settings", IconName::Settings, "설정").on_click(
                                    |_, window, cx| {
                                        window.dispatch_action(Box::new(crate::ShowSettings), cx)
                                    },
                                ),
                            )
                            .child(
                                ui::tool("nav-folder", IconName::FolderOpen, "논문 폴더 열기")
                                    .on_click(|_, window, cx| {
                                        window.dispatch_action(Box::new(crate::OpenFolder), cx)
                                    }),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .gap_2()
                            .items_center()
                            .text_xs()
                            .text_color(cx.theme().muted_foreground)
                            .child(Icon::new(IconName::Folder).size_3())
                            .child(
                                div().truncate().child(
                                    self.root
                                        .file_name()
                                        .map(|s| s.to_string_lossy().into_owned())
                                        .unwrap_or_else(|| "논문 폴더를 선택하세요".into()),
                                ),
                            ),
                    ),
            )
            .child(
                div()
                    .flex()
                    .border_b_1()
                    .border_color(cx.theme().border)
                    .children(
                        [(0, "키워드", IconName::Tags), (1, "폴더", IconName::Folder)]
                            .into_iter()
                            .map(|(tab, label, icon)| {
                                Button::new(("nav-tab", tab as u64))
                                    .ghost()
                                    .small()
                                    .flex_1()
                                    .rounded_none()
                                    .h(px(38.))
                                    .icon(icon)
                                    .label(label)
                                    .selected(self.nav_tab == tab)
                                    .when(self.nav_tab == tab, |b| {
                                        b.border_b_2()
                                            .border_color(cx.theme().primary)
                                            .text_color(cx.theme().primary)
                                    })
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.nav_tab = tab;
                                        cx.notify();
                                    }))
                            }),
                    ),
            )
            .child(
                div()
                    .px_4()
                    .pt_4()
                    .pb_2()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .child(
                        div()
                            .text_xs()
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(cx.theme().muted_foreground)
                            .child(format!(
                                "{}  ·  {}",
                                if self.nav_tab == 0 {
                                    "KEYWORDS"
                                } else {
                                    "FOLDERS"
                                },
                                entry_count
                            )),
                    )
                    .when(self.nav_tab == 0, |v| {
                        v.child(Input::new(&self.tag_search).small().cleanable(true))
                    })
                    .child(
                        Button::new("all-papers")
                            .ghost()
                            .small()
                            .w_full()
                            .icon(IconName::Library)
                            .label(format!("전체 논문  {}", self.articles.len()))
                            .selected(
                                self.keyword.is_none() && self.folder.is_none() && self.filter == 0,
                            )
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.keyword = None;
                                this.folder = None;
                                this.filter = 0;
                                this.filter(cx);
                            })),
                    )
                    .child(
                        div().flex().gap_1().children(
                            [(1, "중요"), (2, "읽지 않음")]
                                .into_iter()
                                .map(|(f, label)| {
                                    Button::new(("quick-filter", f as u64))
                                        .ghost()
                                        .xsmall()
                                        .label(label)
                                        .selected(self.filter == f)
                                        .on_click(cx.listener(move |this, _, _, cx| {
                                            this.filter = if this.filter == f { 0 } else { f };
                                            this.filter(cx);
                                        }))
                                }),
                        ),
                    ),
            )
            .child(nav_list)
            .child(
                div()
                    .p_3()
                    .border_t_1()
                    .border_color(cx.theme().border)
                    .text_xs()
                    .text_color(cx.theme().muted_foreground)
                    .child("Scholarly · 나의 논문 서재"),
            )
            .into_any_element()
    }
}
pub(crate) struct NavigationView {
    library: Entity<LibraryView>,
    _subscription: Subscription,
}
impl NavigationView {
    pub(crate) fn new(library: Entity<LibraryView>, cx: &mut Context<Self>) -> Self {
        let subscription = cx.observe(&library, |_, _, cx| cx.notify());
        Self {
            library,
            _subscription: subscription,
        }
    }
}
impl Render for NavigationView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.library.update(cx, |l, cx| l.navigation(window, cx))
    }
}
impl Render for LibraryView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let list = v_virtual_list(
            cx.entity(),
            "papers",
            self.sizes.clone(),
            |this, range, _, cx| {
                range
                    .map(|ix| {
                        let article = this.articles[this.filtered[ix]].clone();
                        let selected = this.selected == Some(article.id);
                        let key_article = article.clone();
                        let read_article = article.clone();
                        let study_article = article.clone();
                        let title = article.title.clone();
                        div()
                            .id(("paper-row", article.id as u64))
                            .flex()
                            .items_center()
                            .gap_1()
                            .h(px(55.))
                            .px_3()
                            .w_full()
                            .min_w_0()
                            .border_b_1()
                            .border_color(cx.theme().table_row_border)
                            .border_l_2()
                            .border_color(if selected {
                                cx.theme().primary
                            } else {
                                gpui_kit::transparent_black()
                            })
                            .bg(if selected {
                                cx.theme().list_active
                            } else {
                                cx.theme().background
                            })
                            .hover(|s| s.bg(cx.theme().list_hover))
                            .child(
                                Button::new(("key", article.id as u64))
                                    .ghost()
                                    .xsmall()
                                    .icon(IconName::Star)
                                    .text_color(if article.is_key {
                                        rgb(0xfacc70).into()
                                    } else {
                                        cx.theme().muted_foreground.opacity(0.45)
                                    })
                                    .accessibility_label("중요 논문 표시")
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.toggle_flag(&key_article, true, cx)
                                    })),
                            )
                            .child(
                                Button::new(("read", article.id as u64))
                                    .ghost()
                                    .xsmall()
                                    .icon(if article.is_read {
                                        IconName::Check
                                    } else {
                                        IconName::Square
                                    })
                                    .text_color(if article.is_read {
                                        rgb(0x6ee7b7).into()
                                    } else {
                                        cx.theme().muted_foreground.opacity(0.45)
                                    })
                                    .accessibility_label("읽음 표시")
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.toggle_flag(&read_article, false, cx)
                                    })),
                            )
                            .child(
                                Button::new(("paper", article.id as u64))
                                    .ghost()
                                    .h_full()
                                    .flex_1()
                                    .min_w_0()
                                    .px_2()
                                    .accessibility_label(title.clone())
                                    .tooltip(title.clone())
                                    .child(
                                        div()
                                            .w_full()
                                            .truncate()
                                            .font_weight(FontWeight::MEDIUM)
                                            .child(title),
                                    )
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.selected = Some(article.id);
                                        cx.emit(Selected(article.clone()));
                                        cx.notify();
                                    })),
                            )
                            .when(this.show_authors, |v| {
                                v.child(
                                    div()
                                        .w(px(145.))
                                        .flex_shrink_0()
                                        .truncate()
                                        .text_sm()
                                        .text_color(cx.theme().muted_foreground)
                                        .child(study_article.authors.clone()),
                                )
                            })
                            .child(
                                div()
                                    .w(px(60.))
                                    .flex_shrink_0()
                                    .flex()
                                    .justify_center()
                                    .child(
                                        div()
                                            .rounded_full()
                                            .bg(cx.theme().muted)
                                            .px_2()
                                            .py(px(2.))
                                            .text_xs()
                                            .child(
                                                study_article
                                                    .year
                                                    .map(|y| y.to_string())
                                                    .unwrap_or_else(|| "—".into()),
                                            ),
                                    ),
                            )
                            .child(
                                Button::new(("study", study_article.id as u64))
                                    .ghost()
                                    .small()
                                    .icon(IconName::BookOpen)
                                    .text_color(cx.theme().primary)
                                    .tooltip("학습 노트 열기")
                                    .accessibility_label(format!(
                                        "학습 노트: {}",
                                        study_article.title
                                    ))
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.selected = Some(study_article.id);
                                        cx.emit(Selected(study_article.clone()));
                                        cx.emit(OpenStudy(study_article.clone()));
                                        cx.notify();
                                    })),
                            )
                    })
                    .collect()
            },
        )
        .flex_1()
        .min_h_0();
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(cx.theme().background)
            .child(
                div()
                    .p_4()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .bg(cx.theme().sidebar.opacity(0.55))
                    .border_b_1()
                    .border_color(cx.theme().border)
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .items_center()
                            .gap_2()
                            .child(
                                ui::tool(
                                    "toggle-nav",
                                    IconName::PanelLeft,
                                    "사이드바 표시 / 숨기기",
                                )
                                .on_click(|_, w, cx| {
                                    w.dispatch_action(Box::new(crate::ToggleLibrary), cx)
                                }),
                            )
                            .child(
                                div()
                                    .text_lg()
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .mr_2()
                                    .child("Articles"),
                            )
                            .child(
                                ui::tool("refresh", IconName::RefreshCw, "폴더 새로 고침")
                                    .disabled(self.busy)
                                    .on_click(cx.listener(|this, _, _, cx| this.refresh(cx))),
                            )
                            .child(
                                Button::new("digest-folder")
                                    .small()
                                    .icon(IconName::NotebookPen)
                                    .label("노트 일괄 작성")
                                    .on_click(|_, w, cx| {
                                        w.dispatch_action(Box::new(crate::ShowQueue), cx)
                                    }),
                            )
                            .child(div().flex_1())
                            .child(
                                ui::tool("authors", IconName::Users, "저자 열 표시 / 숨기기")
                                    .selected(self.show_authors)
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.show_authors = !this.show_authors;
                                        cx.notify();
                                    })),
                            )
                            .child(
                                Button::new("bibtex")
                                    .small()
                                    .ghost()
                                    .icon(IconName::Library)
                                    .label("BibTeX")
                                    .text_color(rgb(0xc4b5fd))
                                    .on_click(cx.listener(|this, _, _, cx| this.export(cx))),
                            )
                            .child(
                                ui::tool("detail", IconName::PanelRight, "상세 정보 표시 / 숨기기")
                                    .on_click(|_, w, cx| {
                                        w.dispatch_action(Box::new(crate::ToggleInspector), cx)
                                    }),
                            ),
                    )
                    .child(
                        Input::new(&self.search)
                            .prefix(Icon::new(IconName::Search).size_4())
                            .cleanable(true),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(cx.theme().muted_foreground)
                            .child(format!(
                                "{}편{}",
                                self.filtered.len(),
                                self.keyword
                                    .as_ref()
                                    .map(|k| format!(" · {k}"))
                                    .unwrap_or_default()
                            )),
                    ),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_1()
                    .px_3()
                    .h(px(36.))
                    .bg(cx.theme().sidebar)
                    .text_xs()
                    .text_color(cx.theme().muted_foreground)
                    .child(
                        Button::new("sort-key")
                            .ghost()
                            .xsmall()
                            .icon(IconName::Star)
                            .accessibility_label("중요 순 정렬")
                            .on_click(cx.listener(|this, _, _, cx| this.choose_sort(3, cx))),
                    )
                    .child(div().w(px(28.)).child("✓"))
                    .child(
                        Button::new("sort-title")
                            .ghost()
                            .xsmall()
                            .flex_1()
                            .accessibility_label("제목 정렬")
                            .child(div().w_full().child(if self.sort == 0 {
                                if self.descending {
                                    "제목 ↓"
                                } else {
                                    "제목 ↑"
                                }
                            } else {
                                "제목"
                            }))
                            .on_click(cx.listener(|this, _, _, cx| this.choose_sort(0, cx))),
                    )
                    .when(self.show_authors, |v| {
                        v.child(
                            Button::new("sort-author")
                                .ghost()
                                .xsmall()
                                .w(px(145.))
                                .label("저자")
                                .on_click(cx.listener(|this, _, _, cx| this.choose_sort(1, cx))),
                        )
                    })
                    .child(
                        Button::new("sort-year")
                            .ghost()
                            .xsmall()
                            .w(px(60.))
                            .label(if self.sort == 2 {
                                if self.descending {
                                    "연도 ↓"
                                } else {
                                    "연도 ↑"
                                }
                            } else {
                                "연도"
                            })
                            .on_click(cx.listener(|this, _, _, cx| this.choose_sort(2, cx))),
                    )
                    .child(div().w(px(32.)).child("노트")),
            )
            .child(list)
            .when(self.filtered.is_empty(), |v| {
                v.child(
                    div()
                        .p_8()
                        .text_sm()
                        .text_color(cx.theme().muted_foreground)
                        .child(if self.busy {
                            "논문을 읽고 있습니다…"
                        } else {
                            "조건에 맞는 논문이 없습니다."
                        }),
                )
            })
            .child(
                div()
                    .px_4()
                    .py_2()
                    .border_t_1()
                    .border_color(cx.theme().border)
                    .text_xs()
                    .text_color(cx.theme().muted_foreground)
                    .child(self.status.clone()),
            )
    }
}
