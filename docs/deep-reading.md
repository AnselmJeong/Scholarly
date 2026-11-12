# PDF → Markdown deep reading

Scholarly uses an evidence-first reading workflow inspired by
[DeepPaperNote](https://github.com/917Dhj/DeepPaperNote), particularly its
[paper-type reading guidance](https://github.com/917Dhj/DeepPaperNote/blob/main/skills/deeppapernote/references/paper-types.md)
and [fresh quality review](https://github.com/917Dhj/DeepPaperNote/blob/main/skills/deeppapernote/references/final-quality-review.md).
This is an independent TypeScript implementation of those reading principles.
It does not install the upstream skills or require Obsidian, a vault, wikilinks,
or Python. The existing Scholarly/ScholarPen Markdown contract remains compatible.

## Concise reading workflow

The default digest targets **350–550 Korean eojeol or 600–900 English words**
for the whole note, excluding headings and locators. Short papers can use less;
complex papers can use slightly more when a central result needs qualification.
This is a writing target, not a token cap or a reason to truncate an answer.

1. Extract every PDF page with physical page numbers. Textless PDFs stop with an
   OCR/readable-source message. Figure pixels are not inspected.
2. For long sources, read **every** page-bounded chunk into concise evidence notes.
   Keep each section's main claim, essential design and evidence, uncertainty,
   and null findings or limitations that change the conclusion. Merge only when
   necessary; excessive or truncated evidence blocks publication.
3. Draft directly from the source/evidence, without a separate model-generated
   reading plan. Retain the seven compatible headings: Snapshot, Prerequisite
   Knowledge, Purpose & Scope, Section-by-Section Digest, Key Findings & Details,
   Integrated Summary, and Coverage Map. Background is only 2–4 necessary terms;
   the main body normally groups the argument into 3–5 short entries. Repeated
   summaries, five background subsections, and three labels per entry are removed.
   Entry-title formatting is not a validity rule: inline bold titles, subheadings,
   and connected paragraphs all reach factual review without a formatting retry.
4. Validate structure and locators locally, then make a **fresh model request**
   to check source completeness and factual accuracy. Abstract-only or materially
   unreadable sources cannot be published. Long sources additionally audit every
   original chunk. The reviewer checks central claims, attribution, exact selected
   statistics, uncertainty, and omissions that would change the conclusion.
   Secondary omissions and grouping are expected in a concise digest. Minor
   terminology/style/length issues are warnings, not reasons to restart generation.
   Reviews accept either text findings or structured objects with issue/message,
   passage, source page and correction. A malformed response gets one bounded
   review-format recovery against the same source and draft. Known blocking
   findings and insufficient-source assessments cannot be discarded during recovery.
5. Repair at most **once**, providing the exact previous draft and accumulated
   corrections. Preserve accurate passages and fix affected claims; the source
   overrides the draft. Review the repaired bytes again, including every raw chunk
   for a long source. Broken structure is repaired before spending a model review.
6. Publish atomically only after structural and factual checks pass. Truncation,
   review JSON still unreadable after recovery, unresolved factual errors, insufficient sources, or
   cancellation leave the previous note intact.

An ordinary successful run takes **two model requests**, down from three. With
one draft repair it normally takes four, down from seven with the previous two
repairs. Review-format recovery can add one request per review scope per draft;
long-source extraction/chunk reviews and transport retries also add requests.
This reduces round trips and requested output;
it is not a measured latency guarantee, since provider reasoning and load vary.
No arbitrary output-token cap is imposed.

Notes remain at `summary/<PDF basename>.md`. A sibling
`<PDF basename>.md.reading.json` records the `concise-digest-v2` workflow,
source assessment, review scope, blocking findings, advisory warnings, final body
hash, source hash, and provider/model. It no longer includes a reading plan.
Only warnings for the final body are surfaced after successful publication.
Failed runs retain the existing note and report the error. An audit-write failure
after publication is a warning. The `scholarly-concise-digest-v4` prompt version
marks older notes stale without deleting them; regeneration is not automatic.
The reading view receives only the Markdown body. YAML metadata remains in the
file for indexing, PDF links and hash validation, and is not shown to the reader.

Draft/review failures also save `readingDiagnostic` in the app's local
`digest-diagnostics.json`, including app/model/prompt identity, the failed stage,
request durations, finish reasons and token usage when returned, each draft's
structural checks, and factual verdicts. Model-response previews retain up to
20,000 characters per request with an explicit truncation flag. Prompts, raw PDF
text and credentials are not copied into these diagnostics. Logs use owner-only
file permissions. Existing older failures cannot recover discarded model output.

A fresh request uses the same selected model; it is not an independent model or
proof of factual accuracy. The pipeline uses text extraction, not visual analysis
or OCR. Scans, figures, and complex tables may need a better text-layer PDF.
The source-completeness assessment is a check, not proof of perfect extraction.

## Providers

In **Settings → General → AI Provider**, choose:

| Provider | Connection | Models |
| --- | --- | --- |
| Ollama Cloud | API key; `https://ollama.com/v1/chat/completions` | Choose chat and note models from the live cloud dropdowns. |
| Claude subscription | Installed Claude Code CLI, signed in using `claude auth login` with a Claude account | `sonnet`, `opus`, `haiku`, or an available model ID; empty uses the CLI default. |
| Codex / ChatGPT subscription | Installed Codex CLI, signed in using `codex login` with ChatGPT | Enter an available model ID or leave empty for the CLI default. |

The selected provider is used for both Q&A and note generation, with separate
model fields for each purpose. Model selections are remembered per provider.
**Check Connection** checks authentication without requesting a paid completion;
subscription availability and limits are ultimately checked during inference.
Credentials stay in their official CLI stores. Scholarly does not extract OAuth
tokens. API-key authentication is rejected in subscription mode and API-key
environment variables are removed from spawned processes to avoid accidental
metered billing. The Ollama key remains encrypted using Electron `safeStorage`.

CLI executables are discovered from standard macOS locations and `PATH`; an
absolute path can be configured when needed. Current CLI options are required:
Claude `--safe-mode`/`--tools`, Codex `--ignore-user-config`/`--ephemeral`.
Update the CLI if an unsupported-option error is reported. CLI work uses a
temporary directory, passes prompts through stdin, disables tools/customizations
where supported, and uses Codex's read-only sandbox. Temporary files are removed.
No shell command is assembled from PDF content. Cancellation terminates the
active CLI process group; requests also have timeouts and bounded output.

Settings can be saved offline; subscription selection does not require an Ollama
key. Settings changes are blocked during an active note job to keep provider/model
provenance consistent. Ordinary papers use two model requests; long
papers and repairs use more and count toward provider usage limits.
Cloud requests omit `max_tokens`: Scholarly sets no output token cap for chat,
evidence extraction, merging, drafts, or quality reviews. The model
can use its full server-supported allowance for reasoning and the final answer.
Ollama's own output/context limits still apply. If the server reports a truncated
response, the app identifies the reading stage, model, finish reason, and token
usage; it never saves a fragment or treats reasoning text as the final note.

## Development verification

```sh
npm ci
npm test
npm run lint
npm run build
```

Tests cover concise output, request counts, full-text gating, targeted repair, raw-chunk review,
publication safety, cancellation, Unicode stdin/output, and both CLI provider
adapters using local fake processes. They make no billable LLM requests. Real
account login, model availability, and representative-paper quality require a
connected end-to-end run.

### Verified regression (2026-11-12, 0.9.3)

The Breakspear (2017) paper previously failed because the validator required a
standalone `**Section —**` line. The concise prompt did not guarantee that layout,
and draft-stage failures were thrown before the outer attempt log was populated.
The corrected validator accepts seven tested entry styles through factual review
and atomic publication. It still rejects missing required content and invalid
page ranges; factual failures remain blocking.

A packaged-app run with the saved Ollama `deepseek-v4.1-flash` model generated
this 13-page paper successfully in 107.4 seconds, producing 424 Korean eojeol.
The published body, frontmatter hash and review hash matched; the PDF source hash
also matched, and the stale failure record was cleared. The generated output was
revalidated after correcting a separate `Figs. 4–5` parsing warning. The reviewer
retained two nonblocking wording-strength warnings. This is one verified paper,
not a guarantee of future model accuracy or latency.

### Structured review regression (0.9.4)

The Durstewitz (2020) failure log contained a complete, valid JSON review with a
structured finding (`passage`, `source_page`, `issue`, `correction`). The earlier
parser required strings and stopped before applying the correction. The exact
provider response is now a regression fixture. Tests replay it through repair
and review, exercise review-only format recovery and its safety boundaries, and
verify the reading projection preserves file metadata while hiding it in the UI.

The installed 0.9.4 app then regenerated the same Durstewitz PDF successfully
using the account's current `codex:default` setting. Its first draft passed the
fresh review with no findings or warnings, and the stale failure record cleared.
The result contains 497 whitespace-delimited words/eojeol after removing headings
and locators. Source, body, frontmatter and review hashes matched; revalidation
reported no errors or warnings. The actual app displayed the completed note from
Snapshot, without YAML metadata. The existing Breakspear note also projects to
body-only text without changing its stored bytes. This live run verifies the
current Codex setting; the original Ollama response is covered by fixture replay,
not a new live Ollama request.
