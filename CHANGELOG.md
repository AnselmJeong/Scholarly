# Changelog

## 0.9.0 — 2026-11-11

- Replace single-pass note drafting with contribution-specific reading plans,
  evidence mapping, fresh quality reviews, and bounded revisions.
- Audit long papers against every original page chunk; retain source locators,
  null results, numerical details, and claim boundaries in plain Markdown.
- Add Claude Code and Codex subscription providers alongside the Ollama Cloud
  OpenAI-compatible API, with provider-specific model settings and connection checks.
- Preserve existing notes on failed reviews, incomplete output, or cancellation.
- Record reading plans and review hashes in a companion audit file.
- Add a macOS build/install helper that validates the build and backs up the
  installed app before replacement.

Validation: 31 local automated tests pass. Changed services and settings UI pass
targeted TypeScript checks. Full packaging and live-provider inference have not
been verified in the restricted development session: npm registry DNS access is
unavailable and required build dependencies are missing. This source release does
not assert that a new installed application or DMG has been produced.
