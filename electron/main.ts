import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { initDB, getDb } from './db/index'
import { FileWatcher } from './services/watcher'
import { checkOllamaStatus, listModels, setModel, chatWithPaper, setChatModel, setGuideModel, setOllamaApiKey, generateGuidance } from './services/ai'
import type { ChatCompletionUsage, DigestGenerationPhase } from './services/ai'
import { loadSettings, saveSettings, getDefaultGuidePrompt } from './store'
import type { AppSettings, SettingsUpdate } from './store'
import { articles, keywords, articleKeywords } from './db/schema'
import { generateBibtexForArticles } from './services/bibtex'
import { fetchPaperMetadata } from './services/openalex'
import { eq, and, sql, asc, desc } from 'drizzle-orm'
import fs from 'node:fs'
import crypto from 'node:crypto'
import archiver from 'archiver'
import { extractDocument, extractText } from './services/pdf'
import {
  PDF_EXTRACTION_VERSION,
  DIGEST_PROMPT_VERSION,
  buildDigestFrontmatter,
  calculateContractFingerprint,
  classifyArticlePaperType,
  inspectDigestStatus,
  getDigestOutputPath,
  normalizeGeneratedDigestBody,
  parseDigestDocument,
  publishDigestAtomically,
  serializeDigest,
  shouldStopDigestBatch,
  validateDigestBody
} from './services/digest'
import type { DigestSourceUnit, DigestStatus, ExtractedDocument, MetadataSource } from './services/digest'

// Disable Hardware Acceleration to prevent GPU process crashes and startup delay
app.disableHardwareAcceleration();

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Map to track recently deleted files for move detection (hash -> {path, timestamp})
const recentlyDeletedFiles = new Map<string, { path: string; articleId: number; timestamp: number }>()
const MOVE_DETECTION_TIMEOUT = 3000 // 3 seconds window to detect file moves

// In-memory cache for PDF text content (filePath -> text)
// We no longer store full text in DB to save space
const pdfContextCache = new Map<string, string>();
const PDF_CACHE_SIZE_LIMIT = 20; // Keep last 20 papers in memory

function getSummaryPathForPdf(filePath: string): string {
  return getDigestOutputPath(filePath, { unitType: 'article' });
}

function findPdfFilesRecursively(rootPath: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(rootPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(rootPath, entry.name);
      if (entry.isDirectory() && entry.name !== 'summary') {
        results.push(...findPdfFilesRecursively(fullPath));
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
        results.push(fullPath);
      }
    }
  } catch (error) {
    console.error('Error scanning directory:', rootPath, error);
  }
  return results.sort((left, right) => left.localeCompare(right));
}

function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relativePath === '' || (
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
}

function loadGuidancePrompt(): string {
  const settings = loadSettings();
  if (settings.ai.guidePrompt && settings.ai.guidePrompt.trim().length > 0) {
    return settings.ai.guidePrompt;
  }
  return getDefaultGuidePrompt();
}

type DigestGenerationOutcome = 'created' | 'updated' | 'skipped_current';

interface DigestGenerationResult {
  success: boolean;
  summaryPath?: string;
  outcome?: DigestGenerationOutcome;
  status?: DigestStatus;
  error?: string;
  warnings?: string[];
  cancelled?: boolean;
}

interface DigestAttemptDiagnostic {
  generationAttempt: number;
  error: string | null;
  warnings: string[];
  finishReason: string | null;
  usage: ChatCompletionUsage | null;
  requestAttempts: number | null;
  responseCharacters: number;
  outputPreview: string;
}

interface DigestFailureDiagnostic {
  filePath: string;
  error: string;
  failedAt: string;
  expectedFingerprint: string;
  attempts?: DigestAttemptDiagnostic[];
}

const sourceShaCache = new Map<string, { size: number; mtimeMs: number; sha256: string }>();
let digestDiagnosticsLoaded = false;
const digestFailureDiagnostics = new Map<string, DigestFailureDiagnostic>();

function digestDiagnosticsPath(): string {
  return path.join(app.getPath('userData'), 'digest-diagnostics.json');
}

function loadDigestDiagnostics(): void {
  if (digestDiagnosticsLoaded) return;
  digestDiagnosticsLoaded = true;
  try {
    const diagnosticsPath = digestDiagnosticsPath();
    if (!fs.existsSync(diagnosticsPath)) return;
    const parsed: unknown = JSON.parse(fs.readFileSync(diagnosticsPath, 'utf8'));
    if (!Array.isArray(parsed)) return;
    for (const item of parsed) {
      if (
        typeof item === 'object' && item !== null &&
        typeof (item as DigestFailureDiagnostic).filePath === 'string' &&
        typeof (item as DigestFailureDiagnostic).error === 'string' &&
        typeof (item as DigestFailureDiagnostic).failedAt === 'string' &&
        typeof (item as DigestFailureDiagnostic).expectedFingerprint === 'string'
      ) {
        const diagnostic = item as DigestFailureDiagnostic;
        digestFailureDiagnostics.set(diagnostic.filePath, diagnostic);
      }
    }
  } catch (error) {
    console.error('Failed to load digest diagnostics:', error);
  }
}

function saveDigestDiagnostics(): void {
  const diagnosticsPath = digestDiagnosticsPath();
  const temporaryPath = `${diagnosticsPath}.${crypto.randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(diagnosticsPath), { recursive: true });
  fs.writeFileSync(temporaryPath, JSON.stringify(Array.from(digestFailureDiagnostics.values()), null, 2), 'utf8');
  fs.renameSync(temporaryPath, diagnosticsPath);
}

function recordDigestFailure(
  filePath: string,
  error: string,
  expectedFingerprint: string,
  attempts: DigestAttemptDiagnostic[] = []
): void {
  try {
    loadDigestDiagnostics();
    digestFailureDiagnostics.set(filePath, {
      filePath,
      error,
      failedAt: new Date().toISOString(),
      expectedFingerprint,
      attempts
    });
    saveDigestDiagnostics();
  } catch (diagnosticError) {
    console.error('Failed to persist digest failure diagnostics:', diagnosticError);
  }
}

function clearDigestFailure(filePath: string): void {
  try {
    loadDigestDiagnostics();
    if (digestFailureDiagnostics.delete(filePath)) saveDigestDiagnostics();
  } catch (diagnosticError) {
    console.error('Failed to clear digest failure diagnostics:', diagnosticError);
  }
}

async function calculateSha256(filePath: string): Promise<string> {
  const stat = await fs.promises.stat(filePath);
  const cached = sourceShaCache.get(filePath);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.sha256;
  const sha256 = await new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
  sourceShaCache.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, sha256 });
  return sha256;
}

function normalizeMetadataSource(value: string | null | undefined, doi?: string | null): MetadataSource {
  if (value === 'openalex' || value === 'crossref' || value === 'manual') return value;
  // Existing Scholarly databases predate metadata_source; DOI-bearing records
  // in this app were populated through OpenAlex.
  return doi ? 'openalex' : 'filename';
}

function parseAuthors(authors: string | null | undefined): string[] {
  return authors?.split(';').map(author => author.trim()).filter(Boolean) ?? [];
}

async function buildArticleSourceUnit(
  filePath: string,
  sourceSha256: string,
  extracted: ExtractedDocument
): Promise<DigestSourceUnit> {
  if (!currentRootPath) throw new Error('Select a Scholarly library root first.');
  const [article] = await getDb().select().from(articles).where(eq(articles.filePath, filePath));
  const keywordRows = article
    ? await getDb()
      .select({ keyword: keywords.keyword })
      .from(articleKeywords)
      .innerJoin(keywords, eq(articleKeywords.keywordId, keywords.id))
      .where(eq(articleKeywords.articleId, article.id))
    : [];
  const settings = loadSettings();
  const stat = await fs.promises.stat(filePath);
  const fallback = parseFilename(path.basename(filePath));
  const sourceRelpath = path.relative(currentRootPath, filePath).split(path.sep).join('/');
  if (!sourceRelpath || sourceRelpath.startsWith('../') || path.isAbsolute(sourceRelpath)) {
    throw new Error('The PDF source path cannot be represented relative to the selected library root.');
  }
  const title = article?.title?.trim() || fallback.title;
  return {
    unitType: 'article',
    sourceRelpath,
    sourceSha256,
    sourceSizeBytes: stat.size,
    sourcePageCount: extracted.pageCount,
    sourcePageStart: 1,
    sourcePageEnd: extracted.pageCount,
    title,
    authors: parseAuthors(article?.authors ?? fallback.authors),
    year: article?.year ?? fallback.year,
    journal: article?.journal ?? null,
    doi: article?.doi?.trim() || null,
    metadataSource: normalizeMetadataSource(article?.metadataSource, article?.doi),
    outputLanguage: settings.ai.outputLanguage,
    paperType: classifyArticlePaperType(
      title,
      article?.abstract ?? null,
      extracted.pages.map(page => page.text).join('\n')
    ),
    keywords: keywordRows.map(row => row.keyword),
    generatorAppVersion: app.getVersion(),
    generatorModel: settings.ai.guideModel,
    promptVersion: DIGEST_PROMPT_VERSION,
    extractionVersion: PDF_EXTRACTION_VERSION
  };
}

async function getDigestStatusForPdf(filePath: string, settings = loadSettings()): Promise<DigestStatus> {
  const summaryPath = getSummaryPathForPdf(filePath);
  loadDigestDiagnostics();
  if (!fs.existsSync(filePath)) return 'missing';
  if (!fs.existsSync(summaryPath)) return digestFailureDiagnostics.has(filePath) ? 'failed' : 'missing';
  const content = fs.readFileSync(summaryPath, 'utf8');
  try {
    const { frontmatter } = parseDigestDocument(content);
    const sourceSha256 = await calculateSha256(filePath);
    const sourcePageStart = Number(frontmatter.source_page_start);
    const sourcePageEnd = Number(frontmatter.source_page_end);
    if (!Number.isInteger(sourcePageStart) || !Number.isInteger(sourcePageEnd)) return 'failed';
    const expectedFingerprint = calculateContractFingerprint({
      sourceSha256,
      unitType: 'article',
      sourcePageStart,
      sourcePageEnd,
      outputLanguage: settings.ai.outputLanguage,
      generatorModel: settings.ai.guideModel,
      promptVersion: DIGEST_PROMPT_VERSION,
      extractionVersion: PDF_EXTRACTION_VERSION
    });
    const diagnostic = digestFailureDiagnostics.get(filePath);
    if (diagnostic) return 'failed';
    return inspectDigestStatus(content, expectedFingerprint);
  } catch {
    return 'failed';
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

interface DigestRunOptions {
  signal?: AbortSignal;
  onProgress?: (phase: DigestGenerationPhase | 'extracting' | 'validating' | 'repairing' | 'publishing', detail: string) => void;
}

const MAX_GENERATION_ATTEMPTS = 2;

async function ensureGuidanceForPdf(
  filePath: string,
  force: boolean = false,
  options: DigestRunOptions = {}
): Promise<DigestGenerationResult> {
  let expectedFingerprint = '';
  const attempts: DigestAttemptDiagnostic[] = [];
  try {
    if (options.signal?.aborted) {
      return { success: false, cancelled: true, error: 'Digest generation cancelled.' };
    }
    const summaryPath = getSummaryPathForPdf(filePath);
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `PDF not found: ${filePath}` };
    }
    const sourceSha256 = await calculateSha256(filePath);
    options.onProgress?.('extracting', 'Extracting page-marked PDF text');
    const extracted = await extractDocument(filePath);
    const sourceUnit = await buildArticleSourceUnit(filePath, sourceSha256, extracted);
    expectedFingerprint = calculateContractFingerprint(sourceUnit);
    const existingContent = fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath, 'utf8') : null;
    const existingStatus = inspectDigestStatus(existingContent, expectedFingerprint);
    const existingIsPublishedDigest = (() => {
      if (!existingContent) return false;
      try {
        const parsed = parseDigestDocument(existingContent);
        return parsed.frontmatter.validation_status === 'passed';
      } catch {
        return false;
      }
    })();

    if (!force && existingStatus === 'current') {
      clearDigestFailure(filePath);
      return { success: true, summaryPath, outcome: 'skipped_current', status: 'current' };
    }

    let validationFeedback: string[] | undefined;
    for (let generationAttempt = 1; generationAttempt <= MAX_GENERATION_ATTEMPTS; generationAttempt += 1) {
      if (generationAttempt > 1) {
        options.onProgress?.('repairing', `Regenerating after contract check (${generationAttempt}/${MAX_GENERATION_ATTEMPTS})`);
      }
      const completion = await generateGuidance({
        document: extracted,
        sourceUnit,
        additionalGuidance: loadGuidancePrompt(),
        validationFeedback
      }, {
        signal: options.signal,
        onProgress: options.onProgress
      });
      const body = normalizeGeneratedDigestBody(completion.content);
      options.onProgress?.('validating', `Checking digest contract (${generationAttempt}/${MAX_GENERATION_ATTEMPTS})`);
      const bodyValidation = validateDigestBody(body, sourceUnit, extracted);
      attempts.push({
        generationAttempt,
        error: bodyValidation.valid ? null : bodyValidation.errors.join(' | '),
        warnings: bodyValidation.warnings,
        finishReason: completion.finishReason,
        usage: completion.usage,
        requestAttempts: completion.requestAttempts,
        responseCharacters: body.length,
        outputPreview: body.slice(0, 4_000)
      });
      if (!bodyValidation.valid) {
        validationFeedback = bodyValidation.errors;
        if (generationAttempt < MAX_GENERATION_ATTEMPTS) continue;
        throw new Error(`Generated digest body failed validation after ${MAX_GENERATION_ATTEMPTS} attempts: ${bodyValidation.errors.join(' | ')}`);
      }

      const frontmatter = buildDigestFrontmatter(sourceUnit, body);
      const completeDigest = serializeDigest(frontmatter, body);
      options.onProgress?.('publishing', 'Publishing validated digest');
      publishDigestAtomically(summaryPath, completeDigest, sourceUnit, extracted);
      clearDigestFailure(filePath);
      if (bodyValidation.warnings.length > 0) {
        console.warn(`Digest published with ${bodyValidation.warnings.length} quality warning(s) for ${filePath}: ${bodyValidation.warnings.join(' | ')}`);
      }

      return {
        success: true,
        summaryPath,
        outcome: existingIsPublishedDigest ? 'updated' : 'created',
        status: 'current',
        warnings: bodyValidation.warnings
      };
    }
    throw new Error('Digest generation did not produce a result.');
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) {
      return { success: false, cancelled: true, error: 'Digest generation cancelled.' };
    }
    const message = error instanceof Error ? error.message : String(error);
    recordDigestFailure(filePath, message, expectedFingerprint, attempts);
    return { success: false, status: 'failed', error: message };
  }
}

// Calculate file hash for move detection
function calculateFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (data) => hash.update(data))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

// Filename parser helper
const parseFilename = (filename: string) => {
  // Expected format: YYYY - Author - Title.pdf
  // Use \s+ to require spaces around hyphens, avoiding split on hyphenated names (e.g. Moreno-Ortega)
  const match = filename.match(/^(\d{4})\s+-\s+(.+?)\s+-\s+(.+?)(?:\.pdf)?$/i);
  if (match) {
      return {
          year: parseInt(match[1]),
          authors: match[2].trim(),
          title: match[3].trim().replace(/\.pdf$/i, '')
      };
  }
  return {
      year: null,
      authors: null,
      title: filename.replace(/\.pdf$/i, '')
  };
};

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
let watcher: FileWatcher | null = null
let currentRootPath: string | null = null

type GuidanceBatchStatus = 'running' | 'cancelling' | 'completed' | 'cancelled' | 'stopped';
type GuidanceBatchPhase = DigestGenerationPhase | 'queued' | 'extracting' | 'validating' | 'repairing' | 'publishing' | 'cancelling' | 'idle';

interface GuidanceBatchState {
  jobId: string;
  scopePath: string;
  status: GuidanceBatchStatus;
  total: number;
  current: number;
  created: number;
  updated: number;
  skippedCurrent: number;
  failed: number;
  remaining: number;
  errors: Array<{ filePath: string; error: string }>;
  currentFilePath: string | null;
  phase: GuidanceBatchPhase;
  detail: string;
  stopReason: string | null;
}

let guidanceBatchState: GuidanceBatchState | null = null;
let guidanceBatchAbortController: AbortController | null = null;

const BATCH_PACING_MS = 1_000;

function emitGuidanceBatchProgress(): void {
  if (guidanceBatchState) {
    win?.webContents.send('guidance-batch-progress', guidanceBatchState);
  }
}

function updateGuidanceBatchProgress(
  jobId: string,
  patch: Partial<Pick<GuidanceBatchState, 'phase' | 'detail'>>
): void {
  if (!guidanceBatchState || guidanceBatchState.jobId !== jobId) return;
  guidanceBatchState = { ...guidanceBatchState, ...patch };
  emitGuidanceBatchProgress();
}

function waitBetweenBatchItems(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(Object.assign(new Error('Digest generation cancelled.'), { name: 'AbortError' }));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Digest generation cancelled.'), { name: 'AbortError' }));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, BATCH_PACING_MS);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function runGuidanceBatch(
  jobId: string,
  scopePath: string,
  filePaths: string[],
  signal: AbortSignal
): Promise<void> {
  let created = 0;
  let updated = 0;
  let skippedCurrent = 0;
  let failed = 0;
  let consecutiveFailures = 0;
  const errors: Array<{ filePath: string; error: string }> = [];

  for (let index = 0; index < filePaths.length; index += 1) {
    const filePath = filePaths[index];
    guidanceBatchState = {
      status: 'running',
      jobId,
      scopePath,
      total: filePaths.length,
      current: index,
      created,
      updated,
      skippedCurrent,
      failed,
      remaining: filePaths.length - created - updated - skippedCurrent,
      errors,
      currentFilePath: filePath,
      phase: 'queued',
      detail: `Preparing ${path.basename(filePath)}`,
      stopReason: null
    };
    emitGuidanceBatchProgress();

    const result = await ensureGuidanceForPdf(filePath, false, {
      signal,
      onProgress: (phase, detail) => updateGuidanceBatchProgress(jobId, { phase, detail })
    });
    if (result.cancelled || signal.aborted) {
      guidanceBatchState = {
        ...guidanceBatchState,
        status: 'cancelled',
        current: index,
        created,
        updated,
        skippedCurrent,
        failed,
        remaining: filePaths.length - created - updated - skippedCurrent,
        currentFilePath: null,
        phase: 'idle',
        detail: 'Digest batch cancelled',
        stopReason: 'Cancelled by user.'
      };
      emitGuidanceBatchProgress();
      guidanceBatchAbortController = null;
      return;
    }
    if (!result.success) {
      failed += 1;
      consecutiveFailures += 1;
      const error = result.error || 'Unknown digest generation failure.';
      errors.push({ filePath, error });
      console.error(`Digest generation failed for ${filePath}: ${error}`);
    } else if (result.outcome === 'skipped_current') {
      skippedCurrent += 1;
      consecutiveFailures = 0;
    } else if (result.outcome === 'updated') {
      updated += 1;
      consecutiveFailures = 0;
      win?.webContents.send('data-updated');
    } else if (result.outcome === 'created') {
      created += 1;
      consecutiveFailures = 0;
      win?.webContents.send('data-updated');
    }

    if (shouldStopDigestBatch(consecutiveFailures, index + 1 < filePaths.length)) {
      guidanceBatchState = {
        ...guidanceBatchState,
        status: 'stopped',
        current: index + 1,
        created,
        updated,
        skippedCurrent,
        failed,
        remaining: filePaths.length - created - updated - skippedCurrent,
        currentFilePath: null,
        phase: 'idle',
        detail: 'Stopped after 3 consecutive failures',
        stopReason: 'Stopped automatically after 3 consecutive failures to avoid wasting time and API usage.'
      };
      emitGuidanceBatchProgress();
      guidanceBatchAbortController = null;
      return;
    }

    if (index + 1 < filePaths.length) {
      updateGuidanceBatchProgress(jobId, { phase: 'queued', detail: 'Waiting briefly before the next PDF' });
      try {
        await waitBetweenBatchItems(signal);
      } catch (error) {
        if (!isAbortError(error)) throw error;
      }
    }
  }

  guidanceBatchState = {
    status: 'completed',
    jobId,
    scopePath,
    total: filePaths.length,
    current: filePaths.length,
    created,
    updated,
    skippedCurrent,
    failed,
    remaining: failed,
    errors,
    currentFilePath: null,
    phase: 'idle',
    detail: 'Digest batch complete',
    stopReason: null
  };
  emitGuidanceBatchProgress();
  win?.webContents.send('data-updated');
  guidanceBatchAbortController = null;
}

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
    width: 1400,
    height: 900,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#020617' // Matches slate-950
  })

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// Process a single file: fetch metadata from OpenAlex, save keywords to DB
async function processFile(filePath: string, force: boolean = false): Promise<void> {
  const filename = path.basename(filePath);
  console.log(`\n📄 Processing: ${filename} (Force: ${force})`);
  
  try {
    // Get article from DB first
    const [article] = await getDb().select().from(articles).where(eq(articles.filePath, filePath));
    if (!article) {
      console.log(`   Article not in DB yet, skipping`);
      return;
    }
    
    // Check if we need to update metadata
    // We update if: force=true OR no/default title OR missing explicit metadata fields like DOI/Authors
    const hasRichMetadata = !!article.doi && !!article.authors && !!article.year;
    const isDefaultTitle = !article.title || article.title === filename || article.title.includes('.pdf');
    
    const needsMetadataUpdate = force || isDefaultTitle || !hasRichMetadata;

    // Improve search accuracy by using parsed title if available
    const parsed = parseFilename(filename);
    const searchTitle = article.title && !isDefaultTitle
      ? article.title 
      : (parsed.title && parsed.title !== filename.replace(/\.pdf$/i, '') ? parsed.title : filename.replace(/\.pdf$/i, ''));
    
    console.log(`\n   [ProcessFile] Metadata Check:`);
    console.log(`   - File: ${filename}`);
    console.log(`   - Search Title: "${searchTitle}"`);
    console.log(`   - Needs Update: ${needsMetadataUpdate} (Force: ${force})`);

    if (needsMetadataUpdate) {
      try {
        console.log(`   🔍 Searching OpenAlex for metadata: ${searchTitle}`);
        // Pass existing DOI if available to help OpenAlex lookup
        const metadata = await fetchPaperMetadata(searchTitle, article.doi || undefined);
  
        if (metadata) {
          console.log(`   ✅ Found OpenAlex data: ${metadata.title}`);
          
          // Prepare updates
          const updates: any = {};
          
          if (metadata.title) updates.title = metadata.title;
          if (metadata.authors) updates.authors = metadata.authors;
          if (metadata.year) updates.year = metadata.year;
          if (metadata.journal) updates.journal = metadata.journal;
          if (metadata.doi) updates.doi = metadata.doi;
          if (metadata.abstract) updates.abstract = metadata.abstract;
          updates.metadataSource = 'openalex';

          console.log(`   [ProcessFile] Prepared updates:`, JSON.stringify(updates));
  
          // Update DB if we have data
          if (Object.keys(updates).length > 0) {
            await getDb().update(articles)
              .set(updates)
              .where(eq(articles.id, article.id));
            
            console.log(`   [ProcessFile] DB Metadata Updated`);
            win?.webContents.send('data-updated');
            
            // Update local object for subsequent steps
            Object.assign(article, updates);
          }

          // Process Keywords (NEW: directly from OpenAlex)
          if (metadata.keywords && metadata.keywords.length > 0) {
             console.log(`   🔑 Processing ${metadata.keywords.length} keywords from OpenAlex...`);
             
             for (const kw of metadata.keywords) {
                // Check if keyword exists in SQLite (case-insensitive)
                // Note: we don't have embeddings anymore, just text matching
                const [existingKw] = await getDb().select().from(keywords).where(eq(keywords.keyword, kw));
                
                let keywordId: number;
                
                if (!existingKw) {
                  // Insert new keyword
                  await getDb().insert(keywords).values({
                    keyword: kw,
                    createdDate: new Date(),
                    usageCount: 1
                  }).onConflictDoNothing();
                  
                  // Fetch back to get ID (SQLite doesn't always support RETURNING perfectly in all drivers/wrappers)
                  const [newKw] = await getDb().select().from(keywords).where(eq(keywords.keyword, kw));
                  keywordId = newKw.id;
                } else {
                  keywordId = existingKw.id;
                }
                
                // Link keyword to article
                await getDb().insert(articleKeywords).values({
                  articleId: article.id,
                  keywordId: keywordId,
                  addedDate: new Date()
                }).onConflictDoNothing();
                
                // Update usage count
                const [kwRow] = await getDb().select().from(keywords).where(eq(keywords.id, keywordId));
                if (kwRow) {
                     await getDb().update(keywords)
                       .set({ usageCount: (kwRow.usageCount || 0) + 1 })
                       .where(eq(keywords.id, keywordId));
                }
             }
             
             console.log(`   ✅ Saved keywords for ${filename}`);
             win?.webContents.send('data-updated');
           }
        } else {
             console.log(`   ⚠️ No metadata found in OpenAlex for: "${searchTitle}"`);
        }
      } catch (err) {
        console.error('Error fetching metadata (ProcessFile):', err);
      }
    }

    // PDF Text Extraction is now done ON-DEMAND during chat (prepare-context)
    // We no longer save to DB to save space.
    
  } catch (error) {
    console.error(`   ❌ Error processing ${filename}:`, error);
  }
}

app.whenReady().then(async () => {
  try {
    console.log("Starting DB initialization...");
    const start = Date.now();
    initDB();
    console.log(`Database initialized in ${Date.now() - start}ms`);

    // Cleanup legacy PDF context from DB to save space
    getDb().update(articles).set({ pdfContext: null }).run();
    try {
      getDb().run(sql`VACUUM`); 
      console.log('🧹 Cleared legacy PDF context and VACUUMed DB');
    } catch (e) {
      console.error('Vacuum failed:', e);
    }
    
    // Load and apply settings
    const settings = loadSettings();
    console.log(`Loaded settings (Ollama API key configured: ${Boolean(settings.ai.ollamaApiKey)})`);

    if (settings.ai.chatModel) setChatModel(settings.ai.chatModel);
    if (settings.ai.guideModel) setGuideModel(settings.ai.guideModel);
    setOllamaApiKey(settings.ai.ollamaApiKey);

  } catch (e) {
    console.error("Failed to init DB:", e);
    dialog.showErrorBox('Database Initialization Error', `Failed to initialize database: ${String(e)}`);
  }

  // Create Window after DB is ready
  createWindow();

  win?.webContents.on('did-finish-load', () => {
     win?.webContents.send('db-ready');
  });

  // Check Ollama Cloud status in background
  checkOllamaStatus().then(async (ollamaRunning) => {
    if (ollamaRunning) {
      console.log("✅ Ollama Cloud is connected");
      const models = await listModels();
      console.log("   Available models:", models);
    } else {
      console.warn("⚠️ Ollama Cloud is not connected. Configure a valid API key in Settings.");
    }
  });

  // IPC Handlers

  // IPC Handlers
  ipcMain.handle('get-articles', async () => {
    // Return empty array if no root path is set
    if (!currentRootPath) {
      return [];
    }
    
    const allArticles = await getDb().select().from(articles).orderBy(articles.addedDate);
    // Filter by current root path
    const filtered = allArticles.filter(a => isPathWithinRoot(a.filePath, currentRootPath!));
    // Contract status is based on provenance and generation settings, not file
    // existence alone. SHA-256 values are cached by size/mtime.
    const settings = loadSettings();
    const withGuidance = await Promise.all(filtered.map(async a => {
      const summaryPath = getSummaryPathForPdf(a.filePath);
      const guidanceStatus = await getDigestStatusForPdf(a.filePath, settings);
      return {
        ...a,
        hasGuidance: fs.existsSync(summaryPath),
        guidanceStatus
      };
    }));
    
    return withGuidance;
  });

  ipcMain.handle('read-guidance', async (_event, filePath: string) => {
    try {
      if (!currentRootPath || !isPathWithinRoot(filePath, currentRootPath)) {
        return { success: false, status: 'missing', error: 'The PDF is outside the selected root folder.' };
      }
      const summaryPath = getSummaryPathForPdf(filePath);
      const status = await getDigestStatusForPdf(filePath);
      if (fs.existsSync(summaryPath)) {
          const content = fs.readFileSync(summaryPath, 'utf8');
          return { success: true, content, status };
      }
      const diagnostic = digestFailureDiagnostics.get(filePath);
      return { success: false, status, error: diagnostic?.error || 'Digest file not found' };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle('generate-guidance', async (_event, arg: { filePath: string; force?: boolean }) => {
    try {
      if (guidanceBatchState?.status === 'running' || guidanceBatchState?.status === 'cancelling') {
        return { success: false, error: 'A digest batch is already running.' };
      }
      if (!currentRootPath || !isPathWithinRoot(arg.filePath, currentRootPath)) {
        return { success: false, error: 'The PDF is outside the selected root folder.' };
      }
      const result = await ensureGuidanceForPdf(arg.filePath, arg.force ?? false);
      if (result.success) {
        win?.webContents.send('data-updated');
      }
      return result;
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('start-guidance-batch', async (_event, arg: { folderPath?: string }) => {
    if (guidanceBatchState?.status === 'running' || guidanceBatchState?.status === 'cancelling') {
      return { success: false, error: 'A digest batch is already running.', job: guidanceBatchState };
    }
    if (!currentRootPath) {
      return { success: false, error: 'Select a root folder first.' };
    }

    const scopePath = path.resolve(arg.folderPath || currentRootPath);
    if (!isPathWithinRoot(scopePath, currentRootPath) || !fs.existsSync(scopePath)) {
      return { success: false, error: 'The batch folder is outside the selected root folder.' };
    }

    const filePaths = findPdfFilesRecursively(scopePath);
    if (filePaths.length === 0) {
      return { success: false, error: 'No PDF files were found in the selected folder.' };
    }

    const jobId = crypto.randomUUID();
    guidanceBatchAbortController = new AbortController();
    guidanceBatchState = {
      status: 'running',
      jobId,
      scopePath,
      total: filePaths.length,
      current: 0,
      created: 0,
      updated: 0,
      skippedCurrent: 0,
      failed: 0,
      remaining: filePaths.length,
      errors: [],
      currentFilePath: filePaths[0],
      phase: 'queued',
      detail: `Preparing ${path.basename(filePaths[0])}`,
      stopReason: null
    };
    emitGuidanceBatchProgress();
    void runGuidanceBatch(jobId, scopePath, filePaths, guidanceBatchAbortController.signal).catch(error => {
      console.error('Unexpected digest batch failure:', error);
      if (guidanceBatchState?.jobId === jobId) {
        guidanceBatchState = {
          ...guidanceBatchState,
          status: 'stopped',
          currentFilePath: null,
          phase: 'idle',
          detail: 'Digest batch stopped unexpectedly',
          stopReason: error instanceof Error ? error.message : String(error)
        };
        emitGuidanceBatchProgress();
      }
      guidanceBatchAbortController = null;
    });
    return { success: true, job: guidanceBatchState };
  });

  ipcMain.handle('cancel-guidance-batch', async () => {
    if (!guidanceBatchState || (guidanceBatchState.status !== 'running' && guidanceBatchState.status !== 'cancelling')) {
      return { success: false, error: 'No digest batch is running.', job: guidanceBatchState };
    }
    if (guidanceBatchState.status === 'running') {
      guidanceBatchState = {
        ...guidanceBatchState,
        status: 'cancelling',
        phase: 'cancelling',
        detail: 'Cancelling the active PDF request…'
      };
      emitGuidanceBatchProgress();
      guidanceBatchAbortController?.abort();
    }
    return { success: true, job: guidanceBatchState };
  });

  ipcMain.handle('get-guidance-batch-status', async () => {
    return guidanceBatchState;
  });

  ipcMain.handle('get-keywords', async () => {
    return await getDb().select().from(keywords);
  });

  ipcMain.handle('get-article-keywords', async (_event, articleId: number) => {
    const result = await getDb()
      .select({ keyword: keywords.keyword })
      .from(articleKeywords)
      .innerJoin(keywords, eq(articleKeywords.keywordId, keywords.id))
      .where(eq(articleKeywords.articleId, articleId));
    return result.map(r => r.keyword);
  });

  ipcMain.handle('get-all-links', async () => {
    return await getDb().select().from(articleKeywords);
  });

  ipcMain.handle('add-keyword-to-article', async (_event, { articleId, keyword }) => {
    try {
      await getDb().insert(keywords).values({
        keyword: keyword,
        createdDate: new Date(),
        usageCount: 0
      }).onConflictDoNothing();

      const [kw] = await getDb().select().from(keywords).where(eq(keywords.keyword, keyword));
      if (!kw) throw new Error("Keyword not found after insertion");

      await getDb().insert(articleKeywords).values({
        articleId,
        keywordId: kw.id,
        addedDate: new Date()
      }).onConflictDoNothing();

      // Update usage counts
      const linksData = await getDb().select().from(articleKeywords).where(eq(articleKeywords.keywordId, kw.id));
      await getDb().update(keywords).set({ usageCount: linksData.length }).where(eq(keywords.id, kw.id));

      win?.webContents.send('data-updated');
      return { success: true };
    } catch (error) {
      console.error("Error adding keyword:", error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('remove-keyword-from-article', async (_event, { articleId, keyword }) => {
    try {
      const [kw] = await getDb().select().from(keywords).where(eq(keywords.keyword, keyword));
      if (!kw) return { success: false, error: "Keyword not found" };

      await getDb().delete(articleKeywords)
        .where(and(eq(articleKeywords.articleId, articleId), eq(articleKeywords.keywordId, kw.id)));

      const linksData = await getDb().select().from(articleKeywords).where(eq(articleKeywords.keywordId, kw.id));
      await getDb().update(keywords).set({ usageCount: linksData.length }).where(eq(keywords.id, kw.id));

      win?.webContents.send('data-updated');
      return { success: true };
    } catch (error) {
      console.error("Error removing keyword:", error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('export-to-zip', async (_event, { filePaths, zipName }) => {
    if (!win) return;
    const { filePath } = await dialog.showSaveDialog(win, {
      defaultPath: zipName || 'articles-export.zip',
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
    });

    if (!filePath) return { canceled: true };

    return new Promise((resolve) => {
      const output = fs.createWriteStream(filePath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve({ success: true, path: filePath }));
      archive.on('error', (err) => resolve({ success: false, error: String(err) }));

      archive.pipe(output);
      filePaths.forEach((fp: string) => {
        if (fs.existsSync(fp)) {
          archive.file(fp, { name: path.basename(fp) });
        }
      });
      archive.finalize();
    });
  });

  ipcMain.handle('check-ollama', async () => {
    return await checkOllamaStatus();
  });

  ipcMain.handle('list-models', async () => {
    return await listModels();
  });

  ipcMain.handle('set-model', (_event, modelName: string) => {
    // Deprecated but kept for compatibility during migration
    setModel(modelName);
    return true;
  });

  ipcMain.handle('get-settings', async () => {
    const settings = loadSettings();
    return {
      ai: {
        chatModel: settings.ai.chatModel,
        guideModel: settings.ai.guideModel,
        guidePrompt: settings.ai.guidePrompt,
        outputLanguage: settings.ai.outputLanguage,
        promptVersion: settings.ai.promptVersion,
        hasOllamaApiKey: Boolean(settings.ai.ollamaApiKey)
      },
      ui: settings.ui
    };
  });

  ipcMain.handle('get-default-guide-prompt', async () => {
    return getDefaultGuidePrompt();
  });

  ipcMain.handle('save-settings', async (_event, update: SettingsUpdate) => {
    let previousApiKey = '';
    try {
      const current = loadSettings();
      previousApiKey = current.ai.ollamaApiKey;
      const submittedApiKey = update.ai.ollamaApiKey?.trim() || '';
      const nextSettings: AppSettings = {
        ai: {
          chatModel: update.ai.chatModel,
          guideModel: update.ai.guideModel,
          guidePrompt: update.ai.guidePrompt,
          outputLanguage: update.ai.outputLanguage,
          promptVersion: DIGEST_PROMPT_VERSION,
          ollamaApiKey: submittedApiKey || current.ai.ollamaApiKey
        },
        ui: update.ui
      };

      if (!nextSettings.ai.ollamaApiKey) {
        return { success: false, error: 'Enter an Ollama API key.' };
      }

      if (submittedApiKey) {
        setOllamaApiKey(submittedApiKey);
        const authenticated = await checkOllamaStatus();
        if (!authenticated) {
          setOllamaApiKey(previousApiKey);
          return {
            success: false,
            error: previousApiKey
              ? 'The new Ollama API key could not be authenticated. The previously saved key is unchanged.'
              : 'The Ollama API key could not be authenticated. Check the key and network connection.'
          };
        }
      }

      saveSettings(nextSettings);
      setChatModel(nextSettings.ai.chatModel);
      setGuideModel(nextSettings.ai.guideModel);
      setOllamaApiKey(nextSettings.ai.ollamaApiKey);
      const models = await listModels();
      return { success: true, models };
    } catch (error) {
      setOllamaApiKey(previousApiKey);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('select-root-folder', async () => {
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      const rootPath = result.filePaths[0];
      currentRootPath = rootPath; // Store the current root path
      
      // Stop existing watcher
      if (watcher) {
        watcher.stop();
        watcher.removeAllListeners();
      }

      // Initial scan: find all PDFs and report progress
      const allPDFs = findPdfFilesRecursively(rootPath);
      const total = allPDFs.length;
      
      // Send scan start event
      win?.webContents.send('scan-progress', { current: 0, total, filename: '', isScanning: true });


      // Pre-fetch existing file paths and metadata
      const existingArticles = await getDb().select({ 
        filePath: articles.filePath,
        title: articles.title,
        authors: articles.authors,
        doi: articles.doi,
        abstract: articles.abstract,
        journal: articles.journal
      }).from(articles);
      const existingMap = new Map(existingArticles.map(a => [a.filePath, a]));
      
      console.log(`Scanning ${allPDFs.length} files against ${existingMap.size} existing records`);

      // Process each PDF SEQUENTIALLY (important for keyword pool building)
      for (let i = 0; i < allPDFs.length; i++) {
        const fp = allPDFs[i];
        const filename = path.basename(fp);
        const metadata = parseFilename(filename);
        
        // Send progress update
        win?.webContents.send('scan-progress', { current: i + 1, total, filename, isScanning: true });

        try {
           if (existingMap.has(fp)) {
             const existing = existingMap.get(fp)!;
             // DOI alone is sufficient - abstract/journal not always available from CrossRef
             const art = existing as any;
             const hasRichMetadata = !!art.doi;
             
             const needsUpdate = !existing.title || 
                                existing.title === filename || 
                                existing.title.toLowerCase().includes('.pdf') || 
                                !existing.authors ||
                                !hasRichMetadata;

             if (needsUpdate) {
                 console.log(`♻️  Re-processing existing file (metadata poor): ${filename}`);
                 console.log(`    Missing: ${!art.doi ? 'DOI' : ''}`);
                 // We must NOT await here blindly if there are many files, it will slow down startup massive time.
                 // But for now, user wants correctness. We can do it concurrently with a limit or just await.
                 // Given the user is debugging, await is safer to see logs.
                 await processFile(fp);
             } else {
                 // Metadata is good.
             }
             
          } else {
             // New file logic
             console.log(`✨ New file detected: ${filename}`);
             const fileHash = await calculateFileHash(fp);
             
             await getDb().insert(articles).values({
               filename,
               filePath: fp,
               addedDate: new Date(),
               title: metadata.title,
               authors: metadata.authors,
               year: metadata.year,
               fileHash,
               metadataSource: 'filename'
             }).onConflictDoNothing();
             
             // Process for keywords SEQUENTIALLY (wait for completion)
             try {
               await processFile(fp);
             } catch (err) {
               console.error('Error processing file:', err);
             }
             
             // Small delay between API calls to avoid rate limiting
             await new Promise(resolve => setTimeout(resolve, 500));
          }

        } catch (e) {
          console.error('Error processing file during scan:', fp, e);
        }
      }

      // Send scan complete event
      win?.webContents.send('scan-progress', { current: total, total, filename: '', isScanning: false });
      win?.webContents.send('data-updated');

      // Start new watcher
      watcher = new FileWatcher();
      watcher.on('add', async (fp) => {
          console.log("📁 File detected:", fp);
          try {
              const filename = path.basename(fp);
              
              // Calculate hash to check if this is a moved file
              const fileHash = await calculateFileHash(fp);
              
              // Check if this file was recently deleted (moved file)
              const movedFile = recentlyDeletedFiles.get(fileHash);
              if (movedFile && (Date.now() - movedFile.timestamp) < MOVE_DETECTION_TIMEOUT) {
                  // This is a moved file - update path instead of creating new
                  console.log(`📦 File moved: ${movedFile.path} -> ${fp}`);
                  await getDb().update(articles)
                      .set({ filePath: fp, filename, lastModified: new Date() })
                      .where(eq(articles.id, movedFile.articleId));
                  recentlyDeletedFiles.delete(fileHash);
                  win?.webContents.send('data-updated');
                  return;
              }
              
              // New file - add to DB
              await getDb().insert(articles).values({
                  filename,
                  filePath: fp,
                  addedDate: new Date(),
                  title: filename,
                  fileHash,
                  metadataSource: 'filename'
              }).onConflictDoNothing();
              win?.webContents.send('data-updated');
              
              // Then process for keywords (async, don't block)
              processFile(fp).catch(err => {
                console.error('Error in background processing:', err);
              });
          } catch (e) {
              console.error("Error adding file to DB:", e);
          }
      });
      
      watcher.on('unlink', async (fp) => {
          console.log("🗑️ File removed:", fp);
          try {
             // Get article info before deleting for move detection
             const [article] = await getDb().select().from(articles).where(eq(articles.filePath, fp));
             if (article && article.fileHash) {
                 // Store hash temporarily for move detection
                 recentlyDeletedFiles.set(article.fileHash, {
                     path: fp,
                     articleId: article.id,
                     timestamp: Date.now()
                 });
                 
                 // Clean up old entries after timeout
                 setTimeout(() => {
                     const entry = recentlyDeletedFiles.get(article.fileHash!);
                     if (entry && entry.articleId === article.id) {
                         // File was not moved within timeout - actually delete
                         getDb().delete(articles).where(eq(articles.id, article.id))
                             .then(() => win?.webContents.send('data-updated'))
                             .catch(console.error);
                         recentlyDeletedFiles.delete(article.fileHash!);
                     }
                 }, MOVE_DETECTION_TIMEOUT);
             } else {
                 // No hash stored - delete immediately
                 await getDb().delete(articles).where(eq(articles.filePath, fp));
                 win?.webContents.send('data-updated');
             }
          } catch (e) {
             console.error("Error removing file from DB:", e);
          }
      });
      
      watcher.start(rootPath);
      
      return rootPath;
    }
    return null;
  });

  ipcMain.handle('process-file', async (_event, arg: string | { filePath: string, force: boolean }) => {
    try {
      let filePath: string;
      let force = false;
      
      if (typeof arg === 'string') {
          filePath = arg;
      } else {
          filePath = arg.filePath;
          force = arg.force ?? false;
      }

      await processFile(filePath, force);
      return { success: true };
    } catch (error) {
      console.error("Error processing file:", error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('toggle-key-article', async (_event, { articleId, isKey }) => {
    try {
      await getDb().update(articles)
        .set({ isKey: isKey ? 1 : 0 })
        .where(eq(articles.id, articleId));
      win?.webContents.send('data-updated');
      return { success: true };
    } catch (error) {
      console.error("Error toggling key article:", error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('toggle-read-article', async (_event, { articleId, isRead }) => {
    try {
      await getDb().update(articles)
        .set({ isRead: isRead ? 1 : 0 })
        .where(eq(articles.id, articleId));
      win?.webContents.send('data-updated');
      return { success: true };
    } catch (error) {
      console.error("Error toggling read status:", error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('get-directory-tree', async (_event, rootPath?: string) => {
    const targetPath = rootPath || currentRootPath;
    if (!targetPath) {
      return { success: false, error: 'No root path set', tree: [] };
    }

    interface TreeNode {
      name: string;
      path: string;
      children: TreeNode[];
      pdfCount: number;
    }

    const getSubfolders = (dir: string): TreeNode[] => {
      const results: TreeNode[] = [];
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            const fullPath = path.join(dir, entry.name);
            try {
              const files = fs.readdirSync(fullPath);
              const pdfCount = files.filter(f => f.toLowerCase().endsWith('.pdf')).length;
              results.push({
                name: entry.name,
                path: fullPath,
                children: getSubfolders(fullPath),
                pdfCount
              });
            } catch {
              // Skip inaccessible folders
            }
          }
        }
      } catch {
        // Skip if directory can't be read
      }
      return results;
    };

    const tree = getSubfolders(targetPath);
    return { success: true, tree, rootPath: targetPath };
  });

  ipcMain.handle('open-pdf', async (_event, filePath: string) => {
    console.log('open-pdf called with path:', filePath);
    console.log('fs.existsSync result:', fs.existsSync(filePath));
    
    // Try to open regardless of existsSync (Google Drive paths may have issues)
    try {
      const result = await shell.openPath(filePath);
      console.log('shell.openPath result:', result);
      if (result === '') {
        return { success: true };
      }
      return { success: false, error: result };
    } catch (e) {
      console.error('shell.openPath error:', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle('open-external', async (_event, url: string) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      console.error('Error opening external link:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('get-foundation-prompt', async () => {
    try {
      const promptPath = path.join(process.env.APP_ROOT, 'foundation_prompt.md');
      if (fs.existsSync(promptPath)) {
        return { success: true, content: fs.readFileSync(promptPath, 'utf8') };
      }
      return { success: false, error: 'Prompt file not found' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // DEV: Load sample markdown for testing
  ipcMain.handle('load-sample-markdown', async () => {
    try {
      const samplePath = path.join(process.env.APP_ROOT, 'sample_enhanced.md');
      if (fs.existsSync(samplePath)) {
        return { success: true, content: fs.readFileSync(samplePath, 'utf8') };
      }
      return { success: false, error: 'Sample file not found' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('prune-orphans', async () => {
    try {
        const allArticles = await getDb().select().from(articles);
        let removedCount = 0;
        
        for (const article of allArticles) {
            if (!fs.existsSync(article.filePath)) {
                console.log(`🗑️ Pruning orphan: ${article.filePath}`);
                await getDb().delete(articleKeywords).where(eq(articleKeywords.articleId, article.id));
                await getDb().delete(articles).where(eq(articles.id, article.id));
                removedCount++;
            }
        }
        
        if (removedCount > 0) {
            win?.webContents.send('data-updated');
        }
        
        return { success: true, removedCount };
    } catch (error) {
        console.error("Error pruning orphans:", error);
        return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('delete-article', async (_event, articleId: number) => {
    try {
      await getDb().delete(articleKeywords).where(eq(articleKeywords.articleId, articleId));
      await getDb().delete(articles).where(eq(articles.id, articleId));
      win?.webContents.send('data-updated');
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('export-bibtex', async (_event, { articleIds }: { articleIds: number[] }) => {
    if (!win) return null;
    
    try {
      // Get articles from DB
      const allArticles = await getDb().select().from(articles);
      const selectedArticles = allArticles.filter(a => articleIds.includes(a.id));
      
      if (selectedArticles.length === 0) {
        return { success: false, error: 'No articles selected' };
      }
      
      // Send progress
      win?.webContents.send('bibtex-progress', { current: 0, total: selectedArticles.length });
      
      // Generate BibTeX
      const result = await generateBibtexForArticles(selectedArticles);
      
      if (result.bibtex.length === 0) {
        return { success: false, error: 'No articles found in Crossref' };
      }
      
      // Save file
      const { filePath } = await dialog.showSaveDialog(win, {
        defaultPath: `references-${new Date().toISOString().split('T')[0]}.bib`,
        filters: [{ name: 'BibTeX', extensions: ['bib'] }]
      });
      
      if (!filePath) return { canceled: true };
      
      fs.writeFileSync(filePath, result.bibtex, 'utf-8');
      
      return {
        success: true,
        path: filePath,
        found: result.found,
        notFound: result.notFound
      };
    } catch (error) {
      console.error('BibTeX export error:', error);
      return { success: false, error: String(error) };
    }
  });

  // Prepare context when entering chat mode (before first message)
  ipcMain.handle('prepare-context', async (_event, filePath: string) => {
    try {
        console.log(`🔍 Preparing context for ${path.basename(filePath)}`);
        
        let article = await getDb().select({
            id: articles.id,
            abstract: articles.abstract
        }).from(articles).where(eq(articles.filePath, filePath)).get();

        // Check in-memory cache first
        let pdfText = pdfContextCache.get(filePath);

        // LRU-like Logic: If we are adding new one and size is big, delete oldest keys? 
        // Map preserves insertion order. We can delete first key if size > LIMIT.
        
        if (!pdfText) {
             console.log(`   📄 Extracting text from PDF (On-Demand)...`);
             try {
                 const extracted = await extractText(filePath);
                 if (extracted && extracted.length > 0) {
                     pdfText = extracted;
                     
                     // Cache Management
                     if (pdfContextCache.size >= PDF_CACHE_SIZE_LIMIT) {
                         // Delete oldest entry
                         const firstKey = pdfContextCache.keys().next().value;
                         if (firstKey) pdfContextCache.delete(firstKey);
                     }
                     
                     pdfContextCache.set(filePath, pdfText);
                     console.log(`   ✅ Cached PDF text (${pdfText.length} chars). Cache size: ${pdfContextCache.size}`);
                 }
             } catch (e) {
                 console.error("Extraction failed:", e);
             }
        } else {
             console.log(`   ✅ Cache hit for ${path.basename(filePath)}`);
             // Refresh LRU order (delete and set)
             pdfContextCache.delete(filePath);
             pdfContextCache.set(filePath, pdfText);
        }

        if (pdfText) {
            console.log(`📦 Full text available in cache`);
            win?.webContents.send('chat-context-status', { status: 'cached', message: 'Context ready (Full Text)' });
            return { success: true, cached: true };
        } else if (article?.abstract) {
            console.log(`📦 Abstract available only`);
            win?.webContents.send('chat-context-status', { status: 'cached', message: 'Context ready (Abstract only)' });
            return { success: true, cached: true };
        } else {
            console.log(`⚠️ No context available`);
            win?.webContents.send('chat-context-status', { status: 'warning', message: 'No text available.' });
            return { success: true, cached: false };
        }
    } catch (error) {
        console.error("Prepare context error:", error);
        win?.webContents.send('chat-context-status', { status: 'error', message: String(error) });
        return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('chat-paper', async (_event, { filePath, messages }) => {
    try {
        console.log(`💬 Chat request for ${path.basename(filePath)}`);
        
        // 1. Get abstract from DB
        const article = await getDb().select({
            id: articles.id,
            abstract: articles.abstract,
            title: articles.title
        }).from(articles).where(eq(articles.filePath, filePath)).get();

        let pdfText = pdfContextCache.get(filePath);

        // Fallback: Lazy extract if not in cache (e.g. if user refreshed app but stuck on page)
        if (!pdfText) {
             try {
                 const extracted = await extractText(filePath);
                 if (extracted && extracted.length > 0) {
                     pdfText = extracted;
                     // Update cache
                     if (pdfContextCache.size >= PDF_CACHE_SIZE_LIMIT) {
                         const firstKey = pdfContextCache.keys().next().value;
                         if (firstKey) pdfContextCache.delete(firstKey);
                     }
                     pdfContextCache.set(filePath, pdfText);
                 }
             } catch (e) { console.error("Lazy extraction failed in chat-paper:", e); }
        }

        let text = "";
        
        // Prioritize full PDF text
        if (pdfText) {
            text = `Title: ${article?.title}\n\nFull Text:\n${pdfText}`;
            console.log(`📦 Using cached PDF context for ${path.basename(filePath)} (${pdfText.length} chars)`);
        } else if (article?.abstract) {
            text = `Title: ${article?.title}\n\nAbstract:\n${article.abstract}`;
            console.log(`📦 Using abstract context for ${path.basename(filePath)}`);
        } else {
            text = `Title: ${article?.title || path.basename(filePath)}\n\n(No abstract or text available)`;
            console.log(`⚠️ No context available for ${path.basename(filePath)}`);
        }
        
        win?.webContents.send('chat-context-status', { status: 'ready', message: 'Sending to AI...' });
        
        // 2. Send to LLM
        const response = await chatWithPaper(text, messages);
        
        return { success: true, response };
    } catch (error) {
        console.error("Chat error:", error);
        win?.webContents.send('chat-context-status', { status: 'error', message: String(error) });
        return { success: false, error: String(error) };
    }
  });
});
// --- CHAT SESSION HANDLERS ---

import { chatSessions, chatMessages } from './db/schema';

ipcMain.handle('create-chat-session', async (_event, articleId: number, title?: string) => {
  try {
    const newSession = await getDb().insert(chatSessions).values({
      articleId,
      title: title || 'New Chat',
    }).returning();
    return { success: true, session: newSession[0] };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('get-chat-sessions', async (_event, articleId: number) => {
  try {
    const sessions = await getDb().select()
      .from(chatSessions)
      .where(eq(chatSessions.articleId, articleId))
      .orderBy(desc(chatSessions.updatedDate)); // Most recent first
    return { success: true, sessions };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('delete-chat-session', async (_event, sessionId: number) => {
  try {
    await getDb().delete(chatSessions).where(eq(chatSessions.id, sessionId));
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('update-session-title', async (_event, sessionId: number, title: string) => {
  try {
    await getDb().update(chatSessions)
      .set({ title, updatedDate: new Date() })
      .where(eq(chatSessions.id, sessionId));
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('load-chat-messages', async (_event, sessionId: number) => {
  try {
    const msgs = await getDb().select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(asc(chatMessages.createdDate));
    return { success: true, messages: msgs };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('save-chat-message', async (_event, sessionId: number, role: 'user' | 'assistant', content: string, label?: string) => {
  try {
    const saved = await getDb().insert(chatMessages).values({
      sessionId,
      role,
      content,
      label
    }).returning();
    
    // Also update session updated_date
    await getDb().update(chatSessions)
      .set({ updatedDate: new Date() })
      .where(eq(chatSessions.id, sessionId));

    return { success: true, message: saved[0] };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('export-chat-history', async (_event, sessionId: number) => {
  try {
    // 1. Fetch data
    const [session] = await getDb().select().from(chatSessions).where(eq(chatSessions.id, sessionId));
    const msgs = await getDb().select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(asc(chatMessages.createdDate));

    if (!session) throw new Error("Session not found");

    // 2. Format Markdown
    let mdContent = `# ${session.title}\n\nDate: ${new Date().toLocaleString()}\n\n---\n\n`;
    
    for (const m of msgs) {
      const roleDisplay = m.role === 'user' ? '## User' : '## Assistant';
      mdContent += `${roleDisplay}\n\n${m.content}\n\n`;
    }

    // 3. Save dialog
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export Chat History',
      defaultPath: `${session.title || 'chat-export'}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    });

    if (canceled || !filePath) return { success: false, cancelled: true };

    fs.writeFileSync(filePath, mdContent);
    return { success: true, filePath };

  } catch (error) {
    return { success: false, error: String(error) };
  }
});
