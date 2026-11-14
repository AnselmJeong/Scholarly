# 0.10.4: readable notes and reliable source materials

Version **0.10.4, build 14** keeps the GPUI library shell and refines its offline HTML reading surface. The user selected a low-glare blue-gray night appearance as the reader default; the optional warm paper appearance does not change the library theme. The layout uses serif section headings, a restrained blue-gray page (or warm paper), quieter source locators, restrained rules and distinct equation surfaces. Original images retain their own colors. Figures stay beside their explanatory paragraph when space permits; tables use the full reading width. The thick side borders on quotations and source materials were removed, along with their obsolete detector exception. No new detector suppressions were added.

## Rendering and extraction

The reported Costa equation already had balanced `$$` delimiters. Its separate `=` line was being interpreted as a CommonMark heading. Display equations are now protected before Markdown parsing and sent intact to KaTeX. The renderer also recovers an omitted closing delimiter or a lone closing `$` at a recognizable prose boundary, without changing the TeX or rewriting the stored note. Code fences stay literal. This is bounded recovery, not a promise to reconstruct arbitrarily corrupt mathematics; invalid TeX still has an explicit source fallback.

Costa's original `Table 1 Predictions...` caption has no punctuation after its number; its dotted rules are text glyphs. Previously the extractor missed it and mistook a wrapped body reference to “Fig. 2:” for a caption. Caption detection now accepts this journal style and appendix labels, rejects wrapped prose references, and recognizes text-glyph table rules. Versioned visual caches are regenerated automatically. The recovered assets are Figure 1 (page 2), Table 1 (page 4), Figure 2 (page 5), Figure 3 (page 9), and Figure A4 (page 12). Source number and kind remain distinct; generated conceptual comparison tables remain selectable HTML.

## Settings and provenance

- Searchable model dropdowns use the connected provider's live catalog: Codex App Server `model/list`, Claude's initialization response, and Ollama `/v1/models`. No generation request is needed for discovery. Claude aliases such as `sonnet` resolve through the returned catalog, rather than a hardcoded model roster.
- Provider, reasoning, output language and reader appearance use native radio groups. Unsupported reasoning choices are disabled. Existing connection settings can be preserved when offline while updating the reading preferences.
- The reader shows the next job's provider, model and language. A running job snapshots its settings; generation reports the resolved model after connection. Saved notes show their recorded generator and language separately.
- The English prompt no longer simultaneously asks for Korean prose. Prompt metadata hashes the actual language-specific prompt.

## Verification

- `cargo +1.99.0 test --manifest-path native/Cargo.toml --locked`: **19 passed**. Includes the exact equation structure, incomplete delimiters, code preservation, escaped HTML, provider catalog contracts, alias normalization, note provenance, cancellation and existing note/figure behavior.
- Clippy with `-D warnings`: passed.
- `scripts/check-source-visuals.py`: **6 synthetic visual fixtures** passed, including dotted rules, unpunctuated captions, appendix labels and body references. Crops include the expected data and exclude neighboring prose.
- **8 real papers, 58 original figures/tables**: all extracted as cropped assets; all previous 53 assets retained. Costa's recovered Table 1 and Figure 2 were also visually inspected.
- The same system WebKit engine used by the app rendered **196 math expressions** across the eight real notes, at 780px/17px, 420px/17px and 780px/27px. Zero math errors, broken images or horizontal page overflow. The additional synthetic rendering note passed at all three sizes. Original note hashes were unchanged.
- Live catalog queries returned Codex **8**, Claude **4**, and Ollama **24** models at verification time. These counts are observations, not fixed application data. Listing a model does not assert available inference quota.
- Installed-app inspection confirmed both appearances, the saved Claude model and Korean radio state, the model dropdown, the distinct saved-note Codex provenance, Figure 2 beside its explanation, independently cropped Table 1, and the narrow split reader with a working source-page button. The final reading preference is night.
- A signed release bundle was installed in `/Volumes/Aquatope/Applications/Scholarly Native.app`; application and PDF-helper hashes matched the packaged files. Previous bundles are retained under `native/target/install-backups/`.

Local evidence (ignored, not published): `.scholarly-eval/reader-v104/` and `.scholarly-eval/html-reader/adjacent-figures/validation.json`. The developer command `--list-models <codex|claude|ollama>` checks catalog integration without generating a note. `--export-html <PDF> <HTML>` and `native/platform/reader-check.swift` reproduce the offline rendering checks.
