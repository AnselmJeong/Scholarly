import { cn } from '@/lib/utils';

interface Article {
    id: number;
    title: string | null;
    filename: string;
    authors: string | null;
    year: number | null;
    addedDate: string | Date | null;
    journal?: string | null;
    doi?: string | null;
    hasGuidance?: boolean;
    isKey?: number | boolean;
    abstract?: string | null;
    filePath?: string;
}

interface ArticleListProps {
    articles: Article[];
    onSelect: (id: number) => void;
    onExport: () => void;
    onExportBibtex: () => void;
    selectedId: number | null;
    onOpenPdf?: (filename: string) => void;
    onOpenGuidance?: (article: any) => void;
    onToggleKey?: (articleId: number, isKey: boolean) => void;
    searchTerm: string;
    onSearchChange: (term: string) => void;
    onRescan?: () => void;
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
    onToggleKey,
    searchTerm,
    onSearchChange,
    onRescan 
}: ArticleListProps) {
  const [sortField, setSortField] = useState<'title' | 'authors' | 'year' | 'isKey'>('year');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [isRescanning, setIsRescanning] = useState(false);

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
            <div className="flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <h2 className="text-lg font-semibold text-slate-200">Articles</h2>
                        <button 
                            onClick={handleRescanClick}
                            disabled={isRescanning}
                            className={cn(
                                "flex items-center gap-2 px-3 py-1 ml-2 rounded-md transition-colors no-drag border border-transparent",
                                isRescanning 
                                    ? "bg-blue-500/20 text-blue-300 border-blue-500/30" 
                                    : "bg-slate-700/50 text-slate-300 hover:bg-blue-600/20 hover:text-blue-200 hover:border-blue-500/30"
                            )}
                            title="Rescan & Prune Orphans"
                        >
                           <span className={isRescanning ? "animate-spin" : ""}>🔄</span>
                           <span className="text-xs font-medium">Rescan</span>
                        </button>
                    </div>
                    <span className="text-xs text-slate-500">{articles.length} items</span>
                </div>
                
                {articles.length > 0 && (
                    <div className="flex gap-2 no-drag">
                        <button 
                          onClick={onExportBibtex}
                          className="inline-flex items-center gap-2 px-3 py-1.5 bg-purple-900/30 border border-purple-700/50 rounded-lg text-xs font-medium text-purple-300 hover:text-white hover:bg-purple-800/40 transition-all shadow-lg shadow-black/20"
                        >
                          📚 BibTeX
                        </button>
                        <button 
                          onClick={onExport}
                          className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-700 transition-all shadow-lg shadow-black/20"
                        >
                          📥 ZIP
                        </button>
                    </div>
                )}
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
                <div 
                    className="flex-1 px-4 py-2.5 cursor-pointer hover:text-slate-300 transition-colors flex items-center min-w-0"
                    onClick={() => handleSort('title')}
                >
                    <span className="truncate">Title</span> <SortIcon field="title" />
                </div>
                <div 
                    className="w-48 px-4 py-2.5 cursor-pointer hover:text-slate-300 transition-colors flex items-center flex-shrink-0"
                    onClick={() => handleSort('authors')}
                >
                    Author <SortIcon field="authors" />
                </div>
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
                        <div className="w-48 px-4 py-2 flex-shrink-0">
                            <div className="text-slate-500 truncate text-sm" title={article.authors || ''}>
                                {article.authors || '—'}
                            </div>
                        </div>
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
                            {article.hasGuidance && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onOpenGuidance && onOpenGuidance(article);
                                    }}
                                    className="p-1.5 rounded-md text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300 transition-colors"
                                    title="Open Guidance"
                                >
                                    📄
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
            
            {articles.length === 0 && (
                <div className="flex flex-col items-center justify-center h-64 text-slate-500">
                    <div className="text-5xl mb-4">📄</div>
                    <p className="text-lg font-medium">No articles yet</p>
                    <p className="text-sm mt-1">Select a folder to scan for PDFs</p>
                </div>
            )}
        </div>
    </div>
  );
}
