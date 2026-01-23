import { useState, useEffect, useCallback, useMemo } from 'react'
import { Sidebar } from '@/components/Sidebar'
import { ArticleList } from '@/components/ArticleList'
import { ArticleDetail } from '@/components/ArticleDetail'
import { SettingsModal } from '@/components/SettingsModal'
import { ScanProgress } from '@/components/ScanProgress'
import { ResizablePanels } from '@/components/ResizablePanels'
import { GuidanceViewer } from '@/components/GuidanceViewer'

// Types
interface Article {
    id: number;
    title: string | null;
    filename: string;
    authors: string | null;
    year: number | null;
    abstract: string | null;
    journal: string | null;
    doi: string | null;
    filePath: string;
    addedDate: string | Date | null;
    hasGuidance?: boolean;
    isKey?: number | boolean;
}

interface Keyword {
    id: number;
    keyword: string;
    usageCount: number;
}

interface ArticleKeywordLink {
  articleId: number;
  keywordId: number;
}

function App() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [links, setLinks] = useState<ArticleKeywordLink[]>([]);
  
  const [selectedArticleId, setSelectedArticleId] = useState<number | null>(null);
  const [selectedKeywordIds, setSelectedKeywordIds] = useState<number[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [articleKeywords, setArticleKeywords] = useState<string[]>([]);
  const [ollamaStatus, setOllamaStatus] = useState<boolean | null>(null);
  
  // Settings state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [currentModel, setCurrentModel] = useState('nemotron-3-nano:30b-cloud');

  // Scan progress state
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0, filename: '', isScanning: false });

  // Center Panel State
  const [centerTab, setCenterTab] = useState<'list' | 'guidance'>('list');
  const [guidanceContent, setGuidanceContent] = useState<string>('');
  const [guidanceTitle, setGuidanceTitle] = useState<string>('');

  const fetchData = useCallback(async () => {
      try {
          const [articlesData, keywordsData, linksData] = await Promise.all([
            window.ipcRenderer.invoke('get-articles'),
            window.ipcRenderer.invoke('get-keywords'),
            window.ipcRenderer.invoke('get-all-links')
          ]);
          
          setArticles(articlesData || []);
          setKeywords(keywordsData || []);
          setLinks(linksData || []);
      } catch (e) {
          console.error("Failed to fetch data", e);
      }
  }, []);

  const checkOllama = useCallback(async () => {
    try {
      const status = await window.ipcRenderer.invoke('check-ollama');
      setOllamaStatus(status);
    } catch (e) {
      setOllamaStatus(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    checkOllama();

    const handleUpdate = () => {
        fetchData();
    };

    window.ipcRenderer.on('data-updated', handleUpdate);

    // Listen for scan progress
    const handleScanProgress = (_event: unknown, data: { current: number; total: number; filename: string; isScanning: boolean }) => {
      setScanProgress(data);
    };
    window.ipcRenderer.on('scan-progress', handleScanProgress);

    return () => {
      // Cleanup listeners if needed
    };
  }, [fetchData, checkOllama]);

  // Fetch keywords for specific selected article detail view
  useEffect(() => {
    if (selectedArticleId) {
      window.ipcRenderer.invoke('get-article-keywords', selectedArticleId)
        .then((kws: string[]) => {
          setArticleKeywords(kws || []);
        })
        .catch(console.error);
    } else {
      setArticleKeywords([]);
    }
  }, [selectedArticleId]);

  // Filtering Logic
  const [filenameFilter, setFilenameFilter] = useState('');

  const filteredArticles = useMemo(() => {
    let result = articles;

    // 1. Multi-Keyword Filter (AND Logic)
    if (selectedKeywordIds.length > 0) {
        // Group links by articleId for easier lookup
        const articleKeywordMap = new Map<number, Set<number>>();
        links.forEach(l => {
            if (!articleKeywordMap.has(l.articleId)) {
                articleKeywordMap.set(l.articleId, new Set());
            }
            articleKeywordMap.get(l.articleId)?.add(l.keywordId);
        });

        result = result.filter(a => {
            const articleKws = articleKeywordMap.get(a.id);
            if (!articleKws) return false;
            // Check if article has ALL selected keyword IDs
            return selectedKeywordIds.every(id => articleKws.has(id));
        });
    }

    // 2. Filename Search Filter
    if (filenameFilter.trim()) {
        const lowerFilter = filenameFilter.toLowerCase();
        result = result.filter(a => 
            (a.filename && a.filename.toLowerCase().includes(lowerFilter)) ||
            (a.title && a.title.toLowerCase().includes(lowerFilter))
        );
    }
    
    return result;
  }, [articles, links, selectedKeywordIds, filenameFilter]);

  const filteredKeywords = useMemo(() => {
    const currentArticleIds = filteredArticles.map(a => a.id);
    
    const activeKeywordIds = Array.from(new Set(
      links
        .filter(l => currentArticleIds.includes(l.articleId))
        .map(l => l.keywordId)
    ));

    return keywords
      .filter(k => activeKeywordIds.includes(k.id))
      .map(k => ({
        id: k.id,
        keyword: k.keyword,
        count: links.filter(l => l.keywordId === k.id && currentArticleIds.includes(l.articleId)).length
      }))
      .sort((a, b) => b.count - a.count);

  }, [keywords, links, filteredArticles]);

  const handleSelectKeyword = (id: number) => {
      setSelectedKeywordIds(prev => {
          if (id === -1) return []; // Reset
          if (prev.includes(id)) {
              return prev.filter(k => k !== id); // Remove
          }
          return [...prev, id]; // Add
      });
      setSelectedArticleId(null);
  };
  const handlePruneOrphans = async () => {
    if (confirm("This will remove all records from the database for files that no longer exist in the watched folders. Continue?")) {
        try {
            const result = await window.ipcRenderer.invoke('prune-orphans');
            if (result.success) {
                alert(`Removed ${result.removedCount} orphaned records.`);
                fetchData();
            } else {
                alert("Error pruning orphans: " + result.error);
            }
        } catch (e) {
            console.error("Prune error:", e);
            alert("Failed to prune orphans.");
        }
    }
  };

  const handleProcess = async () => {
    if (!selectedArticleId) return;
    const article = articles.find(a => a.id === selectedArticleId);
    if (!article) return;

    setIsProcessing(true);
    try {
        const result = await window.ipcRenderer.invoke('process-file', article.filePath);
        if (result.success) {
            fetchData();
            const kws = await window.ipcRenderer.invoke('get-article-keywords', selectedArticleId);
            setArticleKeywords(kws || []);
        }
    } finally {
        setIsProcessing(false);
    }
  };

  const handleAddKeyword = async (keyword: string) => {
    if (!selectedArticleId) return;
    const result = await window.ipcRenderer.invoke('add-keyword-to-article', { 
        articleId: selectedArticleId, 
        keyword 
    });
    if (result.success) {
        fetchData();
        const kws = await window.ipcRenderer.invoke('get-article-keywords', selectedArticleId);
        setArticleKeywords(kws || []);
    }
  };

  const handleRemoveKeyword = async (keyword: string) => {
    if (!selectedArticleId) return;
    const result = await window.ipcRenderer.invoke('remove-keyword-from-article', { 
        articleId: selectedArticleId, 
        keyword 
    });
    if (result.success) {
        fetchData();
        const kws = await window.ipcRenderer.invoke('get-article-keywords', selectedArticleId);
        setArticleKeywords(kws || []);
    }
  };

  const handleExport = async () => {
    if (filteredArticles.length === 0) return;
    
    const filePaths = filteredArticles.map(a => a.filePath);
    const keywordName = selectedKeywordIds.length === 1 
        ? keywords.find(k => k.id === selectedKeywordIds[0])?.keyword 
        : (selectedKeywordIds.length > 1 ? 'multi-selected' : 'all');
        
    const zipName = `articles-${keywordName}-${new Date().toISOString().split('T')[0]}.zip`;

    const result = await window.ipcRenderer.invoke('export-to-zip', { filePaths, zipName });
    if (result?.success) {
        alert(`Successfully exported ${filteredArticles.length} articles to ${result.path}`);
    }
  };

  const handleExportBibtex = async () => {
    if (filteredArticles.length === 0) return;
    
    const articleIds = filteredArticles.map(a => a.id);
    const result = await window.ipcRenderer.invoke('export-bibtex', { articleIds });
    
    if (result?.canceled) return;
    if (result?.success) {
        const message = result.notFound?.length > 0 
          ? `BibTeX exported: ${result.found} found, ${result.notFound.length} not found in Crossref`
          : `Successfully exported ${result.found} BibTeX entries to ${result.path}`;
        alert(message);
    } else if (result?.error) {
        alert(`Export failed: ${result.error}`);
    }
  };

  const handleOpenPdf = async (filename?: string) => {
    let targetArticle = null;
    
    if (filename) {
      targetArticle = articles.find(a => a.filename === filename);
    } else if (selectedArticleId) {
      targetArticle = articles.find(a => a.id === selectedArticleId);
    }

    if (targetArticle) {
        await window.ipcRenderer.invoke('open-pdf', targetArticle.filePath);
    }
  };

  const handleOpenGuidance = async (article: Article) => {
      try {
          const result = await window.ipcRenderer.invoke('read-guidance', article.filePath);
          if (result.success) {
              setGuidanceContent(result.content);
              setGuidanceTitle(article.title || article.filename);
              setCenterTab('guidance');
          } else {
              alert("Failed to load guidance: " + result.error);
          }
      } catch (e) {
          console.error("Error opening guidance:", e);
      }
  };

  const handleDeleteArticle = async () => {
    if (!selectedArticleId) return;
    if (confirm("Are you sure you want to remove this article from the database? (File will not be deleted)")) {
        const result = await window.ipcRenderer.invoke('delete-article', selectedArticleId);
        if (result.success) {
            setSelectedArticleId(null);
            fetchData();
        }
    }
  };

  const handleToggleKey = async (articleId: number, isKey: boolean) => {
    try {
      const result = await window.ipcRenderer.invoke('toggle-key-article', { articleId, isKey });
      if (result.success) {
        fetchData();
      }
    } catch (e) {
      console.error("Error toggling key status:", e);
    }
  };

  const handleSelectRoot = async () => {
    const path = await window.ipcRenderer.invoke('select-root-folder');
    if (path) {
        setRootPath(path);
    }
  };

  const handleModelChange = async (model: string) => {
    try {
      await window.ipcRenderer.invoke('set-model', model);
      setCurrentModel(model);
    } catch (e) {
      console.error('Failed to change model', e);
    }
  };

  const selectedArticle = articles.find(a => a.id === selectedArticleId) || null;
  const allKeywordNames = keywords.map(k => k.keyword);

  return (
    <div className="h-screen w-screen overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-100 font-sans relative">
       {/* Draggable Title Bar Area for Electron */}
       <div className="absolute top-0 left-0 right-0 h-10 drag-region pointer-events-none z-0" />
       
       {ollamaStatus === false && (
         <div className="absolute top-4 right-4 z-50 px-4 py-2 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs font-medium backdrop-blur-md animate-in slide-in-from-top-4 duration-300">
           ⚠️ Ollama not running
         </div>
       )}
       
       <ResizablePanels
         leftPanel={
           <Sidebar 
             keywords={filteredKeywords} 
             selectedKeywordIds={selectedKeywordIds} 
             onSelectKeyword={handleSelectKeyword}
             onSelectRootFolder={handleSelectRoot}
             onOpenSettings={() => setIsSettingsOpen(true)}
             rootPath={rootPath}
           />
         }
         centerPanel={
           centerTab === 'list' ? (
               <ArticleList 
                 articles={filteredArticles} 
                 selectedId={selectedArticleId}
                 onSelect={setSelectedArticleId}
                 onExport={handleExport}
                 onExportBibtex={handleExportBibtex}
                 onOpenPdf={(filename) => handleOpenPdf(filename)}
                 onOpenGuidance={handleOpenGuidance}
                 onToggleKey={handleToggleKey}
                 searchTerm={filenameFilter}
                 onSearchChange={setFilenameFilter}
                 onRescan={handlePruneOrphans}
               />
           ) : (
               <GuidanceViewer 
                   content={guidanceContent}
                   title={guidanceTitle}
                   onClose={() => setCenterTab('list')}
               />
           )
         }
         rightPanel={
           <ArticleDetail 
             article={selectedArticle} 
             keywords={articleKeywords}
             allKeywordsAvailable={allKeywordNames}
             onProcess={handleProcess}
             onAddKeyword={handleAddKeyword}
             onRemoveKeyword={handleRemoveKeyword}
             onOpenPdf={handleOpenPdf}
             onDelete={handleDeleteArticle}
             isProcessing={isProcessing}
           />
         }
         initialLeftWidth={280}
         initialRightWidth={400}
         minLeftWidth={200}
         minCenterWidth={350}
         minRightWidth={320}
       />

       <SettingsModal 
         isOpen={isSettingsOpen}
         onClose={() => setIsSettingsOpen(false)}
         currentModel={currentModel}
         onModelChange={handleModelChange}
       />

       <ScanProgress 
         current={scanProgress.current}
         total={scanProgress.total}
         currentFile={scanProgress.filename}
         isVisible={scanProgress.isScanning}
       />
    </div>
  )
}

export default App
