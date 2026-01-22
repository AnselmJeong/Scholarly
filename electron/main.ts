import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { initDB, getDb } from './db/index'
import { FileWatcher } from './services/watcher'
import { extractText } from './services/pdf'
import { extractKeywords, checkOllamaStatus, listModels, setModel, chatWithPaper } from './services/ai'
import { articles, keywords, articleKeywords } from './db/schema'
import { generateBibtexForArticles, searchCrossref } from './services/crossref'
import { eq, and } from 'drizzle-orm'
import fs from 'node:fs'
import crypto from 'node:crypto'
import archiver from 'archiver'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Map to track recently deleted files for move detection (hash -> {path, timestamp})
const recentlyDeletedFiles = new Map<string, { path: string; articleId: number; timestamp: number }>()
const MOVE_DETECTION_TIMEOUT = 3000 // 3 seconds window to detect file moves

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
    vibrancy: 'under-window',
    visualEffectState: 'active'
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

// Process a single file: extract text, get keywords, save to DB
async function processFile(filePath: string): Promise<void> {
  const filename = path.basename(filePath);
  console.log(`\n📄 Processing: ${filename}`);
  
  try {
    // Get article from DB first
    const [article] = await getDb().select().from(articles).where(eq(articles.filePath, filePath));
    if (!article) {
      console.log(`   Article not in DB yet, skipping`);
      return;
    }
    
    // Check if article already has keywords (prevent duplicate processing)
    const existingLinks = await getDb().select().from(articleKeywords).where(eq(articleKeywords.articleId, article.id));
    if (existingLinks.length > 0) {
      console.log(`   Article already has ${existingLinks.length} keywords, skipping`);
      return;
    }

    // --- CrossRef Metadata Fetching ---
    try {
      const searchTitle = article.title && article.title !== filename ? article.title : filename.replace(/\.pdf$/i, '');
      console.log(`   🔍 Searching Crossref for metadata: ${searchTitle}`);
      const metadata = await searchCrossref(searchTitle);

      if (metadata) {
        console.log(`   ✅ Found Crossref data: ${metadata.title?.[0]}`);
        
        // Prepare updates
        const updates: any = {};
        
        if (metadata.title && metadata.title.length > 0) {
          updates.title = metadata.title[0];
        }
        
        if (metadata.author && metadata.author.length > 0) {
          updates.authors = metadata.author.map(a => `${a.family}, ${a.given}`).join('; ');
        }
        
        if (metadata.issued?.['date-parts']?.[0]?.[0]) {
          updates.year = metadata.issued['date-parts'][0][0];
        }
        
        if (metadata['container-title'] && metadata['container-title'].length > 0) {
          updates.journal = metadata['container-title'][0];
        }
        
        if (metadata.DOI) {
          updates.doi = metadata.DOI;
        }
        
        if (metadata.abstract) {
          // Clean abstract (remove HTML tags)
          updates.abstract = metadata.abstract.replace(/<[^>]*>/g, '').trim();
        }

        // Update DB if we have data
        if (Object.keys(updates).length > 0) {
          await getDb().update(articles)
            .set(updates)
            .where(eq(articles.id, article.id));
          console.log(`   Updated article metadata from Crossref`);
          win?.webContents.send('data-updated');
        }
      } else {
        console.log(`   ⚠️ No Crossref data found`);
      }
    } catch (err) {
      console.error(`   Error fetching Crossref metadata:`, err);
    }
    // ----------------------------------
    
    // Extract text from PDF
    const text = await extractText(filePath);
    console.log(`   Text extracted: ${text.length} chars`);
    
    // Get existing keywords (normalized for comparison)
    const allKeywords = await getDb().select().from(keywords);
    const keywordList = allKeywords.map(k => k.keyword);
    
    // Extract keywords using Ollama
    const result = await extractKeywords(text, keywordList);
    console.log(`   Keywords found:`, result);
    
    // Normalize keywords (Title Case)
    const normalizeKeyword = (kw: string): string => {
      return kw.toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    };
    
    // Combine and normalize keywords, remove duplicates
    const allExtractedKeywords = [...result.existing, ...result.new];
    const normalizedKeywords = [...new Set(allExtractedKeywords.map(normalizeKeyword))];
    
    // Limit to max 10 keywords
    const finalKeywords = normalizedKeywords.slice(0, 10);
    console.log(`   Normalized keywords (${finalKeywords.length}):`, finalKeywords);
    
    // Save keywords to DB and link to article
    for (const kw of finalKeywords) {
      // Check if keyword exists (case-insensitive)
      const [existingKw] = await getDb().select().from(keywords).where(eq(keywords.keyword, kw));
      
      if (!existingKw) {
        // Insert new keyword
        await getDb().insert(keywords).values({
          keyword: kw,
          createdDate: new Date(),
          usageCount: 1
        }).onConflictDoNothing();
      }
      
      // Get keyword ID
      const [keywordRow] = await getDb().select().from(keywords).where(eq(keywords.keyword, kw));
      if (keywordRow) {
        // Link keyword to article
        await getDb().insert(articleKeywords).values({
          articleId: article.id,
          keywordId: keywordRow.id,
          addedDate: new Date()
        }).onConflictDoNothing();
        
        // Update usage count
        await getDb().update(keywords)
          .set({ usageCount: (keywordRow.usageCount || 0) + 1 })
          .where(eq(keywords.id, keywordRow.id));
      }
    }
    
    console.log(`   ✅ Saved ${allExtractedKeywords.length} keywords for ${filename}`);
    win?.webContents.send('data-updated');
    
  } catch (error) {
    console.error(`   ❌ Error processing ${filename}:`, error);
  }
}

app.whenReady().then(async () => {
  try {
    initDB();
    console.log("Database initialized");
  } catch (e) {
    console.error("Failed to init DB:", e);
  }

  // Check Ollama status
  const ollamaRunning = await checkOllamaStatus();
  if (ollamaRunning) {
    console.log("✅ Ollama is running");
    const models = await listModels();
    console.log("   Available models:", models);
  } else {
    console.warn("⚠️ Ollama is not running! Please start Ollama for AI features.");
  }

  createWindow();

  // IPC Handlers
  ipcMain.handle('get-articles', async () => {
    const allArticles = await getDb().select().from(articles).orderBy(articles.addedDate);
    // Filter by current root path if set
    const filtered = currentRootPath 
      ? allArticles.filter(a => a.filePath.startsWith(currentRootPath!))
      : allArticles;

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
    setModel(modelName);
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

      // Process each PDF SEQUENTIALLY (important for keyword pool building)
      for (let i = 0; i < allPDFs.length; i++) {
        const fp = allPDFs[i];
        const filename = path.basename(fp);
        const metadata = parseFilename(filename);
        
        // Send progress update
        win?.webContents.send('scan-progress', { current: i + 1, total, filename, isScanning: true });

        try {
          // Calculate file hash
          const fileHash = await calculateFileHash(fp);
          
          // Check if already in DB
          const [existing] = await getDb().select().from(articles).where(eq(articles.filePath, fp));
          if (!existing) {
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
          } else {
            // Update metadata if missing (e.g. for existing records)
            if (!existing.title || !existing.year || !existing.authors) {
               await getDb().update(articles).set({
                   title: metadata.title,
                   authors: metadata.authors,
                   year: metadata.year
               }).where(eq(articles.id, existing.id));
            }
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

  ipcMain.handle('process-file', async (_event, filePath: string) => {
    try {
      await processFile(filePath);
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

  ipcMain.handle('open-pdf', async (_event, filePath: string) => {
    if (fs.existsSync(filePath)) {
      await shell.openPath(filePath);
      return { success: true };
    }
    return { success: false, error: "File not found" };
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

  ipcMain.handle('chat-paper', async (_event, { filePath, messages }) => {
    try {
        console.log(`💬 Chat request for ${path.basename(filePath)}`);
        
        // 1. Extract text (cached or fresh)
        // Note: extractText already caches somewhat by virtue of OS/FS, but we could improve this.
        // For now, re-extracting is usually fast enough for text-based PDFs.
        const text = await extractText(filePath);
        
        // 2. Send to LLM
        const response = await chatWithPaper(text, messages);
        
        return { success: true, response };
    } catch (error) {
        console.error("Chat error:", error);
        return { success: false, error: String(error) };
    }
  });
});
