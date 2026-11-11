import { cn } from '@/lib/utils';
import type { DigestStatus, GuidanceBatchState } from '@/types/guidance';

interface Article {
    id: number;
    title: string | null;
    filename: string;
    authors: string | null;
    year: number | null;
    addedDate: string | Date | null;
    journal: string | null;
    doi: string | null;
    hasGuidance?: boolean;
    guidanceStatus?: DigestStatus;
    isKey?: number | boolean;
    isRead?: number | boolean;
    abstract: string | null;
    filePath: string;
}


interface ArticleListProps {
    articles: Article[];
    onSelect: (id: number) => void;
    onExport: () => void;
    onExportBibtex: () => void;
    selectedId: number | null;
    onOpenPdf?: (filename: string) => void;
    onOpenGuidance?: (article: Article) => void;
    onGenerateMissingGuides?: () => void;
    onCancelDigestBatch?: () => void;
    onToggleKey?: (articleId: number, isKey: boolean) => void;
    onToggleRead?: (articleId: number, isRead: boolean) => void;
    searchTerm: string;
    onSearchChange: (term: string) => void;
    onRescan?: () => void;
    onSelectFolder?: () => void;
    isSidebarOpen?: boolean;
    onToggleSidebar?: () => void;
    isGeneratingGuides?: boolean;
    guideGenerationInProgressPaths?: string[];
    guidanceBatch?: GuidanceBatchState | null;
}

import { useState, useMemo } from 'react';

export function ArticleList({ 
    articles, 
    onSelect, 
    onExport, 
    onExportBibtex, 
    selectedId, 
    onOpenPdf, 
    onOpenGuidance, 
    onGenerateMissingGuides,
    onCancelDigestBatch,
    onToggleKey,
    onToggleRead,
    searchTerm,
    onSearchChange,
    onRescan,
    onSelectFolder,
    isSidebarOpen = true,
    onToggleSidebar,
    isGeneratingGuides = false,
    guideGenerationInProgressPaths = [],
    guidanceBatch = null
}: ArticleListProps) {
  const [sortField, setSortField] = useState<'title' | 'authors' | 'year' | 'isKey'>('year');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [isRescanning, setIsRescanning] = useState(false);
  const [showAuthors, setShowAuthors] = useState(true);
  const isBatchRunning = guidanceBatch?.status === 'running';
  const isBatchCancelling = guidanceBatch?.status === 'cancelling';
  const isBatchActive = isBatchRunning || isBatchCancelling;

  const handleSort = (field: 'title' | 'authors' | 'year' | 'isKey') => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection(field === 'year' || field === 'isKey' ? 'desc' : 'asc');
    }
  };

  const sortedArticles = useMemo(() => {
    return [...articles].sort((a, b) => {
      let aValue: any = a[sortField];
      let bValue: any = b[sortField];

      if (sortField === 'isKey') {
        aValue = a.isKey ? 1 : 0;
        bValue = b.isKey ? 1 : 0;
      }
      
      // Fallback for title/filename
      if (sortField === 'title') {
        aValue = a.title || a.filename;
        bValue = b.title || b.filename;
      }

      // Handle nulls
      if (aValue === null || aValue === undefined) return 1;
      if (bValue === null || bValue === undefined) return -1;

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [articles, sortField, sortDirection]);

  const SortIcon = ({ field }: { field: 'title' | 'authors' | 'year' | 'isKey' }) => {
    if (sortField !== field) return <span className="text-slate-700 ml-1">↕</span>;
    return <span className="text-blue-400 ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
  };

  const handleRescanClick = async () => {
    if (onRescan && !isRescanning) {
        setIsRescanning(true);
        try {
            await onRescan();
        } finally {
            setIsRescanning(false);
        }
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-800/30 backdrop-blur-sm">
        {/* Header */}
        <div className="border-b border-slate-700/50 px-6 py-4 bg-slate-900/30 drag-region space-y-3">
            <div className="flex items-start justify-between gap-6">
                <div className="flex min-w-0 items-start gap-4">
                    {/* Sidebar Toggle */}
                    {onToggleSidebar && (
                        <button
                            onClick={onToggleSidebar}
                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors no-drag"
                            title={isSidebarOpen ? "Collapse Sidebar" : "Expand Sidebar"}
                        >
                            {isSidebarOpen ? (
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><path d="M9 3v18"/></svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><path d="M3 9h18"/></svg>
                            )}
                        </button>
                    )}

                    <div className="h-9 w-px shrink-0 bg-slate-700/50" />

                    <div className="min-w-0">
                        <div className="flex h-9 items-center gap-2">
                            <h2 className="text-lg font-semibold text-slate-200">Articles</h2>
                            <button 
                                onClick={handleRescanClick}
                                disabled={isRescanning}
                                className={cn(
                                    "flex h-9 items-center gap-2 px-3 ml-2 rounded-lg transition-colors no-drag border border-transparent",
                                    isRescanning 
                                        ? "bg-blue-500/20 text-blue-300 border-blue-500/30" 
                                        : "bg-slate-700/50 text-slate-300 hover:bg-blue-600/20 hover:text-blue-200 hover:border-blue-500/30"
                                )}
                                title="Rescan & Prune Orphans"
                            >
                               <span className={isRescanning ? "animate-spin" : ""}>🔄</span>
                               <span className="text-xs font-medium">Rescan</span>
                            </button>
                            <button
                                onClick={isBatchActive ? onCancelDigestBatch : onGenerateMissingGuides}
                                disabled={(isGeneratingGuides && !isBatchActive) || isBatchCancelling}
                                className={cn(
                                    "flex h-9 items-center gap-2 px-3 rounded-lg transition-colors no-drag border",
                                    isBatchActive
                                        ? "bg-amber-500/15 text-amber-200 border-amber-500/40 hover:bg-amber-500/25 disabled:opacity-60"
                                        : "bg-slate-700/50 text-slate-300 hover:bg-emerald-600/20 hover:text-emerald-200 hover:border-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
                                )}
                                title={isBatchActive ? "Cancel the active request and stop this folder batch" : "Digest this folder; current digests are skipped"}
                            >
                                <span className={isBatchRunning ? "animate-pulse" : ""}>{isBatchActive ? '■' : '📝'}</span>
                                <span className="text-xs font-medium">
                                    {isBatchCancelling
                                        ? 'Cancelling…'
                                        : isBatchRunning
                                          ? `Cancel ${guidanceBatch.current}/${guidanceBatch.total}`
                                          : 'Digest Folder'}
                                </span>
                            </button>
                        </div>
                        <div className="flex min-h-5 min-w-0 items-center gap-2 text-xs text-slate-500">
                            <span>{articles.length} items</span>
                            {isBatchActive && (
                                <span className="min-w-0 truncate text-emerald-400" title={guidanceBatch.detail} aria-live="polite">
                                    · {guidanceBatch.created} created, {guidanceBatch.updated} updated, {guidanceBatch.skippedCurrent} current, {guidanceBatch.failed} failed, {guidanceBatch.remaining} remaining
                                    {guidanceBatch.detail ? ` · ${guidanceBatch.detail}` : ''}
                                </span>
                            )}
                            {guidanceBatch?.status === 'completed' && (
                                <span className={guidanceBatch.failed > 0 ? 'text-amber-400' : 'text-emerald-400'}>
                                    · Digest complete: {guidanceBatch.created} created, {guidanceBatch.updated} updated, {guidanceBatch.skippedCurrent} current, {guidanceBatch.failed} failed
                                </span>
                            )}
                            {guidanceBatch?.status === 'cancelled' && (
                                <span className="text-amber-300">· Digest cancelled · {guidanceBatch.remaining} remaining</span>
                            )}
                            {guidanceBatch?.status === 'stopped' && (
                                <span className="text-amber-300" title={guidanceBatch.stopReason || undefined}>
                                    · Digest stopped · {guidanceBatch.failed} failed, {guidanceBatch.remaining} remaining
                                </span>
                            )}
                        </div>
                    </div>
                    {!isBatchActive && guidanceBatch && guidanceBatch.errors.length > 0 && (
                        <details className="no-drag rounded-lg border border-amber-700/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
                            <summary className="cursor-pointer font-semibold">
                                View {guidanceBatch.errors.length} exact digest failure{guidanceBatch.errors.length === 1 ? '' : 's'}
                            </summary>
                            <ul className="mt-2 max-h-32 space-y-2 overflow-y-auto pl-4">
                                {guidanceBatch.errors.map(failure => (
                                    <li key={failure.filePath} className="list-disc break-words">
                                        <span className="font-medium">{failure.filePath.split(/[/\\]/).pop()}</span>: {failure.error}
                                    </li>
                                ))}
                            </ul>
                        </details>
                    )}
                </div>
                
                <div className="flex h-9 shrink-0 items-center gap-2 no-drag">
                   {articles.length > 0 && (
                        <>
                        <button
                          onClick={() => setShowAuthors(!showAuthors)}
                          className={cn(
                              "inline-flex h-9 items-center gap-2 px-3 border rounded-lg text-xs font-medium transition-all shadow-lg shadow-black/20",
                              showAuthors 
                                ? "bg-slate-700 border-slate-600 text-white" 
                                : "bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200"
                          )}
                          title="Toggle Author Column"
                        >
                          👤 {showAuthors ? 'Hide' : 'Show'} Authors
                        </button>

                        <button 
                          onClick={onExportBibtex}
                          className="inline-flex h-9 items-center gap-2 px-3 bg-purple-900/30 border border-purple-700/50 rounded-lg text-xs font-medium text-purple-300 hover:text-white hover:bg-purple-800/40 transition-all shadow-lg shadow-black/20"
                        >
                          📚 BibTeX
                        </button>
                        <button 
                          onClick={onExport}
                          className="inline-flex h-9 items-center gap-2 px-3 bg-slate-800 border border-slate-700 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-700 transition-all shadow-lg shadow-black/20"
                        >
                          📥 ZIP
                        </button>
                        </>
                    )}
                </div>
            </div>

            {/* Search Input */}
            <div className="relative no-drag">
                <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder="Filter by filename..."
                    className="w-full bg-slate-900/50 border border-slate-700/50 rounded-lg py-2 pl-9 pr-4 text-sm text-slate-300 placeholder-slate-500 focus:outline-none focus:border-blue-500/30 focus:bg-slate-900/80 transition-all"
                />
                <div className="absolute left-3 top-2.5 text-slate-600">
                    🔍
                </div>
                {searchTerm && (
                    <button 
                        onClick={() => onSearchChange('')}
                        className="absolute right-3 top-2.5 text-slate-600 hover:text-slate-400"
                    >
                        ✕
                    </button>
                )}
            </div>
        </div>
        
        {/* List Layout (Flexbox) */}
        <div className="flex-1 overflow-auto">
            {/* Header */}
            <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur-md shadow-sm flex text-xs text-slate-500 uppercase font-medium border-b border-slate-700/50">
                <div 
                    className="w-10 px-2 py-2.5 cursor-pointer hover:text-slate-300 transition-colors flex items-center justify-center flex-shrink-0"
                    onClick={() => handleSort('isKey')}
                >
                    ⭐ <SortIcon field="isKey" />
                </div>
                <div className="w-10 px-2 py-2.5 flex items-center justify-center flex-shrink-0" title="Read">
                    ✓
                </div>
                <div 
                    className="flex-1 px-4 py-2.5 cursor-pointer hover:text-slate-300 transition-colors flex items-center min-w-0"
                    onClick={() => handleSort('title')}
                >
                    <span className="truncate">Title</span> <SortIcon field="title" />
                </div>
                {showAuthors && (
                    <div 
                        className="w-48 px-4 py-2.5 cursor-pointer hover:text-slate-300 transition-colors flex items-center flex-shrink-0"
                        onClick={() => handleSort('authors')}
                    >
                        Author <SortIcon field="authors" />
                    </div>
                )}
                <div 
                    className="w-24 px-4 py-2.5 text-center cursor-pointer hover:text-slate-300 transition-colors flex items-center justify-center flex-shrink-0"
                    onClick={() => handleSort('year')}
                >
                    Year <SortIcon field="year" />
                </div>
                <div className="w-16 px-4 py-2.5 text-center flex-shrink-0">
                    Guide
                </div>
            </div>

            {/* List Items */}
            <div className="divide-y divide-slate-700/30">
                {sortedArticles.map(article => (
                    (() => {
                      const isGuideGenerating = guideGenerationInProgressPaths.includes(article.filePath);
                      const status = article.guidanceStatus ?? (article.hasGuidance ? 'stale' : 'missing');
                      const isGuideQueued = guidanceBatch?.status === 'running' && !article.hasGuidance && status !== 'current' && !isGuideGenerating;
                      const statusStyle = status === 'current'
                        ? 'text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300'
                        : status === 'stale'
                          ? 'text-amber-300 bg-amber-900/20 border border-amber-700/50 hover:bg-amber-800/30'
                          : status === 'failed'
                            ? 'text-red-300 bg-red-900/20 border border-red-700/50 hover:bg-red-800/30'
                            : 'text-slate-500 bg-slate-800/70 border border-slate-700 hover:bg-amber-900/20 hover:border-amber-700/50 hover:text-amber-300';
                      const statusLabel = status === 'current'
                        ? 'Open current digest'
                        : article.hasGuidance
                          ? status === 'failed'
                            ? 'Open previous digest — last refresh failed'
                            : 'Open existing digest — refresh it with Digest Folder'
                          : status === 'failed'
                            ? 'Last generation failed — retry'
                            : 'Generate digest';
                      const statusIcon = article.hasGuidance ? '📄' : status === 'failed' ? '!' : '✍';
                      return (
                    <div 
                        key={article.id}
                        onClick={() => onSelect(article.id)}
                        onDoubleClick={() => onOpenPdf && onOpenPdf(article.filename)}
                        className={cn(
                            "flex items-center cursor-pointer transition-all duration-200 hover:bg-slate-700/30 group",
                            selectedId === article.id 
                                ? "bg-gradient-to-r from-blue-600/20 to-purple-600/20 border-l-2 border-l-blue-500" 
                                : "border-l-2 border-l-transparent"
                        )}
                    >
                        <div className="w-10 px-2 flex-shrink-0 flex justify-center py-2">
                             <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onToggleKey && onToggleKey(article.id, !article.isKey);
                                }}
                                className={cn(
                                    "transition-all duration-200 transform active:scale-125",
                                    article.isKey ? "text-amber-400 scale-110" : "text-slate-700 hover:text-slate-500 opacity-30 hover:opacity-100"
                                )}
                             >
                                 {article.isKey ? '⭐' : '☆'}
                             </button>
                        </div>
                        <div className="w-10 px-2 flex-shrink-0 flex justify-center py-2">
                             <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onToggleRead && onToggleRead(article.id, !article.isRead);
                                }}
                                className={cn(
                                    "transition-all duration-200 transform active:scale-125",
                                    article.isRead ? "text-emerald-400" : "text-slate-700 hover:text-slate-500 opacity-30 hover:opacity-100"
                                )}
                                title={article.isRead ? "Mark as unread" : "Mark as read"}
                             >
                                 {article.isRead ? '☑' : '☐'}
                             </button>
                        </div>
                        <div className="flex-1 px-4 py-2 min-w-0">
                            <div 
                                className={cn(
                                    "font-medium truncate",
                                    selectedId === article.id ? "text-white" : "text-slate-300"
                                )} 
                                title={article.title || article.filename}
                            >
                                {article.title || article.filename}
                            </div>
                        </div>
                        {showAuthors && (
                            <div className="w-48 px-4 py-2 flex-shrink-0">
                                <div className="text-slate-500 truncate text-sm" title={article.authors || ''}>
                                    {article.authors || '—'}
                                </div>
                            </div>
                        )}
                        <div className="w-24 px-4 py-2 text-center flex-shrink-0">
                            <span className={cn(
                                "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
                                article.year 
                                    ? "bg-slate-700/50 text-slate-300" 
                                    : "text-slate-600"
                            )}>
                                {article.year || '—'}
                            </span>
                        </div>
                        <div className="w-16 px-4 py-2 text-center flex-shrink-0 flex justify-center">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onSelect(article.id);
                                    if (!article.hasGuidance && (isGuideGenerating || isGuideQueued)) return;
                                    onOpenGuidance && onOpenGuidance(article);
                                }}
                                className={cn(
                                    "p-1.5 rounded-md transition-colors",
                                    isGuideGenerating
                                        ? "text-amber-300 bg-amber-900/20 border border-amber-700/50"
                                        : isGuideQueued
                                        ? "text-slate-500 bg-slate-800/70 border border-slate-700 cursor-wait"
                                        :
                                    statusStyle
                                )}
                                title={isGuideGenerating
                                  ? article.hasGuidance ? "Refreshing digest — click to open the previous digest" : "Generating digest..."
                                  : (isGuideQueued ? "Queued for digest generation" : statusLabel)}
                            >
                                {isGuideGenerating ? (
                                  <span className="inline-block w-3.5 h-3.5 border-2 border-amber-300/80 border-t-transparent rounded-full animate-spin" />
                                ) : (isGuideQueued ? '…' : statusIcon)}
                            </button>
                        </div>
                    </div>
                      );
                    })()
                ))}
            </div>
            
            {articles.length === 0 && (
                <div className="flex flex-col items-center justify-center h-64 text-slate-500">
                    <div className="text-6xl mb-6">📂</div>
                    <p className="text-lg font-medium text-slate-300">Welcome to Scholarly</p>
                    <p className="text-sm mt-2 text-slate-500">Select a folder to start managing your research papers</p>
                    {onSelectFolder && (
                        <button
                            onClick={onSelectFolder}
                            className="mt-6 px-6 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl font-medium hover:from-blue-500 hover:to-purple-500 transition-all shadow-lg shadow-blue-500/20"
                        >
                            📁 Select Folder
                        </button>
                    )}
                </div>
            )}
        </div>
    </div>
  );
}
