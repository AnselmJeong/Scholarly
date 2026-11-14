use crate::{
    library::{Library, Settings},
    provider, reading,
};
use gpui_kit::component::{ActiveTheme, Disableable, button::Button};
use gpui_kit::{prelude::FluentBuilder, *};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::Duration,
};
#[derive(Clone, Serialize, Deserialize)]
struct Item {
    path: PathBuf,
    title: String,
    state: String,
    error: String,
}
#[derive(Clone, Serialize, Deserialize, Default)]
struct Queue {
    root: String,
    items: Vec<Item>,
}
fn save(home: &std::path::Path, queue: &Queue) -> anyhow::Result<()> {
    reading::atomic_write(
        &home.join("reading-queue.json"),
        &serde_json::to_vec_pretty(queue)?,
        false,
    )
}
pub(crate) struct QueueView {
    home: PathBuf,
    settings: Settings,
    queue: Queue,
    status: String,
    busy: bool,
    cancel: provider::Cancel,
    sender: mpsc::Sender<(Queue, String, bool)>,
    receiver: mpsc::Receiver<(Queue, String, bool)>,
    _poll: Task<()>,
}
impl Drop for QueueView {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Relaxed);
    }
}
impl QueueView {
    pub fn new(home: PathBuf, settings: Settings, cx: &mut Context<Self>) -> Self {
        let (sender, receiver) = mpsc::channel();
        let queue = std::fs::read(home.join("reading-queue.json"))
            .ok()
            .and_then(|v| serde_json::from_slice(&v).ok())
            .unwrap_or_default();
        let poll = cx.spawn(async move |weak, cx| {
            loop {
                cx.background_executor()
                    .timer(Duration::from_millis(200))
                    .await;
                if weak
                    .update(cx, |this, cx| {
                        while let Ok((queue, status, busy)) = this.receiver.try_recv() {
                            this.queue = queue;
                            this.status = status;
                            this.busy = busy;
                            cx.notify();
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        });
        Self {
            home,
            settings,
            queue,
            status:
                "현재 폴더에 있는 논문을 차례로 작성합니다. 완료된 노트와 개인 메모는 보존됩니다."
                    .into(),
            busy: false,
            cancel: Arc::new(AtomicBool::new(false)),
            sender,
            receiver,
            _poll: poll,
        }
    }
    pub fn settings(&mut self, settings: Settings) {
        if !self.busy {
            self.settings = settings;
        }
    }
    fn prepare(&mut self, force: bool, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        self.busy = true;
        self.status = "작성할 논문 목록을 확인하고 있습니다".into();
        let (home, settings, sender) = (
            self.home.clone(),
            self.settings.clone(),
            self.sender.clone(),
        );
        std::thread::spawn(move || {
            let result = (|| -> anyhow::Result<Queue> {
                let library = Library::open(&home)?;
                let items = library
                    .articles(std::path::Path::new(&settings.root))?
                    .into_iter()
                    .filter(|a| a.path.is_file())
                    .map(|a| {
                        let skip = !force
                            && reading::read_note(&a.path).is_ok_and(|(body, _)| !body.is_empty());
                        Item {
                            path: a.path,
                            title: a.title,
                            state: if skip { "skipped" } else { "pending" }.into(),
                            error: String::new(),
                        }
                    })
                    .collect();
                let queue = Queue {
                    root: settings.root,
                    items,
                };
                save(&home, &queue)?;
                Ok(queue)
            })();
            let (queue, status) = match result {
                Ok(q) => (
                    q,
                    "목록을 준비했습니다. ‘작성 시작’을 누르면 진행합니다.".into(),
                ),
                Err(e) => (Queue::default(), e.to_string()),
            };
            let _ = sender.send((queue, status, false));
        });
        cx.notify();
    }
    fn start(&mut self, cx: &mut Context<Self>) {
        if self.busy || self.queue.items.is_empty() {
            return;
        }
        self.busy = true;
        self.cancel = Arc::new(AtomicBool::new(false));
        let (home, mut settings, sender, cancel) = (
            self.home.clone(),
            self.settings.clone(),
            self.sender.clone(),
            self.cancel.clone(),
        );
        let mut queue = self.queue.clone();
        settings.root = queue.root.clone();
        for item in &mut queue.items {
            if item.state == "running" || item.state == "cancelled" || item.state == "failed" {
                item.state = "pending".into();
                item.error.clear();
            }
        }
        self.queue = queue.clone();
        self.status = "작성 중 · 동시에 최대 두 편을 처리합니다".into();
        std::thread::spawn(move || {
            let shared = Arc::new(Mutex::new(queue));
            let journal_error = Arc::new(Mutex::new(None::<String>));
            let result = (|| -> anyhow::Result<()> {
                save(&home, &shared.lock().unwrap())?;
                let library = Library::open(&home)?;
                let articles = library.articles(std::path::Path::new(&settings.root))?;
                std::thread::scope(|scope| {
                    for _ in 0..2 {
                        let (shared, sender, cancel, settings, home, articles) = (
                            shared.clone(),
                            sender.clone(),
                            cancel.clone(),
                            settings.clone(),
                            home.clone(),
                            &articles,
                        );
                        let journal_error = journal_error.clone();
                        scope.spawn(move || {
                            loop {
                                if cancel.load(Ordering::Relaxed) {
                                    break;
                                }
                                let selected = {
                                    let mut q = shared.lock().unwrap();
                                    let Some(index) =
                                        q.items.iter().position(|item| item.state == "pending")
                                    else {
                                        break;
                                    };
                                    q.items[index].state = "running".into();
                                    if let Err(e) = save(&home, &q) {
                                        *journal_error.lock().unwrap() =
                                            Some(format!("진행 기록 저장 실패: {e}"));
                                        cancel.store(true, Ordering::Relaxed);
                                        let _ = sender.send((
                                            q.clone(),
                                            format!("진행 기록 저장 실패: {e}"),
                                            true,
                                        ));
                                        break;
                                    }
                                    let _ = sender.send((
                                        q.clone(),
                                        "학습 노트를 작성하고 있습니다".into(),
                                        true,
                                    ));
                                    (index, q.items[index].path.clone())
                                };
                                let result = articles
                                    .iter()
                                    .find(|a| a.path == selected.1)
                                    .ok_or_else(|| anyhow::anyhow!("논문을 찾을 수 없습니다"))
                                    .and_then(|article| {
                                        reading::generate(
                                            article,
                                            &settings,
                                            &home,
                                            cancel.clone(),
                                            &mut |_| {},
                                            &mut |_| {},
                                        )
                                    });
                                let mut q = shared.lock().unwrap();
                                let item = &mut q.items[selected.0];
                                match result {
                                    Ok(_) => item.state = "complete".into(),
                                    Err(e) => {
                                        item.state = if cancel.load(Ordering::Relaxed) {
                                            "cancelled"
                                        } else {
                                            "failed"
                                        }
                                        .into();
                                        item.error = e.to_string();
                                    }
                                }
                                if let Err(e) = save(&home, &q) {
                                    *journal_error.lock().unwrap() =
                                        Some(format!("진행 기록 저장 실패: {e}"));
                                    cancel.store(true, Ordering::Relaxed);
                                    let _ = sender.send((
                                        q.clone(),
                                        format!("진행 기록 저장 실패: {e}"),
                                        true,
                                    ));
                                    break;
                                }
                                let _ = sender.send((
                                    q.clone(),
                                    "학습 노트를 작성하고 있습니다".into(),
                                    true,
                                ));
                            }
                        });
                    }
                });
                Ok(())
            })();
            let q = shared.lock().unwrap().clone();
            let message = if let Some(error) = journal_error.lock().unwrap().clone() {
                error
            } else {
                match result {
                    Err(e) => e.to_string(),
                    Ok(()) => {
                        if cancel.load(Ordering::Relaxed) {
                            "중단했습니다. 완료된 노트는 저장되어 있으며 이어서 작성할 수 있습니다."
                                .into()
                        } else {
                            "일괄 작성을 마쳤습니다. 실패한 항목은 아래에서 확인하세요.".into()
                        }
                    }
                }
            };
            let _ = sender.send((q, message, false));
        });
        cx.notify();
    }
}
impl Render for QueueView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let count = |state: &str| self.queue.items.iter().filter(|i| i.state == state).count();
        div().id("queue-panel").size_full().overflow_y_scroll().p_6().flex().flex_col().gap_4().child(div().text_2xl().child("폴더 학습 노트"))
        .child("기존 노트를 건너뛰거나, 모든 노트를 다시 작성할 수 있습니다. 재작성한 노트의 이전 버전은 보관됩니다.")
        .child(div().text_sm().text_color(cx.theme().muted_foreground).child(format!("{} · {}",if self.busy {"처리 중"} else {"작성 설정"},self.settings.generation_label())))
        .child(div().flex().flex_wrap().gap_2().child(Button::new("queue-missing").label("없는 노트만 준비").disabled(self.busy).on_click(cx.listener(|this,_,_,cx|this.prepare(false,cx)))).child(Button::new("queue-rewrite").label("전체 재작성 준비").disabled(self.busy).on_click(cx.listener(|this,_,_,cx|this.prepare(true,cx)))))
        .child(format!("{}편 · 완료 {} · 기존 노트 {} · 대기 {} · 진행 {} · 실패 {}",self.queue.items.len(),count("complete"),count("skipped"),count("pending")+count("cancelled"),count("running"),count("failed")))
        .child(div().text_sm().text_color(cx.theme().muted_foreground).child(self.queue.root.clone()))
        .child(div().flex().gap_2().child(Button::new("queue-start").label("작성 시작 / 이어서 작성").disabled(self.busy||self.queue.items.is_empty()).on_click(cx.listener(|this,_,_,cx|this.start(cx)))).when(self.busy,|view|view.child(Button::new("queue-stop").label("중단").on_click(cx.listener(|this,_,_,cx|{this.cancel.store(true,Ordering::Relaxed);this.status="현재 요청을 중단하고 있습니다".into();cx.notify();})))))
        .child(self.status.clone()).children(self.queue.items.iter().filter(|item|!item.error.is_empty()).map(|item|div().p_3().border_1().border_color(cx.theme().border).child(format!("{}\n{}",item.title,item.error))))
    }
}
