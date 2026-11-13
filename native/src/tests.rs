use crate::{
    figures,
    library::{Library, Settings},
    provider, reading,
};
use std::{
    fs,
    io::{Read, Write},
    net::TcpListener,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

#[test]
fn atomic_versions_and_user_notes_survive_rewriting() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("summary/paper.learning.md");
    reading::atomic_write(&file, b"old", true).unwrap();
    reading::atomic_write(&file, b"new", true).unwrap();
    assert_eq!(fs::read(&file).unwrap(), b"new");
    assert_eq!(
        fs::read(file.with_file_name("paper.learning.md.previous")).unwrap(),
        b"old"
    );
    let db = rusqlite::Connection::open(dir.path().join("database.sqlite")).unwrap();
    drop(db);
    fs::write(dir.path().join("paper.pdf"), b"test PDF").unwrap();
    let mut lib = Library::open(dir.path()).unwrap();
    lib.scan(dir.path()).unwrap();
    let article = lib.articles(dir.path()).unwrap().remove(0);
    lib.save_notes(article.id, "개인 메모 $alpha$").unwrap();
    lib.flag(article.id, true, true).unwrap();
    lib.set_keywords(article.id, "brain, brain, dynamics")
        .unwrap();
    reading::atomic_write(&file, b"rewritten again", true).unwrap();
    assert_eq!(lib.notes(article.id).unwrap(), "개인 메모 $alpha$");
    assert!(lib.articles(dir.path()).unwrap()[0].is_key);
    assert_eq!(
        lib.articles(dir.path()).unwrap()[0]
            .keywords
            .split(',')
            .count(),
        2
    );
    lib.set_keyword_list(
        article.id,
        &["brain, dynamics".into(), "한글 키워드".into()],
    )
    .unwrap();
    let restored = lib.articles(dir.path()).unwrap().remove(0);
    assert_eq!(restored.keyword_list.len(), 2);
    assert!(restored.keyword_list.contains(&"brain, dynamics".into()));
    lib.save_exchange(article.id, "질문", "답변").unwrap();
    assert_eq!(lib.messages(article.id).unwrap().len(), 2);
}
#[test]
fn source_change_invalidates_review_label() {
    let dir = tempfile::tempdir().unwrap();
    let pdf = dir.path().join("paper.pdf");
    fs::write(&pdf, b"source A").unwrap();
    let file = reading::output_path(&pdf);
    reading::atomic_write(&file, b"content", false).unwrap();
    let review = serde_json::json!({"passed":true,"body_sha256":reading::hash("content"),"source_sha256":reading::hash("source A"),"findings":[]});
    reading::atomic_write(
        &file.with_extension("review.json"),
        &serde_json::to_vec(&review).unwrap(),
        false,
    )
    .unwrap();
    assert!(reading::read_note(&pdf).unwrap().1.contains("대조 완료"));
    fs::write(&pdf, b"source B").unwrap();
    assert!(!reading::read_note(&pdf).unwrap().1.contains("대조 완료"));
    assert!(
        reading::review_description(&pdf)
            .unwrap()
            .contains("바뀌었습니다")
    );
}
#[test]
fn math_html_is_portable_and_untrusted_markup_stays_inert() {
    let content = crate::reader_html::markup(
        "# 학습\n\n**흥분·억제 균형(E/I)**은 중요한 개념이다.\n\n비율 \\(\\frac{E}{I}\\)\n\n<script>alert(1)</script>\n\n[link](javascript:alert)\n\n| A | B |\n|---|---|\n| 1 | 2 |",
    );
    assert!(content.contains("data-tex="));
    assert!(content.contains("<table>"));
    assert!(content.contains("<strong>흥분·억제 균형(E/I</strong>)은"));
    assert!(!content.contains("<script>"));
    assert!(!content.contains("href=\"javascript:"));
    let html = crate::reader_html::shell(&content, "<unsafe>");
    assert!(html.contains("data:font/woff2;base64,"));
    assert!(html.contains("&lt;unsafe&gt;"));
    assert!(html.contains("script-src 'nonce-scholarly-reader-v1'"));
}
#[test]
fn figure_integrity_and_changed_headings_do_not_silently_relocate() {
    let dir = tempfile::tempdir().unwrap();
    let pdf = dir.path().join("paper.pdf");
    fs::write(&pdf, b"source").unwrap();
    let assets = reading::output_path(&pdf).with_extension("assets");
    fs::create_dir_all(&assets).unwrap();
    fs::write(assets.join("figure.png"), b"pixels").unwrap();
    let figure = figures::Figure {
        id: "a".into(),
        page: 2,
        rect: [0., 0., 1., 1.],
        heading: "## Method".into(),
        caption: "Figure 1".into(),
        source_sha256: reading::hash("source"),
        image_sha256: reading::hash("pixels"),
        image_file: "figure.png".into(),
        aspect_ratio: 1.,
    };
    reading::atomic_write(
        &reading::output_path(&pdf).with_extension("figures.json"),
        &serde_json::to_vec(&vec![figure]).unwrap(),
        false,
    )
    .unwrap();
    let blocks = figures::blocks(
        "## Method\n\nModel settings.\n\nMechanism explained [Fig. 1].\n\nNext.",
        &pdf,
    )
    .unwrap();
    assert!(
        blocks
            .iter()
            .any(|b| matches!(b,figures::Block::Figure(_,_,text) if text.contains("Mechanism")))
    );
    assert!(
        matches!(&blocks[0], figures::Block::Text(text) if text.contains("Model settings.") && !text.contains("Mechanism"))
    );
    let unmatched =
        figures::blocks("## Method\n\nA different result [Fig. 10].\n\nNext.", &pdf).unwrap();
    assert!(
        unmatched
            .iter()
            .any(|b| matches!(b, figures::Block::Figure(_, _, context) if context.is_empty()))
    );
    assert!(unmatched.iter().any(|b| matches!(b, figures::Block::Text(text) if text.contains("different result") && text.contains("Next."))));
    let range = figures::blocks("## Method\n\nRelevant results [Figs. 1–2].", &pdf).unwrap();
    assert!(range.iter().any(|b| matches!(b, figures::Block::Figure(_, _, context) if context.contains("Relevant results"))));
    let changed = figures::blocks("## Different method\n\nNew text.", &pdf).unwrap();
    assert!(
        changed
            .iter()
            .any(|b| matches!(b,figures::Block::Text(t) if t.contains("보관한 원문 그림")))
    );
    fs::write(assets.join("figure.png"), b"changed").unwrap();
    assert!(figures::load(&pdf).unwrap().is_empty());
}
fn ollama_settings(address: std::net::SocketAddr) -> Settings {
    Settings {
        provider: "ollama".into(),
        model: "test".into(),
        effort: "default".into(),
        ollama_url: format!("http://{address}/v1"),
        ..Default::default()
    }
}
#[test]
fn streamed_unicode_is_complete_and_stalled_http_is_cancellable() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let (mut s, _) = listener.accept().unwrap();
        let mut request = [0; 4096];
        let _ = s.read(&mut request);
        let body = "data: {\"choices\":[{\"delta\":{\"content\":\"한글 설명\"}}]}\r\n\r\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
        write!(
            s,
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\n\r\n",
            body.len()
        )
        .unwrap();
        for byte in body.bytes() {
            s.write_all(&[byte]).unwrap();
        }
    });
    let response = provider::complete(
        &ollama_settings(address),
        "system",
        "user",
        Arc::new(AtomicBool::new(false)),
        &mut |_| {},
    )
    .unwrap();
    assert_eq!(response.text, "한글 설명");
    server.join().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let cancelled = Arc::new(AtomicBool::new(false));
    let trigger = cancelled.clone();
    let server = std::thread::spawn(move || {
        let (mut s, _) = listener.accept().unwrap();
        let mut request = [0; 4096];
        let _ = s.read(&mut request);
        write!(s,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n").unwrap();
        std::thread::sleep(Duration::from_millis(120));
        trigger.store(true, Ordering::Relaxed);
        std::thread::sleep(Duration::from_millis(180));
    });
    let started = Instant::now();
    assert!(
        provider::complete(
            &ollama_settings(address),
            "system",
            "user",
            cancelled,
            &mut |_| {}
        )
        .is_err()
    );
    assert!(started.elapsed() < Duration::from_secs(2));
    server.join().unwrap();
}
#[test]
fn references_are_omitted_without_losing_appendices() {
    let mut doc = reading::Document {
        page_count: 5,
        references_omitted: false,
        pages: vec![
            reading::Page {
                page_number: 1,
                text: "Introduction".into(),
            },
            reading::Page {
                page_number: 3,
                text: "Results\nReferences\nUnrelated citation".into(),
            },
            reading::Page {
                page_number: 4,
                text: "More citations".into(),
            },
            reading::Page {
                page_number: 5,
                text: "Appendix A\nEssential formula".into(),
            },
        ],
    };
    reading::omit_references(&mut doc).unwrap();
    assert!(doc.references_omitted);
    assert_eq!(doc.pages.len(), 3);
    assert!(doc.pages[2].text.contains("Essential formula"));
    assert!(!doc.pages.iter().any(|p| p.text.contains("citation")));
}
#[test]
fn long_source_chunking_preserves_every_physical_page() {
    let doc = reading::Document {
        page_count: 4,
        references_omitted: false,
        pages: (1..=4)
            .map(|n| reading::Page {
                page_number: n,
                text: format!("unique-page-{n} {}", "본문 ".repeat(25)),
            })
            .collect(),
    };
    let parts = reading::source_chunks(&doc, 400).unwrap();
    assert_eq!(parts.len(), 4);
    for n in 1..=4 {
        assert_eq!(
            parts
                .iter()
                .filter(|s| s.contains(&format!("unique-page-{n}")))
                .count(),
            1
        );
    }
    assert!(reading::source_chunks(&doc, 10).is_err());
}

fn fake_codex(mode: &str) -> (tempfile::TempDir, Settings) {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("codex");
    let script=r#"#!/usr/bin/python3
import sys,json,time,os
mode='MODE'
def send(value): print(json.dumps(value),flush=True)
for line in sys.stdin:
    value=json.loads(line); method=value.get('method'); ident=value.get('id')
    if ident is None: continue
    if method=='initialize': result={}
    elif method=='account/read': result={'account':{'type':'chatgpt'}}
    elif method=='model/list': result={'data':[{'model':'fixture','isDefault':True,'defaultReasoningEffort':'low','supportedReasoningEfforts':[{'reasoningEffort':'low'}]}],'nextCursor':None}
    elif method=='account/rateLimits/read': result={'ordinaryUsageAllowed':mode!='quota','rateLimits':{'primary':{'usedPercent':1}}}
    elif method=='thread/start':
        result={'thread':{'id':'thread'}}
        if mode=='blocked':
            send({'id':ident,'result':result}); time.sleep(60); continue
    elif method=='turn/start':
        base={'threadId':'thread','turnId':'turn'}
        send({'method':'item/started','params':dict(base,item={'id':'progress','type':'agentMessage','phase':'commentary'})})
        send({'method':'item/agentMessage/delta','params':dict(base,itemId='progress',delta='Do not show this commentary')})
        send({'method':'item/started','params':dict(base,item={'id':'answer','type':'agentMessage','phase':'final_answer'})})
        send({'method':'item/agentMessage/delta','params':dict(base,itemId='answer',delta='학습 설명')})
        send({'method':'item/completed','params':dict(base,item={'id':'answer','type':'agentMessage','phase':'final_answer','text':'학습 설명'})})
        send({'method':'turn/completed','params':dict(base,turn={'id':'turn','status':'completed'})})
        result={'turn':{'id':'turn'}}
    else: result={}
    send({'id':ident,'result':result})
"#.replace("MODE",mode);
    fs::write(&path, script).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    let settings = Settings {
        provider: "codex".into(),
        codex_path: path.to_string_lossy().into_owned(),
        effort: "low".into(),
        ..Default::default()
    };
    (dir, settings)
}
#[test]
fn codex_handles_early_events_without_exposing_commentary_and_refuses_exhausted_usage() {
    let (_dir, settings) = fake_codex("normal");
    let mut seen = Vec::new();
    let result = provider::complete(
        &settings,
        "system",
        "source",
        Arc::new(AtomicBool::new(false)),
        &mut |text| seen.push(text.to_owned()),
    )
    .unwrap();
    assert_eq!(result.text, "학습 설명");
    assert!(seen.iter().all(|t| !t.contains("commentary")));
    let (_dir, settings) = fake_codex("quota");
    let error = provider::complete(
        &settings,
        "system",
        "source",
        Arc::new(AtomicBool::new(false)),
        &mut |_| {},
    )
    .err()
    .unwrap();
    assert!(error.to_string().contains("사용량"));
}
#[test]
fn codex_can_cancel_even_when_subprocess_stops_reading_a_large_prompt() {
    let (_dir, settings) = fake_codex("blocked");
    let cancel = Arc::new(AtomicBool::new(false));
    let trigger = cancel.clone();
    let timer = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        trigger.store(true, Ordering::Relaxed);
    });
    let start = Instant::now();
    let result = provider::complete(
        &settings,
        "system",
        &"x".repeat(2_000_000),
        cancel,
        &mut |_| {},
    );
    assert!(result.is_err());
    assert!(start.elapsed() < Duration::from_secs(3));
    timer.join().unwrap();
}
#[test]
fn legacy_single_dollar_display_and_block_math_keep_tex_intact() {
    let equation = r"dFC_{ij}=\operatorname{Var}_{w}\!\left(r_{ij}^{(w)}\right)";
    let display = crate::reader_html::markup(&format!("${equation}$"));
    assert!(display.contains("class=\"math-display\""));
    assert!(display.contains(equation));
    let normal = crate::reader_html::markup(&format!("여기서 ${equation}$는 분산이다."));
    assert!(normal.contains("class=\"math-inline\""));
    let block = crate::reader_html::markup(&format!("$$\n{equation}\n$$"));
    assert!(block.contains("class=\"math-display\""));
    assert!(block.contains(equation));
}
#[test]
fn automatic_visuals_match_exact_kind_number_and_keep_table_continuations() {
    use crate::source_visuals::{Asset, Visual};
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("page.png");
    fs::write(&path, b"png").unwrap();
    let assets = vec![
        ("figure", "1", 2),
        ("figure", "10", 3),
        ("table", "1", 4),
        ("table", "1", 5),
        ("figure", "S1", 6),
    ]
    .into_iter()
    .map(|(kind, n, page)| Asset {
        path: path.clone(),
        visual: Visual {
            kind: kind.into(),
            number: n.into(),
            label: format!("{kind} {n}"),
            page,
            caption: "Original caption".into(),
            rect: [0., 0., 1., 1.],
            cropped: false,
        },
    })
    .collect::<Vec<_>>();
    let content=crate::reader_html::content("## Method\n\n그림 10에서 결과를 확인한다.\n\nTable 1의 표본을 비교한다.\n\nFigure S1의 보조 결과.",&assets).unwrap();
    assert!(
        content.find("data-visual=\"figure 10\"").unwrap() < content.find("Table 1의").unwrap()
    );
    assert!(
        content.find("data-visual=\"figure 1\"").unwrap()
            > content.find("원문의 그림과 표").unwrap()
    );
    assert_eq!(content.matches("data-visual=\"table 1\"").count(), 2);
    assert!(content.contains("data-page=\"5\""));
    assert_eq!(
        crate::source_visuals::references("Figs. 1–3"),
        vec![
            ("figure".into(), "1".into()),
            ("figure".into(), "2".into()),
            ("figure".into(), "3".into())
        ]
    );
}

#[test]
fn figures_follow_explanations_instead_of_overviews_or_coverage() {
    use crate::source_visuals::{Asset, Visual};
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("figure.png");
    fs::write(&path, b"png").unwrap();
    let assets = ["1", "2", "3", "10", "S1"].map(|number| Asset {
        path: path.clone(),
        visual: Visual {
            kind: "figure".into(),
            number: number.into(),
            label: format!("Figure {number}"),
            page: 3,
            caption: "Original caption".into(),
            rect: [0., 0., 0.98, 0.7],
            cropped: true,
        },
    });
    let body = "# 0. Snapshot\n\nQuick overview [Fig. 1].\n\n# 3. Section-by-Section Digest\n## Results\nGeneral comparison [Figs. 1, 2 and 3].\n\nSpecific mechanism explained here [Fig. 1].\n\n```text\nFigure 10\n\nCode stays intact.\n```\n\n- Inventory Figure S1\n\n> Quoted Figure 10\n\n# 6. Coverage Map\n## Captions\nFigures 1–3, 10 and S1 were read.\n";
    let content = crate::reader_html::content(body, &assets).unwrap();
    let pairs: Vec<_> = content
        .split("class=\"visual visual-pair\"")
        .skip(1)
        .map(|s| s.split("</section>").next().unwrap())
        .collect();
    assert_eq!(pairs.len(), 2);
    assert!(pairs[0].contains("General comparison"));
    assert!(pairs[0].contains("data-visual=\"Figure 2\""));
    assert!(pairs[0].contains("data-visual=\"Figure 3\""));
    assert!(!pairs[0].contains("data-visual=\"Figure 1\""));
    assert!(pairs[1].contains("Specific mechanism"));
    assert!(pairs[1].contains("data-visual=\"Figure 1\""));
    assert!(pairs[1].find("Specific mechanism").unwrap() < pairs[1].find("<figure").unwrap());
    assert_eq!(content.matches("data-visual=\"Figure 1\"").count(), 1);
    let gallery = content.find("class=\"visual-gallery\"").unwrap();
    for label in ["10", "S1"] {
        assert!(
            content
                .find(&format!("data-visual=\"Figure {label}\""))
                .unwrap()
                > gallery
        );
    }
    assert!(content.contains("Figure 10\n\nCode stays intact.\n</code></pre>"));
    assert!(content.contains("<h2>Results</h2>"));
    // A synopsis is still useful when it is the only actual explanation.
    let overview =
        crate::reader_html::content("# 한눈에 보기\n\nFigure 1 explains the result.", &assets)
            .unwrap();
    assert_eq!(overview.matches("class=\"visual visual-pair\"").count(), 1);
}

#[test]
fn visual_reference_lists_preserve_number_kind_and_supplement() {
    let actual = crate::source_visuals::references(
        "Figs. 1, 2 and 3; Table 1; 그림 4와 5; 표 2 및 3; Figures S1–S3; Fig. 1, Fig. 10.",
    );
    let expected = [
        ("figure", "1"),
        ("figure", "2"),
        ("figure", "3"),
        ("table", "1"),
        ("figure", "4"),
        ("figure", "5"),
        ("table", "2"),
        ("table", "3"),
        ("figure", "S1"),
        ("figure", "S2"),
        ("figure", "S3"),
        ("figure", "10"),
    ];
    assert_eq!(
        actual,
        expected.map(|(kind, number)| (kind.to_string(), number.to_string()))
    );
}
