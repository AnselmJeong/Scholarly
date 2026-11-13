# 0.10.3: figures beside their explanations

Version 0.10.3 (build 13) removes the small-crop restriction and the 800px forced stacking rule. At the ordinary 780px reading-pane width, a cropped source figure now sits beside the paragraph that explains it. The two columns wrap together according to available space and font size; prose comes before the figure in the narrow layout and in accessibility order. Source tables retain the full reading width.

## Association rules

- Parse actual Markdown paragraphs and heading hierarchy. Do not insert figures into headings, code, tables, quotations, lists, or the coverage inventory. Preserve the original Markdown ranges around insertions.
- Match exact Figure/Table numbers, including supplementary numbers, ranges, comma lists, English conjunctions and Korean conjunctions.
- Prefer the main explanation over the opening synopsis or repeated concluding summary. Within that priority, prefer a focused reference over a broad range, then reading order.
- Render each figure once. Several figures may accompany one explanation; continued source-table segments remain together.
- The generation prompt requires the verified figure number in its actual explanatory paragraph, rather than only in Snapshot or Coverage Map. Rendering adds no model call and does not rewrite saved notes.
- This is reference-based association, not new semantic image interpretation. The existing Liu summary contains figure numbers only in its coverage inventory, so its figures remain in the expandable source gallery. Its tables still appear with their referenced explanations. Missing or incorrect source references cannot be repaired reliably by layout alone.

## Verification

- All 13 Rust tests passed; Clippy passed with warnings denied. New regressions cover a full-width figure, multiple figures, a more specific explanation after an earlier overview/range, a heading immediately followed by prose, nested coverage headings, code/list/quote preservation, supplementary numbers and conjunctions.
- System WebKit tested the same seven real papers as the [HTML/source extraction evaluation](2026-11-14-html-reader.md): 26 explanation groups containing 30 figures, 53 total source images, and 165 math expressions. Every group was side by side at 780px/17px text, and prose followed by figures at both 420px/17px and 780px/27px. No math errors, broken images or document overflow. A separate fixture also passed with eight math expressions and one HTML comparison table.
- Each existing note's SHA-256 was unchanged after export. Cached exports took 0.12–0.70 seconds locally; this is export time, not generation time or a general performance guarantee.
- Installed and launched the signed release at `/Volumes/Aquatope/Applications/Scholarly Native.app`. In the installed app, opened the Bruining evaluation note, observed Figure 1 beside the structural E/I and alpha/LRTC result explanation, and confirmed the prose-first stacked layout after increasing text size. Restored the user's original 964-paper library, cleared the test search and restored text size.
- Bundle: 31,011,331 bytes (29.6 MiB). Both installed executable/helper hashes match the built bundle, and signature verification passed. Previous bundle retained for rollback.
- Design scan: no unsuppressed findings. The existing semantic quotation/source grouping border exceptions were retained; no new suppressions were added.

Local-only evidence (paper material is not committed): `.scholarly-eval/html-reader/adjacent-figures/validation.json`, `installed-side-by-side.png`, and `installed-stacked.png`.

## Reproduction

```sh
cargo +1.99.0 test --manifest-path native/Cargo.toml --locked
cargo +1.99.0 clippy --manifest-path native/Cargo.toml --all-targets --locked -- -D warnings
bash scripts/package-native.sh release
swiftc -O native/platform/reader-check.swift -o native/target/reader-check
"native/target/Scholarly Native.app/Contents/MacOS/Scholarly" --export-html /path/paper.pdf /path/note.html
native/target/reader-check /path/note.html 780 17
native/target/reader-check /path/note.html 420 17
native/target/reader-check /path/note.html 780 27
```

The WebKit report includes each explanation's source labels, column widths, side-by-side/stacked geometry and prose-first order. Rendering checks do not call an AI provider. The prompt addition was inspected; a fresh model generation was not run for this layout-only release.
