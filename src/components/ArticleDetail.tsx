import { useState, useRef } from 'react';
import { cn } from '@/lib/utils';

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
    isKey?: number | boolean;
}

interface ArticleDetailProps {
    article: Article | null;
    keywords: string[];
    allKeywordsAvailable: string[];
    onProcess: () => void;
    onAddKeyword: (keyword: string) => void;
    onRemoveKeyword: (keyword: string) => void;
    onOpenPdf: () => void;
    onDelete: () => void;
    onToggleKey?: (articleId: number, isKey: boolean) => void;
    isProcessing: boolean;
}

export function ArticleDetail({ 
    article, 
    keywords, 
    allKeywordsAvailable,
    onProcess, 
    onAddKeyword,
    onRemoveKeyword,
    onOpenPdf,
    onDelete,
    onToggleKey,
    isProcessing 
}: ArticleDetailProps) {
  const [newKeyword, setNewKeyword] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  if (!article) {
      return (
        <div className="w-full border-l border-slate-700/50 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center h-full">
            <div className="text-center text-slate-600">
                <div className="text-5xl mb-4">📑</div>
                <p className="text-sm">Select an article to view details</p>
            </div>
        </div>
      );
  }

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (newKeyword.trim()) {
        onAddKeyword(newKeyword.trim());
        setNewKeyword('');
    }
  };

  return (
    <div className="w-full border-l border-slate-700/50 bg-slate-900/30 backdrop-blur-sm flex flex-col h-full">
        {/* Header Actions */}
        <div className="p-4 border-b border-slate-700/50 flex justify-between items-center bg-slate-900/50 drag-region">
            <div className="flex gap-2 no-drag">
                <button 
                    onClick={() => onToggleKey && onToggleKey(article.id, !article.isKey)}
                    className={cn(
                        "p-2 rounded-lg transition-all border border-transparent hover:border-amber-500/20",
                        article.isKey ? "bg-amber-500/10 text-amber-400" : "hover:bg-slate-700/50 text-slate-400"
                    )}
                    title={article.isKey ? "Unmark as Key Article" : "Mark as Key Article"}
                >
                    {article.isKey ? '⭐' : '☆'}
                </button>
                <button 
                    onClick={onOpenPdf}
                    className="p-2 hover:bg-blue-500/10 rounded-lg text-slate-400 hover:text-blue-400 transition-all border border-transparent hover:border-blue-500/20"
                    title="Open PDF"
                >
                    📖
                </button>
            </div>
            <button 
                onClick={onDelete}
                className="p-2 hover:bg-red-500/10 rounded-lg text-slate-500 hover:text-red-400 transition-all border border-transparent hover:border-red-500/20 no-drag"
                title="Delete Article"
            >
                🗑️
            </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">
            {/* Title */}
            <h2 className="text-xl font-bold text-white mb-3 leading-tight">
                {article.title || article.filename}
            </h2>
            
            {/* Meta: Authors, Year, Journal */}
            <div className="flex flex-col gap-2 mb-6">
                <div className="text-sm text-slate-300 font-medium">
                    {article.authors || 'Unknown Author'}
                </div>
                
                <div className="flex items-center gap-2 text-xs text-slate-400">
                    {article.year && (
                        <span className="px-2 py-0.5 rounded-full bg-slate-700/50 text-slate-300">
                            {article.year}
                        </span>
                    )}
                    {article.journal && (
                        <>
                            <span className="text-slate-600">•</span>
                            <span className="italic">
                                {article.journal}
                            </span>
                        </>
                    )}
                    {article.doi && (
                        <>
                            <span className="text-slate-600">•</span>
                            <span className="font-mono text-slate-500 hover:text-blue-400 cursor-pointer" onClick={() => {
                                // We could add a handler here later or just let it be text for now
                            }}>
                                {article.doi}
                            </span>
                        </>
                    )}
                </div>
            </div>

            {/* Abstract */}
            {article.abstract && (
                <div className="mb-8">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                        Abstract
                    </h3>
                    <p className="text-[13px] text-slate-400 leading-relaxed text-left">
                        {article.abstract}
                    </p>
                </div>
            )}

            {/* Keywords Section */}
            <div className="mb-8">
                <div className="flex justify-between items-center mb-3">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Keywords
                    </h3>
                    <button 
                        onClick={onProcess}
                        disabled={isProcessing}
                        className={cn(
                            "text-[10px] font-bold px-2 py-1 rounded transition-all flex items-center gap-1",
                            isProcessing 
                                ? "text-slate-600 bg-slate-800/50" 
                                : "text-blue-400 hover:text-blue-300 bg-blue-500/5 hover:bg-blue-500/10"
                        )}
                    >
                        {isProcessing ? "SCANNING..." : "✨ AI RE-SCAN"}
                    </button>
                </div>
                
                {/* Manual Add */}
                <form onSubmit={handleAdd} className="mb-4">
                    <div className="relative group">
                        <input 
                            ref={inputRef}
                            type="text"
                            list="existing-keywords"
                            value={newKeyword}
                            onChange={(e) => setNewKeyword(e.target.value)}
                            placeholder="Add manually..."
                            className="w-full bg-slate-800/30 border border-slate-700/30 rounded-lg py-2 pl-3 pr-8 text-xs text-slate-300 focus:outline-none focus:border-blue-500/30 focus:bg-slate-800/50 transition-all"
                        />
                        <button 
                            type="submit"
                            className="absolute right-2 top-1.5 text-slate-500 hover:text-blue-400 transition-colors"
                        >
                            ↵
                        </button>
                    </div>
                    <datalist id="existing-keywords">
                        {allKeywordsAvailable.map(k => (
                            <option key={k} value={k} />
                        ))}
                    </datalist>
                </form>

                {/* Keyword Pills */}
                <div className="flex flex-wrap gap-1.5">
                    {keywords.map((k, i) => (
                        <div 
                            key={i} 
                            className="group flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800/50 text-slate-300 border border-slate-700/50 hover:border-slate-600 transition-all hover:bg-slate-700/30"
                        >
                            <span>{k}</span>
                            <button 
                                onClick={() => onRemoveKeyword(k)}
                                className="text-slate-500 hover:text-red-400 transition-colors ml-0.5 opacity-0 group-hover:opacity-100"
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                    {keywords.length === 0 && !isProcessing && (
                        <div className="text-xs text-slate-600 italic py-2">
                            No keywords. Click AI RE-SCAN or add manually.
                        </div>
                    )}
                </div>
            </div>
        </div>
    </div>
  );
}
