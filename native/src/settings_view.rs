use crate::{library::Settings, provider};
use gpui_kit::component::button::ButtonVariants;
use gpui_kit::component::{
    ActiveTheme, Disableable, Sizable,
    button::Button,
    input::{Input, InputContentType, InputState, Textarea, TextareaState},
    radio::{Radio, RadioGroup},
    select::{Select, SelectEvent, SelectState},
};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
#[derive(Clone)]
pub(crate) struct Saved(pub(crate) Settings);
pub(crate) struct SettingsView {
    settings: Settings,
    opened_connection: (String, String),
    home: PathBuf,
    model: Entity<SelectState<Vec<SharedString>>>,
    codex: Entity<InputState>,
    claude: Entity<InputState>,
    url: Entity<InputState>,
    guidance: Entity<TextareaState>,
    status: String,
    api_key: Entity<InputState>,
    catalog: Vec<serde_json::Value>,
    loading_models: bool,
    advanced: bool,
    epoch: u64,
    cancel: provider::Cancel,
    _selection: Subscription,
}
impl EventEmitter<Saved> for SettingsView {}
impl Drop for SettingsView {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Relaxed);
    }
}
impl SettingsView {
    pub(crate) fn new(
        settings: Settings,
        home: PathBuf,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let model = cx.new(|cx| {
            SelectState::new(Vec::<SharedString>::new(), None, window, cx).searchable(true)
        });
        let selection = cx.subscribe_in(&model, window, |this, _, event, _, cx| {
            let SelectEvent::Confirm(value) = event;
            this.settings.model = value.as_ref().map(ToString::to_string).unwrap_or_default();
            if !this.effort_available(&this.settings.effort) {
                this.settings.effort = "default".into();
            }
            cx.notify();
        });
        Self {
            model,
            _selection: selection,
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
            epoch: 0,
            cancel: Arc::new(AtomicBool::new(false)),
            opened_connection: (settings.provider.clone(), settings.model.clone()),
            settings,
            home,
            status: String::new(),
        }
    }
    pub(crate) fn open(&mut self, settings: Settings, window: &mut Window, cx: &mut Context<Self>) {
        self.opened_connection = (settings.provider.clone(), settings.model.clone());
        self.settings = settings;
        self.codex.update(cx, |v, cx| {
            v.set_value(self.settings.codex_path.clone(), window, cx)
        });
        self.claude.update(cx, |v, cx| {
            v.set_value(self.settings.claude_path.clone(), window, cx)
        });
        self.url.update(cx, |v, cx| {
            v.set_value(self.settings.ollama_url.clone(), window, cx)
        });
        self.guidance.update(cx, |v, cx| {
            v.set_value(self.settings.guidance.clone(), window, cx)
        });
        self.load_models(window, cx);
    }
    fn choose_provider(&mut self, provider: &str, window: &mut Window, cx: &mut Context<Self>) {
        self.settings
            .models_by_provider
            .insert(self.settings.provider.clone(), self.settings.model.clone());
        self.settings.provider = provider.into();
        self.settings.model = self
            .settings
            .models_by_provider
            .get(provider)
            .cloned()
            .unwrap_or_default();
        self.load_models(window, cx);
    }
    fn load_models(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.cancel.store(true, Ordering::Relaxed);
        self.cancel = Arc::new(AtomicBool::new(false));
        self.epoch += 1;
        let epoch = self.epoch;
        let cancel = self.cancel.clone();
        self.loading_models = true;
        self.catalog.clear();
        self.model
            .update(cx, |v, cx| v.set_items(Vec::new(), window, cx));
        self.status = format!(
            "{}에서 사용할 수 있는 모델을 확인하고 있습니다",
            self.settings.provider_label()
        );
        let mut settings = self.settings.clone();
        settings.codex_path = self.codex.read(cx).value().to_string();
        settings.claude_path = self.claude.read(cx).value().to_string();
        settings.ollama_url = self.url.read(cx).value().to_string();
        let key = Some(self.api_key.read(cx).value().to_string());
        cx.spawn_in(window,async move |weak,cx| {
            let result=cx.background_executor().spawn(async move {provider::models(&settings,cancel,key)}).await;
            let _=weak.update_in(cx,|this,window,cx| {
                if epoch!=this.epoch {return;}
                this.loading_models=false;
                match result {
                    Ok(models)=>{
                        let values:Vec<SharedString>=models.iter().filter_map(|m|m["model"].as_str()).map(Into::into).collect();
                        if let Some(resolved)=models.iter().find(|m|m["aliases"].as_array().is_some_and(|a|a.iter().any(|v|v==&this.settings.model))).and_then(|m|m["model"].as_str()) {
                            this.settings.model=resolved.into();
                        }
                        if this.settings.model.is_empty() {
                            this.settings.model=models.iter().find(|m|m["isDefault"]==true).and_then(|m|m["model"].as_str()).unwrap_or("").into();
                        }
                        let selected=values.iter().find(|s|s.as_ref()==this.settings.model).cloned();
                        this.model.update(cx,|v,cx|{v.set_items(values,window,cx);if let Some(value)=selected.as_ref(){v.set_selected_value(value,window,cx);}else{v.set_selected_index(None,window,cx);}});
                        this.status=if models.is_empty(){"사용 가능한 모델이 없습니다. 연결 주소와 계정을 확인하세요.".into()}
                            else if selected.is_none(){"목록에서 사용할 모델을 선택하세요.".into()}
                            else{format!("사용 가능한 모델 {}개 · 연결 확인됨",models.len())};
                        this.catalog=models;
                        if !this.effort_available(&this.settings.effort) {this.settings.effort="default".into();}
                    },
                    Err(e)=>this.status=format!("모델 목록을 불러오지 못했습니다. 연결 설정을 확인한 뒤 새로 고침하세요. {e}"),
                }
                cx.notify();
            });
        }).detach();
        cx.notify();
    }
    fn effort_available(&self, effort: &str) -> bool {
        if effort == "default" {
            return true;
        }
        if self.settings.provider == "ollama" {
            return matches!(effort, "none" | "low" | "medium" | "high");
        }
        self.catalog
            .iter()
            .find(|m| m["model"] == self.settings.model)
            .and_then(|m| m["supportedReasoningEfforts"].as_array())
            .is_some_and(|values| values.iter().any(|v| v["reasoningEffort"] == effort))
    }
    fn save(&mut self, cx: &mut Context<Self>) {
        if !self.can_save(cx) {
            return;
        }
        if let Some(model) = self.model.read(cx).selected_value() {
            self.settings.model = model.to_string();
        }
        self.settings
            .models_by_provider
            .insert(self.settings.provider.clone(), self.settings.model.clone());
        self.settings.codex_path = self.codex.read(cx).value().to_string();
        self.settings.claude_path = self.claude.read(cx).value().to_string();
        self.settings.ollama_url = self.url.read(cx).value().to_string();
        self.settings.guidance = self.guidance.read(cx).value().to_string();
        let key = self.api_key.read(cx).value().to_string();
        if self.settings.provider == "ollama"
            && !key.trim().is_empty()
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
    fn can_save(&self, cx: &App) -> bool {
        !self.loading_models
            && (self.model.read(cx).selected_value().is_some()
                || self.opened_connection
                    == (self.settings.provider.clone(), self.settings.model.clone()))
    }
}
impl Render for SettingsView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let providers = [
            ("codex", "Codex 구독"),
            ("claude", "Claude 구독"),
            ("ollama", "Ollama"),
        ];
        let efforts = [
            ("default", "모델 기본값"),
            ("low", "낮음"),
            ("medium", "중간"),
            ("high", "높음"),
            ("xhigh", "매우 높음"),
            ("max", "최대"),
            ("none", "끄기"),
        ];
        div().id("settings-scroll").overflow_y_scroll().size_full().child(
            div().max_w(rems(45.)).mx_auto().p_6().flex().flex_col().gap_6()
            .child(div().flex().flex_col().gap_2().child(div().text_xl().font_weight(FontWeight::SEMIBOLD).child("읽기 설정"))
                .child(div().text_sm().text_color(cx.theme().muted_foreground).child("사용할 AI와 노트 작성 언어를 선택합니다. 저장 후 시작하는 작업에 적용됩니다.")))
            .child(div().flex().flex_col().gap_3().child("AI 연결")
                .child(RadioGroup::horizontal("provider").selected_index(providers.iter().position(|(p,_)|*p==self.settings.provider))
                    .children(providers.map(|(id,label)|Radio::new(id).label(label)))
                    .on_change(cx.listener(move|this,index: &usize,window,cx|this.choose_provider(providers[*index].0,window,cx)))))
            .when(self.settings.provider=="ollama",|view|view.child(div().flex().flex_col().gap_2()
                .child("Ollama 주소 · /v1 포함").child(Input::new(&self.url))
                .child("Ollama API 키 · macOS 키체인에 저장").child(Input::new(&self.api_key).content_type(InputContentType::Password))))
            .child(div().flex().flex_col().gap_2().child("모델")
                .child(div().flex().gap_2().child(Select::new(&self.model).accessibility_label("사용할 AI 모델").placeholder(if self.loading_models{"모델 불러오는 중…"}else{"모델 선택"}).disabled(self.loading_models).flex_1().min_w_0())
                    .child(Button::new("load-models").label("새로 고침").disabled(self.loading_models).on_click(cx.listener(|this,_,window,cx|this.load_models(window,cx)))))
                .child(div().text_sm().text_color(cx.theme().muted_foreground).child(self.status.clone())))
            .child(div().flex().flex_col().gap_3().child("추론 강도")
                .child(RadioGroup::horizontal("reasoning").flex_wrap().selected_index(efforts.iter().position(|(e,_)|*e==self.settings.effort))
                    .children(efforts.map(|(id,label)|Radio::new(id).label(label).disabled(!self.effort_available(id))))
                    .on_change(cx.listener(move|this,index: &usize,_,cx|{this.settings.effort=efforts[*index].0.into();cx.notify();})))
                .child(div().text_sm().text_color(cx.theme().muted_foreground).child("선택한 모델이 지원하는 항목을 사용합니다. 모델 목록 조회에는 노트 생성을 요청하지 않습니다.")))
            .child(div().flex().flex_col().gap_3().child("노트 작성 언어")
                .child(RadioGroup::horizontal("note-language").selected_index(Some(usize::from(self.settings.language=="en")))
                    .child(Radio::new("ko").label("한국어로 작성")).child(Radio::new("en").label("영어로 작성"))
                    .on_change(cx.listener(|this,index: &usize,_,cx|{this.settings.language=if *index==1{"en"}else{"ko"}.into();cx.notify();})))
                .child(div().text_sm().text_color(cx.theme().muted_foreground).child(format!("새 노트는 {}로 작성합니다. 기존 노트의 언어는 바뀌지 않습니다.",self.settings.language_label()))))
            .child(div().flex().flex_col().gap_3().child("읽기 화면")
                .child(RadioGroup::horizontal("reader-appearance").selected_index(Some(usize::from(self.settings.reader_appearance!="paper")))
                    .child(Radio::new("paper").label("따뜻한 종이색")).child(Radio::new("night").label("어두운 청회색"))
                    .on_change(cx.listener(|this,index: &usize,_,cx|{this.settings.reader_appearance=if *index==1{"night"}else{"paper"}.into();cx.notify();})))
                .child(div().text_sm().text_color(cx.theme().muted_foreground).child("서재 색상과 별도로, 요약을 읽는 화면에 적용합니다.")))
            .child(div().flex().flex_col().gap_2().child("추가 읽기 지침").child(Textarea::new(&self.guidance).h(rems(7.))))
            .child(Button::new("advanced-settings").small().ghost().label(if self.advanced{"고급 연결 설정 접기"}else{"고급 연결 설정…"}).on_click(cx.listener(|this,_,_,cx|{this.advanced = !this.advanced;cx.notify();})))
            .when(self.advanced,|view|view.child(div().flex().flex_col().gap_2().child("Codex 실행 파일 · 비워 두면 자동 탐색").child(Input::new(&self.codex)).child("Claude 실행 파일 · 비워 두면 자동 탐색").child(Input::new(&self.claude))))
            .child(div().flex().items_center().justify_between().gap_4()
                .child(div().text_sm().text_color(cx.theme().muted_foreground).child(concat!("Scholarly Native ",env!("CARGO_PKG_VERSION"))))
                .child(Button::new("save-settings").primary().label("설정 저장").disabled(!self.can_save(cx)).on_click(cx.listener(|this,_,_,cx|this.save(cx)))))
        )
    }
}
