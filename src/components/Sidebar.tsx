import { cn } from '@/lib/utils';
import { useState } from 'react';

interface SidebarProps {
  className?: string;
  keywords: { id: number, keyword: string, count: number }[];
  onSelectKeyword: (keywordId: number) => void;
  selectedKeywordIds: number[];
  onSelectRootFolder?: () => void;
  onOpenSettings?: () => void;
  rootPath?: string | null;
}

export function Sidebar({ className, keywords, onSelectKeyword, selectedKeywordIds, onSelectRootFolder, onOpenSettings, rootPath }: SidebarProps) {
  const [filterText, setFilterText] = useState('');

  const filteredKeywords = keywords.filter(k => 
    k.keyword.toLowerCase().includes(filterText.toLowerCase())
  );

  return (
    <div className={cn("w-full bg-slate-900/50 backdrop-blur-xl border-r border-slate-700/50 h-full flex flex-col", className)}>
      {/* Header */}
      <div className="p-5 border-b border-slate-700/50 drag-region">
        <div className="flex justify-between items-center">
          <h1 className="font-bold text-xl bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            Scholarly
          </h1>
          <div className="flex items-center gap-1 no-drag">
            {onOpenSettings && (
              <button 
                onClick={onOpenSettings} 
                className="p-2 hover:bg-slate-700/50 rounded-lg transition-colors text-slate-400 hover:text-slate-200"
                title="Settings"
              >
                ⚙️
              </button>
            )}
            {onSelectRootFolder && (
              <button 
                onClick={onSelectRootFolder} 
                className="p-2 hover:bg-slate-700/50 rounded-lg transition-colors text-slate-400 hover:text-blue-400"
                title="Select Folder"
              >
                📂
              </button>
            )}
          </div>
        </div>
        {rootPath && (
          <p className="text-xs text-slate-500 mt-2 truncate no-drag" title={rootPath}>
            📁 {rootPath.split('/').pop()}
          </p>
        )}
      </div>
      
      <div className="flex-1 overflow-y-auto p-4">
        <div>
          <div className="flex flex-col gap-3 mb-3 px-2">
            <div className="flex justify-between items-center">
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Keywords ({filteredKeywords.length})
              </h2>
              {(selectedKeywordIds.length > 0 || filterText !== '') && (
                <button 
                  onClick={() => {
                      onSelectKeyword(-1);
                      setFilterText('');
                  }}
                  className="text-[10px] text-blue-400 hover:text-blue-300 font-bold tracking-tight"
                >
                  RESET
                </button>
              )}
            </div>
            {/* Search Input */}
            <input
              type="text"
              placeholder="Filter keywords..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="w-full bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all placeholder:text-slate-600"
            />
          </div>
          <div className="space-y-1">
            {filteredKeywords.map(k => (
              <button 
                key={k.id} 
                onClick={() => onSelectKeyword(k.id)}
                className={cn(
                  "w-full text-left px-3 py-1.5 rounded-lg text-sm flex items-center justify-between group transition-all duration-200",
                  selectedKeywordIds.includes(k.id) 
                    ? "bg-gradient-to-r from-blue-600/30 to-purple-600/30 text-white border border-blue-500/30" 
                    : "hover:bg-slate-800/50 text-slate-400 hover:text-slate-200"
                )}
              >
                <span className="flex items-center gap-3">
                  <span className="text-blue-400">🏷️</span>
                  <span className="truncate">{k.keyword}</span>
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700/50 text-slate-400">
                  {k.count}
                </span>
              </button>
            ))}
            {filteredKeywords.length === 0 && (
                <div className="text-xs text-slate-600 text-center py-4 italic">
                    {keywords.length === 0 ? "No keywords yet" : "No matching keywords"}
                </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
