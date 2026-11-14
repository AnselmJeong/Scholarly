mod html_surface;
mod reader_html;
mod reader_math;
mod source_visuals;
use gpui_kit::prelude::FluentBuilder;
mod evaluation;
mod exports;
mod figures;
mod library;
mod library_view;
mod metadata;
mod provider;
mod queue;
mod reader_format;
mod reader_view;
mod reading;
mod settings_view;
#[cfg(test)]
mod tests;
mod ui;
use gpui_kit::assets::IconName;
use gpui_kit::component::resizable::{ResizableState, h_resizable, resizable_panel};
use gpui_kit::component::{ActiveTheme, ThemeMode};
use gpui_kit::*;
use library::{Settings, app_home};
use library_view::{LibraryView, NavigationView, OpenStudy, Selected};
use reader_view::{ArticleChanged, InspectorView, ReaderView};
use settings_view::{Saved, SettingsView};
use std::path::PathBuf;
actions!(
    scholarly,
    [
        Quit,
        ShowQueue,
        ToggleInspector,
        CloseStudy,
        OpenCurrentStudy,
        CompactWindow,
        StandardWindow,
        OpenFolder,
        SearchLibrary,
        RewriteNote,
        ShowSettings,
        ToggleLibrary,
        ToggleTheme,
        ZoomIn,
        ZoomOut,
        CloseAuxiliary
    ]
);
struct Scholarly {
    home: PathBuf,
    settings: Settings,
    library: Entity<LibraryView>,
    reader: Entity<ReaderView>,
    navigation: Entity<NavigationView>,
    inspector: Entity<InspectorView>,
    panels: [Entity<ResizableState>; 4],
    reading_visible: bool,
    inspector_visible: bool,
    compact_inspector: bool,
    sidebar_width: f32,
    inspector_width: f32,
    preferences: Entity<SettingsView>,
    queue: Entity<queue::QueueView>,
    queue_visible: bool,
    settings_visible: bool,
    sidebar_visible: bool,
    narrow: bool,
    focus: FocusHandle,
    _subscriptions: Vec<Subscription>,
}
impl Scholarly {
    fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let home = app_home();
        let settings = Settings::load(&home).unwrap_or_else(|e| {
            eprintln!("Settings load failed: {e}");
            Settings {
                provider: "codex".into(),
                effort: "low".into(),
                language: "ko".into(),
                ..Default::default()
            }
        });
        let library =
            cx.new(|cx| LibraryView::new(home.clone(), PathBuf::from(&settings.root), window, cx));
        let reader = cx.new(|cx| ReaderView::new(home.clone(), settings.clone(), window, cx));
        let navigation = cx.new(|cx| NavigationView::new(library.clone(), cx));
        let inspector = cx.new(|cx| InspectorView::new(reader.clone(), cx));
        let panels = std::array::from_fn(|_| cx.new(|_| ResizableState::default()));
        let layout: serde_json::Value = std::fs::read(home.join("layout.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        let preferences =
            cx.new(|cx| SettingsView::new(settings.clone(), home.clone(), window, cx));
        let queue = cx.new(|cx| queue::QueueView::new(home.clone(), settings.clone(), cx));
        let selected = cx.subscribe_in(
            &library,
            window,
            |this, _, Selected(article), window, cx| {
                this.settings_visible = false;
                this.queue_visible = false;
                if window.viewport_size().width < px(1080.) {
                    this.compact_inspector = true;
                }

                this.reader
                    .update(cx, |reader, cx| reader.select(article.clone(), window, cx));
                cx.notify();
            },
        );
        let opened = cx.subscribe_in(
            &library,
            window,
            |this, _, OpenStudy(article), window, cx| {
                let _ = article.id;
                window.focus(&this.focus, cx);
                this.reading_visible = true;
                this.compact_inspector = false;
                this.reader.update(cx, |r, cx| r.show_note(cx));
                cx.notify();
            },
        );
        let changed = cx.subscribe(&reader, |this, _, ArticleChanged(article), cx| {
            this.library.update(cx, |library, cx| {
                library.update_article(article.clone(), cx)
            });
        });
        let saved = cx.subscribe(&preferences, |this, _, Saved(settings), cx| {
            let mut next = settings.clone();
            next.root = this.settings.root.clone();
            let _ = next.save(&this.home);
            this.settings = next.clone();
            this.reader.update(cx, |reader, _| reader.settings(next));
            this.settings_visible = false;
            cx.notify();
        });
        let focus = cx.focus_handle();
        window.focus(&focus, cx);
        Self {
            home,
            settings,
            library,
            reader,
            navigation,
            inspector,
            panels,
            reading_visible: false,
            inspector_visible: true,
            compact_inspector: false,
            sidebar_width: layout["sidebar"].as_f64().unwrap_or(260.).clamp(200., 400.) as f32,
            inspector_width: layout["inspector"]
                .as_f64()
                .unwrap_or(360.)
                .clamp(280., 520.) as f32,
            preferences,
            queue,
            queue_visible: false,
            settings_visible: false,
            sidebar_visible: true,
            narrow: false,
            focus,
            _subscriptions: vec![selected, saved, changed, opened],
        }
    }
    fn open_folder(&mut self, _: &OpenFolder, _: &mut Window, cx: &mut Context<Self>) {
        let result = cx.prompt_for_paths(PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some("논문 폴더 선택".into()),
        });
        cx.spawn(async move |weak, cx| {
            if let Ok(Ok(Some(paths))) = result.await
                && let Some(path) = paths.first()
            {
                let _ = weak.update(cx, |this, cx| {
                    this.settings.root = path.to_string_lossy().into_owned();
                    if let Err(e) = this.settings.save(&this.home) {
                        eprintln!("Settings save failed: {e}");
                        return;
                    }
                    this.reading_visible = false;
                    this.library
                        .update(cx, |library, cx| library.set_root(path.clone(), cx));
                    this.reader.update(cx, |reader, cx| {
                        reader.clear(cx);
                        reader.settings(this.settings.clone());
                    });
                    cx.notify();
                });
            }
        })
        .detach();
    }
    fn search(&mut self, _: &SearchLibrary, window: &mut Window, cx: &mut Context<Self>) {
        self.settings_visible = false;
        self.queue_visible = false;
        self.reading_visible = false;
        self.library
            .update(cx, |library, cx| library.focus_search(window, cx));
        cx.notify();
    }
    fn rewrite(&mut self, _: &RewriteNote, window: &mut Window, cx: &mut Context<Self>) {
        self.reading_visible = true;
        self.reader
            .update(cx, |reader, cx| reader.start("generate", window, cx));
        cx.notify();
    }
    fn preferences(&mut self, _: &ShowSettings, window: &mut Window, cx: &mut Context<Self>) {
        self.queue_visible = false;
        self.settings_visible = !self.settings_visible;
        if self.settings_visible {
            self.preferences
                .update(cx, |view, cx| view.open(self.settings.clone(), window, cx));
        }
        cx.notify();
    }
    fn sidebar(&mut self, _: &ToggleLibrary, _: &mut Window, cx: &mut Context<Self>) {
        self.sidebar_visible = !self.sidebar_visible;
        cx.notify();
    }
}
impl Render for Scholarly {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let narrow = window.viewport_size().width < px(1080.);
        self.narrow = narrow;
        let auxiliary = self.settings_visible || self.queue_visible;
        let show_nav =
            self.sidebar_visible && (!narrow || (!self.reading_visible && !self.compact_inspector));
        let show_inspector = self.inspector_visible && !narrow && !auxiliary;
        let reader_visible =
            self.reading_visible && !auxiliary && !(narrow && self.compact_inspector);
        if !reader_visible {
            self.reader.update(cx, |r, _| r.hide_html());
        }
        let center = if self.settings_visible {
            self.preferences.clone().into_any_element()
        } else if self.queue_visible {
            self.queue.clone().into_any_element()
        } else if narrow && self.compact_inspector {
            self.inspector.clone().into_any_element()
        } else if self.reading_visible {
            self.reader.clone().into_any_element()
        } else {
            self.library.clone().into_any_element()
        };
        // A compact reader has a different panel topology. Sharing its sizes with
        // the three-pane library would turn the reader width into a sidebar width.
        let panel_mode = (show_nav as usize) * 2 + show_inspector as usize;
        let mut panes =
            h_resizable(("workspace", panel_mode as u64)).with_state(&self.panels[panel_mode]);
        if show_nav {
            panes = panes.child(
                resizable_panel()
                    .size(px(self.sidebar_width))
                    .size_range(px(200.)..px(400.))
                    .child(self.navigation.clone()),
            );
        }
        panes = panes.child(
            resizable_panel()
                .size_range(px(340.)..px(2400.))
                .child(center),
        );
        if show_inspector {
            panes = panes.child(
                resizable_panel()
                    .size(px(self.inspector_width))
                    .size_range(px(280.)..px(520.))
                    .child(self.inspector.clone()),
            );
        }
        let panes = panes.on_resize(cx.listener(move |this, state: &Entity<ResizableState>, _, cx| {
            let sizes = state.read(cx).sizes();
            if sizes.len() != 1 + show_nav as usize + show_inspector as usize { return; }
            if show_nav && let Some(size)=sizes.first() {this.sidebar_width=f32::from(*size).clamp(200.,400.);}
            if show_inspector && let Some(size)=sizes.last() {this.inspector_width=f32::from(*size).clamp(280.,520.);}
            let _=reading::atomic_write(&this.home.join("layout.json"), &serde_json::to_vec(&serde_json::json!({"sidebar":this.sidebar_width,"inspector":this.inspector_width})).unwrap_or_default(),false);
        }));
        div()
            .track_focus(&self.focus)
            .key_context("Scholarly")
            .on_action(cx.listener(Self::open_folder))
            .on_action(cx.listener(Self::search))
            .on_action(cx.listener(Self::rewrite))
            .on_action(cx.listener(Self::preferences))
            .on_action(cx.listener(Self::sidebar))
            .on_action(cx.listener(|_, _: &CompactWindow, window, _| {
                window.resize(size(px(900.), px(720.)))
            }))
            .on_action(cx.listener(|_, _: &StandardWindow, window, _| {
                window.resize(size(px(1400.), px(850.)))
            }))
            .on_action(cx.listener(|this, _: &ShowQueue, _, cx| {
                this.queue_visible = !this.queue_visible;
                this.settings_visible = false;
                this.queue
                    .update(cx, |q, _| q.settings(this.settings.clone()));
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &ToggleInspector, _, cx| {
                if this.narrow {
                    this.compact_inspector = !this.compact_inspector;
                } else {
                    this.inspector_visible = !this.inspector_visible;
                }
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &CloseStudy, _, cx| {
                this.reading_visible = false;
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &OpenCurrentStudy, window, cx| {
                window.focus(&this.focus, cx);
                this.reading_visible = true;
                this.compact_inspector = false;
                this.reader.update(cx, |r, cx| r.show_note(cx));
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &CloseAuxiliary, window, cx| {
                this.settings_visible = false;
                this.queue_visible = false;
                this.compact_inspector = false;
                this.reader
                    .update(cx, |r, cx| r.close_auxiliary(window, cx));
                window.focus(&this.focus, cx);
                cx.notify();
            }))
            .on_action(cx.listener(|_, _: &ToggleTheme, window, cx| {
                let mode = if cx.theme().is_dark() {
                    ThemeMode::Light
                } else {
                    ThemeMode::Dark
                };
                let _ = window;
                ui::apply(cx, mode == ThemeMode::Dark);
                cx.notify();
            }))
            .on_action(
                cx.listener(|this, _: &ZoomIn, _, cx| {
                    this.reader.update(cx, |r, cx| r.zoom(1., cx))
                }),
            )
            .on_action(cx.listener(|this, _: &ZoomOut, _, cx| {
                this.reader.update(cx, |r, cx| r.zoom(-1., cx))
            }))
            .size_full()
            .flex()
            .flex_col()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .when(auxiliary, |view| {
                view.child(
                    div()
                        .px_4()
                        .py_2()
                        .flex()
                        .items_center()
                        .gap_2()
                        .border_b_1()
                        .border_color(cx.theme().border)
                        .child(
                            ui::tool("close-preferences", IconName::ArrowLeft, "서재로 돌아가기")
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.settings_visible = false;
                                    this.queue_visible = false;
                                    cx.notify();
                                })),
                        )
                        .child(if self.settings_visible {
                            "설정"
                        } else {
                            "노트 일괄 작성"
                        }),
                )
            })
            .child(div().flex_1().min_h_0().size_full().child(panes))
    }
}
fn main() {
    if let Some(result) = evaluation::arguments() {
        if let Err(error) = result {
            eprintln!("{error:#}");
            std::process::exit(1)
        }
        return;
    }
    if std::env::args().any(|a| a == "--self-test") {
        if let Err(error) = self_test() {
            eprintln!("{error:#}");
            std::process::exit(1)
        }
        return;
    }
    let started = std::time::Instant::now();
    gpui_kit::application()
        .with_assets(ui::Assets)
        .run(move |cx| {
            gpui_kit::init(cx);
            cx.on_app_quit(|_| {
                provider::shutdown();
                async {}
            })
            .detach();
            ui::apply(cx, true);
            cx.on_action(|_: &Quit, cx| cx.quit());
            cx.bind_keys([
                KeyBinding::new("cmd-q", Quit, None),
                KeyBinding::new("cmd-o", OpenFolder, None),
                KeyBinding::new("cmd-f", SearchLibrary, None),
                KeyBinding::new("cmd-shift-r", RewriteNote, None),
                KeyBinding::new("cmd-,", ShowSettings, None),
                KeyBinding::new("cmd-b", ToggleLibrary, None),
                KeyBinding::new("cmd-shift-d", ToggleTheme, None),
                KeyBinding::new("cmd-=", ZoomIn, None),
                KeyBinding::new("cmd--", ZoomOut, None),
                KeyBinding::new("escape", CloseAuxiliary, Some("Scholarly")),
            ]);
            cx.set_menus(vec![
                Menu {
                    disabled: false,
                    name: "Scholarly".into(),
                    items: vec![
                        MenuItem::action("설정…", ShowSettings),
                        MenuItem::separator(),
                        MenuItem::action("종료", Quit),
                    ],
                },
                Menu {
                    disabled: false,
                    name: "파일".into(),
                    items: vec![
                        MenuItem::action("폴더 열기…", OpenFolder),
                        MenuItem::action("학습 노트 다시 작성", RewriteNote),
                    ],
                },
                Menu {
                    disabled: false,
                    name: "보기".into(),
                    items: vec![
                        MenuItem::action("서재 검색", SearchLibrary),
                        MenuItem::action("좁은 창으로 보기", CompactWindow),
                        MenuItem::action("기본 창 크기", StandardWindow),
                        MenuItem::action("서재 표시", ToggleLibrary),
                        MenuItem::action("밝은 / 어두운 화면", ToggleTheme),
                        MenuItem::action("본문 크게", ZoomIn),
                        MenuItem::action("본문 작게", ZoomOut),
                    ],
                },
            ]);
            let options = WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                    None,
                    size(px(1400.), px(850.)),
                    cx,
                ))),
                window_min_size: Some(size(px(820.), px(600.))),
                titlebar: Some(TitlebarOptions {
                    title: Some("Scholarly".into()),
                    appears_transparent: false,
                    ..Default::default()
                }),
                ..Default::default()
            };
            gpui_kit::open_window(options, cx, |window, cx| {
                cx.new(|cx| Scholarly::new(window, cx))
            })
            .expect("Scholarly window");
            cx.activate(true);
            eprintln!(
                "Window created in {} ms (not first-paint timing)",
                started.elapsed().as_millis()
            );
        });
}
fn self_test() -> anyhow::Result<()> {
    let home = app_home();
    let settings = Settings::load(&home)?;
    let mut library = library::Library::open(&home)?;
    let count = library.scan(std::path::Path::new(&settings.root))?;
    let articles = library.articles(std::path::Path::new(&settings.root))?;
    println!("Scanned {count} PDFs; {} records available", articles.len());
    if let Some(article) = articles.first() {
        let document = reading::extract(&article.path, &home)?;
        println!("PDF extraction: {} physical pages", document.page_count);
    }
    Ok(())
}
