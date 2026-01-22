// cleaned up unused import

interface ScanProgressProps {
  current: number;
  total: number;
  currentFile: string;
  isVisible: boolean;
}

export function ScanProgress({ current, total, currentFile, isVisible }: ScanProgressProps) {
  if (!isVisible) return null;

  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-md animate-in fade-in duration-300">
      <div className="w-[500px] bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden p-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <span className="text-xl">📁</span>
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Scanning Folder</h2>
            <p className="text-xs text-slate-400">Indexing PDF files...</p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mb-4">
          <div className="flex justify-between text-xs text-slate-400 mb-2">
            <span>Progress</span>
            <span>{current} / {total} files</span>
          </div>
          <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300 ease-out"
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>

        {/* Percentage */}
        <div className="text-center mb-4">
          <span className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            {percentage}%
          </span>
        </div>

        {/* Current File */}
        <div className="bg-slate-800/50 rounded-xl p-3 border border-slate-700/30">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Processing</p>
          <p className="text-sm text-slate-300 truncate font-mono" title={currentFile}>
            {currentFile || 'Preparing...'}
          </p>
        </div>
      </div>
    </div>
  );
}
