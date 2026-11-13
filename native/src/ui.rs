//! Scholarly's original slate palette, shared by the native shell and controls.
use gpui_kit::assets::IconName;
use gpui_kit::{
    component::{
        Sizable, Theme, ThemeMode,
        button::{Button, ButtonVariants},
    },
    *,
};
pub(crate) fn apply(cx: &mut App, dark: bool) {
    Theme::change(
        if dark {
            ThemeMode::Dark
        } else {
            ThemeMode::Light
        },
        None,
        cx,
    );
    Theme::update(cx, |theme| {
        theme.font_size = px(14.);
        theme.radius = px(7.);
        if dark {
            let c = &mut theme.colors;
            c.background = rgb(0x182438).into();
            c.foreground = rgb(0xe2e8f0).into();
            c.sidebar = rgb(0x111a2e).into();
            c.sidebar_foreground = rgb(0x94a3b8).into();
            c.sidebar_border = rgb(0x29364b).into();
            c.border = c.sidebar_border;
            c.input = rgb(0x334155).into();
            c.muted = rgb(0x243249).into();
            c.muted_foreground = rgb(0x94a3b8).into();
            c.primary = rgb(0x60a5fa).into();
            c.primary_hover = rgb(0x93c5fd).into();
            c.primary_active = rgb(0x3b82f6).into();
            c.primary_foreground = rgb(0x0f172a).into();
            c.accent = rgb(0x293c59).into();
            c.accent_foreground = c.foreground;
            c.secondary = rgb(0x25354c).into();
            c.secondary_hover = rgb(0x334760).into();
            c.secondary_active = c.accent;
            c.secondary_foreground = c.foreground;
            c.button = c.secondary;
            c.button_hover = c.secondary_hover;
            c.button_active = c.secondary_active;
            c.button_foreground = c.foreground;
            c.button_primary = rgb(0x3b82f6).into();
            c.button_primary_hover = rgb(0x60a5fa).into();
            c.button_primary_active = rgb(0x2563eb).into();
            c.button_primary_foreground = rgb(0xffffff).into();
            c.popover = rgb(0x172237).into();
            c.popover_foreground = c.foreground;
            c.ring = c.primary;
            c.list = c.background;
            c.list_hover = rgb(0x21314a).into();
            c.list_active = rgb(0x243b5b).into();
            c.list_active_border = c.primary;
            c.table = c.background;
            c.table_head = c.sidebar;
            c.table_head_foreground = c.muted_foreground;
            c.table_row_border = rgb(0x223047).into();
            c.sidebar_accent = c.list_active;
            c.sidebar_accent_foreground = c.primary;
        }
    });
}
pub(crate) fn tool(id: &'static str, icon: IconName, label: &'static str) -> Button {
    Button::new(id)
        .ghost()
        .small()
        .icon(icon)
        .tooltip(label)
        .accessibility_label(label)
}

// Embed only the icons used by this app, in addition to component defaults.
gpui_kit::assets::icon_assets!(
    ExtraIcons,
    [
        Archive,
        ArrowLeft,
        BookOpen,
        Check,
        CheckCheck,
        Download,
        Ellipsis,
        FileText,
        Files,
        Folder,
        FolderOpen,
        Info,
        Library,
        MessagesSquare,
        Minus,
        NotebookPen,
        PanelLeft,
        PanelRight,
        PanelRightClose,
        PanelsTopLeft,
        Pencil,
        Plus,
        RefreshCw,
        RotateCcw,
        Search,
        Send,
        Settings,
        Square,
        Star,
        Tag,
        Tags,
        Users
    ]
);
pub(crate) struct Assets;
impl AssetSource for Assets {
    fn load(&self, path: &str) -> gpui_kit::Result<Option<std::borrow::Cow<'static, [u8]>>> {
        if let Some(data) = ExtraIcons.load(path)? {
            return Ok(Some(data));
        }
        gpui_kit::assets::Assets.load(path)
    }
    fn list(&self, path: &str) -> gpui_kit::Result<Vec<SharedString>> {
        let mut paths = gpui_kit::assets::Assets.list(path)?;
        paths.extend(ExtraIcons.list(path)?);
        paths.sort();
        paths.dedup();
        Ok(paths)
    }
}
