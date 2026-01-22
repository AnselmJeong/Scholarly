import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentModel: string;
  onModelChange: (model: string) => void;
}

export function SettingsModal({ isOpen, onClose, currentModel, onModelChange }: SettingsModalProps) {
  const [models, setModels] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsLoading(true);
      window.ipcRenderer.invoke('list-models')
        .then((list) => {
          setModels(list || []);
        })
        .finally(() => setIsLoading(false));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-[480px] bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-700/50 flex justify-between items-center bg-slate-900/50">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="text-xl">⚙️</span> Settings
          </h2>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="mb-6">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
              AI Model (Ollama)
            </label>
            
            {isLoading ? (
              <div className="py-4 text-center text-slate-500 text-sm">
                Loading models from Ollama...
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                {models.map((model) => (
                  <button
                    key={model}
                    onClick={() => onModelChange(model)}
                    className={cn(
                      "w-full text-left px-4 py-3 rounded-xl text-sm flex items-center justify-between border transition-all duration-200",
                      currentModel === model
                        ? "bg-blue-600/20 border-blue-500/50 text-blue-100"
                        : "bg-slate-800/50 border-transparent text-slate-400 hover:border-slate-600 hover:bg-slate-800"
                    )}
                  >
                    <span className="font-medium">{model}</span>
                    {currentModel === model && (
                      <span className="text-blue-400 text-xs font-bold">ACTIVE</span>
                    )}
                  </button>
                ))}
                {models.length === 0 && (
                  <div className="py-4 text-center text-red-400 bg-red-500/10 rounded-xl border border-red-500/20 text-xs">
                    No models found. Make sure Ollama is running.
                  </div>
                )}
              </div>
            )}
            <p className="mt-3 text-[11px] text-slate-500 leading-relaxed">
              * The application uses the selected model for automatic keyword extraction from PDFs.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-800/30 border-t border-slate-700/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-blue-600/20"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
