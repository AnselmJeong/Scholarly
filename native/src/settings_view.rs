use crate::library::Settings;
use gpui_kit::component::button::ButtonVariants;
use gpui_kit::component::{
    ActiveTheme, Disableable, Selectable, Sizable,
    button::Button,
    input::{Input, InputContentType, InputState, Textarea, TextareaState},
};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use std::path::PathBuf;
#[derive(Clone)]
pub(crate) struct Saved(pub(crate) Settings);
pub(crate) struct SettingsView {
    settings: Settings,
    home: PathBuf,
    model: Entity<InputState>,
    codex: Entity<InputState>,
    claude: Entity<InputState>,
    url: Entity<InputState>,
    guidance: Entity<TextareaState>,
    status: String,
    api_key: Entity<InputState>,
    catalog: Vec<serde_json::Value>,
    loading_models: bool,
    advanced: bool,
}
impl EventEmitter<Saved> for SettingsView {}
impl SettingsView {
    pub(crate) fn new(
        settings: Settings,
        home: PathBuf,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        Self {
            model: cx.new(|cx| {
                InputState::new(window, cx)
                    .default_value(settings.model.clone())
                    .placeholder("비워 두면 계정 기본 모델")
            }),
            codex: cx
                .new(|cx| InputState::new(window, cx).default_value(settings.codex_path.clone())),
            claude: cx
                .new(|cx| InputState::new(window, cx).default_value(settings.claude_path.clone())),
            url: cx
                .new(|cx| InputState::new(window, cx).default_value(settings.ollama_url.clone())),
            guidance: cx
                .new(|cx| TextareaState::new(window, cx).default_value(settings.guidance.clone())),
            api_key: cx
                .new(|cx| InputState::new(window, cx).placeholder("새 키를 입력할 때만 변경")),
            catalog: Vec::new(),
            loading_models: false,
            advanced: false,
            settings,
            home,
            status: String::new(),
        }
    }
    fn load_models(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.loading_models {
            return;
        }
        self.loading_models = true;
        self.status = "계정 모델을 확인하고 있습니다".into();
        let mut settings = self.settings.clone();
        settings.codex_path = self.codex.read(cx).value().to_string();
        cx.spawn_in(window, async move |weak, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    crate::provider::models(
                        &settings,
                        std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
                    )
                })
                .await;
            let _ = weak.update_in(cx, |this, _, cx| {
                this.loading_models = false;
                match result {
                    Ok(models) => {
                        this.catalog = models;
                        this.status = "계정에서 사용할 수 있는 모델입니다".into()
                    }
                    Err(e) => this.status = e.to_string(),
                };
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
    fn save(&mut self, cx: &mut Context<Self>) {
        self.settings.model = self.model.read(cx).value().to_string();
        self.settings
            .models_by_provider
            .insert(self.settings.provider.clone(), self.settings.model.clone());
        self.settings.codex_path = self.codex.read(cx).value().to_string();
        self.settings.claude_path = self.claude.read(cx).value().to_string();
        self.settings.ollama_url = self.url.read(cx).value().to_string();
        self.settings.guidance = self.guidance.read(cx).value().to_string();
        let key = self.api_key.read(cx).value().to_string();
        if !key.trim().is_empty()
            && let Err(e) = security_framework::passwords::set_generic_password(
                "Scholarly Native Ollama",
                self.settings.ollama_url.trim_end_matches('/'),
                key.trim().as_bytes(),
            )
        {
            self.status = format!("키 저장 실패: {e}");
            cx.notify();
            return;
        }
        match self.settings.save(&self.home) {
            Ok(()) => cx.emit(Saved(self.settings.clone())),
            Err(e) => self.status = e.to_string(),
        };
        cx.notify();
    }
}
impl Render for SettingsView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div().id("settings-scroll").overflow_y_scroll().size_full().child(div().max_w(rems(45.)).mx_auto().p_6().flex().flex_col().gap_4()
        .child(div().text_xl().child("읽기 설정"))
        .child(div().text_sm().text_color(cx.theme().muted_foreground).child(concat!("Scholarly Native · ", env!("CARGO_PKG_VERSION"))))
        .child("AI 연결").child(div().flex().gap_2().children([("codex","Codex 구독"),("claude","Claude 구독"),("ollama","Ollama")].into_iter().map(|(provider,label)|Button::new(provider).selected(self.settings.provider==provider).label(label).on_click(cx.listener(move|this,_,window,cx|{this.settings.models_by_provider.insert(this.settings.provider.clone(),this.model.read(cx).value().to_string());this.settings.provider=provider.into();let next=this.settings.models_by_provider.get(provider).cloned().unwrap_or_default();this.model.update(cx,|input,cx|input.set_value(next,window,cx));this.catalog.clear();cx.notify();})))))
        .child("모델").child(Input::new(&self.model)).when(self.settings.provider=="codex",|view|view.child(Button::new("load-models").small().label("계정 모델 불러오기").disabled(self.loading_models).on_click(cx.listener(|this,_,window,cx|this.load_models(window,cx)))).child(div().flex().flex_wrap().gap_2().children(self.catalog.iter().filter_map(|model|model["model"].as_str()).map(|name|{let name=name.to_owned();Button::new(SharedString::from(name.clone())).small().label(name.clone()).on_click(cx.listener(move|this,_,window,cx|{this.model.update(cx,|input,cx|input.set_value(name.clone(),window,cx));cx.notify();}))}))))
        .child("추론 강도").child(div().flex().gap_2().flex_wrap().children([("low","낮음"),("default","기본값"),("medium","중간"),("high","높음"),("none","끄기")].into_iter().map(|(effort,label)|Button::new(effort).small().disabled(effort=="none" && this_none_disabled(&self.settings,&self.catalog,&self.model.read(cx).value())).selected(self.settings.effort==effort).label(label).on_click(cx.listener(move|this,_,_,cx|{this.settings.effort=effort.into();cx.notify();})))))
        .child(div().text_sm().text_color(cx.theme().muted_foreground).child("모델이 지원하는 설정만 사용합니다. ‘끄기’를 지원하지 않으면 실행 전에 알려 드립니다."))
        .child("노트 언어").child(div().flex().gap_2().children([("ko","한국어"),("en","English")].into_iter().map(|(lang,label)|Button::new(lang).small().selected(self.settings.language==lang).label(label).on_click(cx.listener(move|this,_,_,cx|{this.settings.language=lang.into();cx.notify();})))))
        .child("추가 읽기 지침").child(Textarea::new(&self.guidance).h(rems(7.)))
        .child(Button::new("advanced-settings").small().ghost().label(if self.advanced{"고급 연결 설정 접기"}else{"고급 연결 설정…"}).on_click(cx.listener(|this,_,_,cx|{this.advanced = !this.advanced;cx.notify();})))
        .when(self.advanced,|view|view.child("Codex 실행 파일 · 비워 두면 자동 탐색").child(Input::new(&self.codex)).child("Claude 실행 파일 · 비워 두면 자동 탐색").child(Input::new(&self.claude)))
        .when(self.settings.provider=="ollama",|view|view.child("Ollama 주소").child(Input::new(&self.url)).child("Ollama API 키 · macOS 키체인에 저장").child(Input::new(&self.api_key).content_type(InputContentType::Password)))
        .child(div().text_sm().text_color(cx.theme().muted_foreground).child("학습 노트는 원문 대조 전 상태로 먼저 저장합니다. 읽기 화면에서 원문 대조를 별도로 실행할 수 있습니다."))
        .child(self.status.clone()).child(Button::new("save-settings").primary().label("저장").on_click(cx.listener(|this,_,_,cx|this.save(cx)))))
    }
}

fn this_none_disabled(settings: &Settings, catalog: &[serde_json::Value], model: &str) -> bool {
    match settings.provider.as_str() {
        "claude" => true,
        "codex" => !catalog
            .iter()
            .find(|m| {
                if model.is_empty() {
                    m["isDefault"] == true
                } else {
                    m["model"] == model
                }
            })
            .and_then(|m| m["supportedReasoningEfforts"].as_array())
            .is_some_and(|values| values.iter().any(|v| v["reasoningEffort"] == "none")),
        _ => false,
    }
}
