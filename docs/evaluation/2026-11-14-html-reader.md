# 0.10.2 HTML reading and source visuals

## Problem and behavior

The native Markdown widget displayed some standalone equations as literal TeX and required manual figure attachment. An interim HTML build still showed entire source pages. Version 0.10.2 (build 12) uses one offline HTML renderer for the installed reader and exports, with bundled KaTeX, selectable HTML tables, and source-numbered automatic figure/table extraction. Existing notes are rendered again without rewriting their contents or making a model call.

The GPUI desktop layout remains intact. A child system WKWebView occupies only the reading pane. Chromium, Python, Node, and the previous Typst executable are not bundled. The KaTeX license and Wry dependency notices are included.

## Source extraction

[DeepPaperNote](https://github.com/917Dhj/DeepPaperNote) and its caption-based PDF asset extraction were inspected as the reference. This implementation uses native PDFKit text geometry and a CoreGraphics content scanner, independently implemented in `native/platform/pdf-helper.swift`.

- Locate Figure/Fig./Table labels, including supplementary numbers and continued tables.
- Use embedded image bounds, vector paths, outlined panel labels, horizontal rules and joined cell edges to isolate each source item. Preserve table notes while excluding the following prose.
- Handle figures with captions below or beside the panels; include all panels, legends and axes in the tested examples.
- Match exact kind and number to the explanatory paragraph. Figure 1 is distinct from Table 1 and Figure 10. Unreferenced items remain in a separate expandable gallery.
- Keep original source tables as image crops to preserve exact values and footnotes. Concept/comparison tables in the generated note use actual HTML table cells. The prompt distinguishes these two kinds of tables.
- Cache by PDF SHA-256 under `source-visuals-v2`, invalidating the interim full-page cache. Uncertain extraction is explicitly labelled and its source page is collapsed, never presented as a successfully extracted figure.

This is geometry-based extraction, not OCR or semantic image interpretation. Other publishers, rotated pages and scanned PDFs still require separate evaluation. Source PDF and existing note contents remain unchanged.

## Checks

- Rust: 11 tests, including the exact reported `$dFC_{ij}=\operatorname{Var}_{w}\!\left(r_{ij}^{(w)}\right)$`, inline/block math, inert untrusted markup, reference matching, continued tables, cancellation and preservation of prior notes. Clippy with `-D warnings`.
- Synthetic PDF regression: a table with notes above a separate figure; a cell-segment grid with a caption below it; a four-panel vector figure with a side caption; a body mention that must not be treated as a caption. Tests assert included geometry, excluded prose and valid cropped PNGs.
- Seven actual PDFs: Rusch, Nair, Brinkman, Menon, Lappin, Bruining and the user-reported Liu paper. 53 source items (44 figures and 9 table page segments) were individually extracted and inspected. Local review sheets are under `.scholarly-eval/geometry-v3/` and are not published with copyrighted paper material.
- Extraction plus PNG generation in the local review script: 0.91–8.26 seconds per PDF; this includes all assets, not model generation. Cached notes avoid repeating this work. These are local observations, not a general latency guarantee.
- The system WebKit smoke harness passed at 780px and 420px: 165 rendered math expressions and 53 source images across the seven papers, zero math errors, zero broken images, fonts loaded, no document overflow. A separate fixture passed with eight expressions, one HTML comparison table and six source images. The original note SHA-256 was unchanged for every export.

## Reproduction

```sh
cargo +1.99.0 test --manifest-path native/Cargo.toml
cargo +1.99.0 clippy --manifest-path native/Cargo.toml --all-targets -- -D warnings
bash scripts/package-native.sh release
python3 scripts/check-source-visuals.py native/target/pdf-helper
swiftc -O native/platform/reader-check.swift -o native/target/reader-check
"native/target/Scholarly Native.app/Contents/MacOS/Scholarly" --export-html /path/paper.pdf /path/note.html
native/target/reader-check /path/note.html 780
native/target/reader-check /path/note.html 420
```

These rendering checks do not call a model. Generation/provider and prior migration results remain in [the previous evaluation](2026-11-13-learning-native.md); they are not represented as new account-level tests for this release.

## Installed-app verification

Installed the signed release at `/Volumes/Aquatope/Applications/Scholarly Native.app`, retaining the previous bundle as a rollback copy and leaving the original Electron app intact. Bundle size: 31,011,299 bytes (29.6 MiB); this measures disk contents, not resident memory. Signature verification passed.

On the installed app, opened the reported Liu paper and verified the exact standalone dFC equation and inline symbols, Table 2 with all rows and notes but no following article prose, individually displayed figures, image zoom/fit/Escape, the Table 2 link opening PDF page 3, a 900px window, light/dark themes, and switching between the HTML note and the native review panel. The menu remained enabled after opening a note from search; focus now returns to the surviving root view. Restored the normal window size and dark theme. Screenshot evidence is local at `.scholarly-eval/html-reader/installed-table2.png`.
