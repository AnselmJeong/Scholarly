import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { initDB, getDb } from './db/index'
import { FileWatcher } from './services/watcher'
import { checkOllamaStatus, listModels, setModel, chatWithPaper, setChatModel } from './services/ai'
import { loadSettings, saveSettings, AppSettings } from './store'
import { articles, keywords, articleKeywords } from './db/schema'
import { generateBibtexForArticles } from './services/bibtex'
import { fetchPaperMetadata } from './services/openalex'
import { eq, and, sql } from 'drizzle-orm'
import fs from 'node:fs'
import crypto from 'node:crypto'
import archiver from 'archiver'
import { extractText } from './services/pdf'

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
  const match = filename.match(/^(\d{4})\s*-\s*(.+?)\s*-\s*(.+?)(?:\.pdf)?$/i);
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
    console.log('Loaded settings:', settings);

    if (settings.ai.chatModel) setChatModel(settings.ai.chatModel);

  } catch (e) {
    console.error("Failed to init DB:", e);
    dialog.showErrorBox('Database Initialization Error', `Failed to initialize database: ${String(e)}`);
  }

  // Create Window after DB is ready
  createWindow();

  win?.webContents.on('did-finish-load', () => {
     win?.webContents.send('db-ready');
  });
  
  // Check Ollama status in background
  checkOllamaStatus().then(async (ollamaRunning) => {
    if (ollamaRunning) {
      console.log("✅ Ollama is running");
      const models = await listModels();
      console.log("   Available models:", models);
    } else {
      console.warn("⚠️ Ollama is not running! Please start Ollama for AI features.");
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
    const filtered = allArticles.filter(a => a.filePath.startsWith(currentRootPath!));

    // Check for guidance file existence
    const withGuidance = filtered.map(a => {
      const summaryPath = path.join(path.dirname(a.filePath), 'summary', path.basename(a.filePath, '.pdf') + '.md');
      return {
        ...a,
        hasGuidance: fs.existsSync(summaryPath)
      };
    });
    
    return withGuidance;
  });

  ipcMain.handle('read-guidance', async (_event, filePath: string) => {
    try {
      const summaryPath = path.join(path.dirname(filePath), 'summary', path.basename(filePath, '.pdf') + '.md');
      if (fs.existsSync(summaryPath)) {
          const content = fs.readFileSync(summaryPath, 'utf8');
          return { success: true, content };
      }
      return { success: false, error: 'Guidance file not found' };
    } catch (e) {
      return { success: false, error: String(e) };
    }
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
    return loadSettings();
  });

  ipcMain.handle('save-settings', async (_event, settings: AppSettings) => {
    saveSettings(settings);

    if (settings.ai.chatModel) setChatModel(settings.ai.chatModel);
    return true;
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
      const findPDFs = (dir: string): string[] => {
        const results: string[] = [];
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.name.startsWith('.')) continue; // Skip hidden files
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              results.push(...findPDFs(fullPath));
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
              results.push(fullPath);
            }
          }
        } catch (e) {
          console.error('Error scanning directory:', dir, e);
        }
        return results;
      };

      const allPDFs = findPDFs(rootPath);
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
               fileHash
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
                  fileHash
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
