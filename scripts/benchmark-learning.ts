import fs from 'node:fs/promises';
import path from 'node:path';
import { extractDocumentCached } from '../electron/services/extraction-cache';
import { setProviderConnection, setGuideModel, requestChat, generateGuidance } from '../electron/services/ai';
import { classifyArticlePaperType, DIGEST_PROMPT_VERSION, PDF_EXTRACTION_VERSION, sha256, formatPageMarkedSource } from '../electron/services/digest';
import type { DigestSourceUnit } from '../electron/services/digest';
import { generationFingerprint, orderedPool, publishLearningNote } from '../electron/services/learning';

const root = process.argv[2];
if (!root) throw new Error('Usage: benchmark-learning.ts <PDF library> [output directory]');
const output = path.resolve(process.argv[3] || '.scholarly-eval/2026-11-13');
const model = process.env.SCHOLARLY_EVAL_MODEL || 'gpt-6.1-sol';
const cases = [
  ['theory', '2011 - Menon'], ['empirical-method', '2020 - Bruining'],
  ['empirical', '2025 - Lappin'], ['review', '2020 - Nair'],
  ['long-review', '2022 - Brinkman'], ['computational-model', '2025 - Rusch'],
] as const;
await fs.mkdir(output, { recursive: true });
const files = await fs.readdir(root);
setProviderConnection({ provider: 'codex', claudePath: '', codexPath: '' });
setGuideModel(model);
const oldCode = await fs.readFile('/tmp/scholarly-pre-learning-20261113/digest.ts', 'utf8');
const baselinePrompt = oldCode.match(/export const DIGEST_SYSTEM_PROMPT = `([\s\S]*?)`;/)?.[1].replace('{{OUTPUT_LANGUAGE}}', 'Korean');
await orderedPool([...cases], 2, async ([kind, prefix]) => {
  const name = files.find(name => name.startsWith(prefix) && name.endsWith('.pdf'));
  if (!name) throw new Error(`Missing evaluation paper ${prefix}`);
  const directory = path.join(output, kind);
  await fs.mkdir(directory, { recursive: true });
  const reportFile = path.join(directory, 'metrics.json');
  let report: Record<string, unknown> = { kind, filename: name, model };
  try { report = JSON.parse(await fs.readFile(reportFile, 'utf8')); } catch { /* First run. */ }
  const source = path.join(root, name);
  const hash = sha256(await fs.readFile(source));
  const extractionStarted = Date.now();
  const document = await extractDocumentCached(source, hash, path.join(output, 'cache'));
  const text = formatPageMarkedSource(document.pages);
  Object.assign(report, { sourceHash: hash, pageCount: document.pageCount, sourceCharacters: text.length,
    referencesOmitted: document.referencesOmitted, extractionMs: Date.now() - extractionStarted });
  await fs.writeFile(path.join(directory, 'source.txt'), text, { mode: 0o600 });
  const unit: DigestSourceUnit = {
    unitType: 'article', sourceRelpath: name, sourceSha256: hash, sourceSizeBytes: (await fs.stat(source)).size,
    sourcePageCount: document.pageCount, sourcePageStart: 1, sourcePageEnd: document.pageCount,
    title: name.replace(/\.pdf$/i, ''), authors: [], year: null, journal: null, doi: null,
    metadataSource: 'filename', outputLanguage: 'ko', paperType: classifyArticlePaperType(name, null, text),
    keywords: [], generatorAppVersion: '0.10.0', generatorModel: `codex:${model}`, promptVersion: DIGEST_PROMPT_VERSION,
    extractionVersion: PDF_EXTRACTION_VERSION,
  };
  if (!report.learning) {
    const started = Date.now(); let firstTextMs: number | null = null;
    try {
      const result = await generateGuidance({ document, sourceUnit: unit }, { mode: 'learning', reasoningEffort: 'low',
        cacheDirectory: path.join(output, 'cache'),
        onText: value => { if (firstTextMs === null && value.length >= 200) firstTextMs = Date.now() - started; },
        onProgress: (phase, detail) => console.log(JSON.stringify({ kind, phase, detail })),
      });
      publishLearningNote(path.join(directory, 'learning.md'), unit, document, result, generationFingerprint(unit, '', 'low'));
      report.learning = { durationMs: Date.now() - started, firstTextMs, eojeol: result.content.split(/\s+/).length,
        usage: result.usage, resolvedModel: result.resolvedModel, audit: result.learningAudit };
      delete report.learningError;
    } catch (error) { report.learningError = String(error); }
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ kind, learning: report.learning, error: report.learningError }));
  }
  // Control comparison for papers that fit the old direct-source branch. Long papers are reported separately.
  if (!report.baseline && !report.baselineSkipped && baselinePrompt) {
    if (text.length > 80_000) report.baselineSkipped = 'Exceeds old direct-source threshold; not a comparable direct-call control.';
    else {
      const started = Date.now(); let firstTextMs: number | null = null;
      try {
        const result = await requestChat([{ role: 'system', content: baselinePrompt }, { role: 'user', content: text }], model,
          { reasoningEffort: 'low', onText: value => { if (firstTextMs === null && value.length >= 200) firstTextMs = Date.now() - started; } });
        await fs.writeFile(path.join(directory, 'baseline.md'), result.content);
        report.baseline = { draftDurationMs: Date.now() - started, firstTextMs, eojeol: result.content.split(/\s+/).length, usage: result.usage,
          note: 'Draft only, same model and low effort. Excludes the previous mandatory review; not end-to-end old-app latency.' };
      } catch (error) { report.baselineError = String(error); }
    }
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
  }
});
console.log('Evaluation generation complete. Source/content review is still required.');
