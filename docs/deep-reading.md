# PDF → Markdown deep reading

Scholarly uses an evidence-first reading workflow inspired by
[DeepPaperNote](https://github.com/917Dhj/DeepPaperNote), particularly its
[paper-type reading guidance](https://github.com/917Dhj/DeepPaperNote/blob/main/skills/deeppapernote/references/paper-types.md)
and [fresh quality review](https://github.com/917Dhj/DeepPaperNote/blob/main/skills/deeppapernote/references/final-quality-review.md).
This is an independent TypeScript implementation of those reading principles.
It does not install the upstream skills or require Obsidian, a vault, wikilinks,
or Python. The existing Scholarly/ScholarPen Markdown contract remains compatible.

## Reading workflow

1. Extract all PDF pages, preserving physical page numbers. Textless PDFs fail
   with an OCR/readable-source message. Figure pixels are not inspected.
2. For long papers, extract evidence from **every** page-bounded chunk, retaining
   numerical results, units, denominators, null findings, and limitations. Merge
   only when necessary; excessive or truncated evidence blocks publication.
3. Build a structured reading plan: contribution type, full-text assessment,
   storyline, original sections, core questions, claims, evidence, and boundaries.
   Plan locators must refer to readable source pages. Abstract-only sources stop.
4. Write the ordinary Markdown note in Korean or English using the existing seven
   sections: Snapshot, Prerequisite Knowledge, Purpose & Scope, Section-by-Section
   Digest, Key Findings & Details, Integrated Summary, and Coverage Map.
5. Validate structure and locators, then make a **fresh model request** to review
   the draft against the plan and source. Long-paper runs additionally audit every
   original source chunk, so review does not depend only on a compressed map.
   A separate request is an independent pass, not an independent model or a
   guarantee of factual accuracy.
6. Correct failed checks at most twice with the plan held fixed. An incomplete
   response, malformed verdict, unresolved error, or cancellation never replaces
   the previous note. Publish the validated note atomically.

Ten contribution profiles cover methods, systems, theory, positions,
benchmarks/datasets, empirical discovery, human-subject research, reviews,
qualitative studies, and humanities arguments; a chapter profile is also included.
Clinical questions explicitly cover sample, comparator, intervention, outcomes,
effect sizes/uncertainty, missing data, harms, and causal limits when applicable.
“Not reported” is kept distinct from “not performed.” No new critique, proposals,
or external facts are invented to fill the template.

Notes remain at `summary/<PDF basename>.md`. A sibling
`<PDF basename>.md.reading.json` records the plan, review scope, verdicts, final
body hash, source hash, and provider/model. Failed runs retain the existing note
and report the error. An audit-write failure after successful publication is
reported as a warning. The new prompt version and provider-qualified model
identity mark older notes stale without deleting them.

The pipeline uses text extraction, not visual analysis or OCR. Scanned pages,
figures, and complex table layouts may need a better text-layer PDF. A model's
full-text assessment is a check, not proof that extraction retained every detail.

## Providers

In **Settings → General → AI Provider**, choose:

| Provider | Connection | Models |
| --- | --- | --- |
| Ollama Cloud | API key; `https://ollama.com/v1/chat/completions` | Enter cloud model IDs for chat and notes. |
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
provenance consistent. Ordinary papers use at least three model requests; long
papers and revisions use more and count toward provider usage limits.

## Development verification

```sh
npm ci
npm test
npm run lint
npm run build
```

Tests cover page grounding, full-text gating, revisions, raw-chunk review,
publication safety, cancellation, Unicode stdin/output, and both CLI provider
adapters using local fake processes. They make no billable LLM requests. Real
account login, model availability, and representative-paper quality require a
connected end-to-end run.
