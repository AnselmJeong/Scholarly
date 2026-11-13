//! A system WKWebView confined to the reading rectangle; the desktop shell stays GPUI.
use gpui_kit::*;
use std::{cell::RefCell, rc::Rc, sync::mpsc};
use wry::{
    Rect, WebView, WebViewBuilder,
    dpi::{LogicalPosition, LogicalSize},
};

pub(crate) struct HtmlSurface {
    view: Rc<WebView>,
    receiver: mpsc::Receiver<serde_json::Value>,
    ready: bool,
    content: String,
    sent: String,
    key: i64,
    sent_key: i64,
    dark: bool,
    font_size: f32,
    visible: Rc<RefCell<bool>>,
}
impl HtmlSurface {
    pub(crate) fn new(window: &Window) -> anyhow::Result<Self> {
        let (sender, receiver) = mpsc::channel();
        let view = WebViewBuilder::new()
            .with_html(crate::reader_html::shell("", "Scholarly"))
            .with_visible(false)
            .with_incognito(true)
            .with_accept_first_mouse(true)
            .with_navigation_handler(|url| url == "about:blank")
            .with_ipc_handler(move |request| {
                if let Ok(message) = serde_json::from_str::<serde_json::Value>(request.body()) {
                    let _ = sender.send(message);
                }
            })
            .build_as_child(window)?;
        Ok(Self {
            view: Rc::new(view),
            receiver,
            ready: false,
            content: String::new(),
            sent: String::new(),
            key: 0,
            sent_key: -1,
            dark: true,
            font_size: 17.,
            visible: Rc::new(RefCell::new(false)),
        })
    }
    pub(crate) fn set_content(&mut self, key: i64, content: String) {
        self.key = key;
        self.content = content;
        self.flush();
    }
    pub(crate) fn messages(&mut self) -> Vec<serde_json::Value> {
        let messages: Vec<_> = self.receiver.try_iter().collect();
        if messages.iter().any(|m| m["ready"] == true) {
            self.ready = true;
            self.sent.clear();
            self.flush();
        }
        messages
    }
    fn flush(&mut self) {
        if !self.ready || (self.content == self.sent && self.key == self.sent_key) {
            return;
        }
        let script = format!(
            "renderNote({},{},{},{});",
            serde_json::to_string(&self.content).unwrap(),
            self.dark,
            self.font_size,
            self.key != self.sent_key
        );
        if self.view.evaluate_script(&script).is_ok() {
            self.sent = self.content.clone();
            self.sent_key = self.key;
        }
    }
    pub(crate) fn hide(&self) {
        if *self.visible.borrow() {
            let _ = self.view.set_visible(false);
            *self.visible.borrow_mut() = false;
        }
    }
    pub(crate) fn element(&mut self, dark: bool, font_size: f32) -> AnyElement {
        if self.dark != dark || self.font_size != font_size {
            self.dark = dark;
            self.font_size = font_size;
            let _=self.view.evaluate_script(&format!("document.documentElement.dataset.dark='{dark}';document.body.style.fontSize='{font_size}px';"));
        }
        let view = self.view.clone();
        let visible = self.visible.clone();
        canvas(
            move |bounds, _, _| {
                let _ = view.set_bounds(Rect {
                    position: LogicalPosition::new(
                        f64::from(f32::from(bounds.origin.x)),
                        f64::from(f32::from(bounds.origin.y)),
                    )
                    .into(),
                    size: LogicalSize::new(
                        f64::from(f32::from(bounds.size.width)),
                        f64::from(f32::from(bounds.size.height)),
                    )
                    .into(),
                });
                if !*visible.borrow() {
                    let _ = view.set_visible(true);
                    *visible.borrow_mut() = true;
                }
            },
            |_, _, _, _| {},
        )
        .size_full()
        .into_any_element()
    }
}
