import { useState, useEffect } from 'react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface AppSettings {
  ai: {
    chatModel: string;
  };
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [models, setModels] = useState<string[]>([]);
  const [chatModel, setChatModel] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsLoading(true);
      Promise.all([
        window.ipcRenderer.invoke('list-models'),
        window.ipcRenderer.invoke('get-settings')
      ])
        .then(([list, settings]: [string[], AppSettings]) => {
          setModels(list || []);
          if (settings && settings.ai) {
             setChatModel(settings.ai.chatModel);
          }
        })
        .finally(() => setIsLoading(false));
    }
  }, [isOpen]);

  const handleSave = async () => {
    await window.ipcRenderer.invoke('save-settings', { 
      ai: { chatModel } 
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-[520px] bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden animate-in zoom-in-95 duration-200">
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
        <div className="p-6 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
          
          {isLoading && (
             <div className="text-center text-slate-500 py-4">Loading settings...</div>
          )}

          {!isLoading && (
            <>


              {/* Chat Model Config */}
              <div>
                 <div className="flex items-center justify-between mb-3">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Chat & Q&A Model
                    </label>
                    <span className="text-[10px] text-green-400 font-medium bg-green-500/10 px-2 py-0.5 rounded border border-green-500/20">
                        For Chatting
                    </span>
                </div>

                <div className="space-y-2">
                    <select
                        value={chatModel}
                        onChange={(e) => setChatModel(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-green-500/50 focus:bg-slate-800/80 transition-all appearance-none"
                    >
                        {models.length === 0 && <option value="">No models found</option>}
                        {models.map(model => (
                            <option key={`chat-${model}`} value={model}>{model}</option>
                        ))}
                    </select>
                    <p className="text-[11px] text-slate-500">
                        Used for answering questions about the paper in the chat interface.
                    </p>
                </div>
              </div>
            </>
          )}

          {models.length === 0 && !isLoading && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-center">
                  <p className="text-red-400 text-sm font-medium">Ollama is not running or no models found.</p>
                  <p className="text-red-400/70 text-xs mt-1">Please start Ollama and restart the app.</p>
              </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-800/30 border-t border-slate-700/50 flex justify-end gap-3">
            <button
                onClick={onClose}
                className="px-4 py-2 text-slate-400 hover:text-white text-sm font-medium transition-colors"
            >
                Cancel
            </button>
            <button
                onClick={handleSave}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-blue-600/20"
            >
                Save Changes
            </button>
        </div>
      </div>
    </div>
  );
}
