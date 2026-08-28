import { useState, useEffect } from 'react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type MarkdownTheme = 'lapis-dark' | 'lapis' | 'vercel' | 'newsprint';

interface AppSettings {
  ai: {
    chatModel: string;
    guideModel: string;
    guidePrompt: string;
    outputLanguage: 'ko' | 'en';
    promptVersion: string;
    hasOllamaApiKey: boolean;
  };
  ui: {
    markdownTheme: MarkdownTheme;
  };
}

type SaveSettingsResult =
  | { success: true; models: string[] }
  | { success: false; error: string };

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [models, setModels] = useState<string[]>([]);
  const [chatModel, setChatModel] = useState('');
  const [guideModel, setGuideModel] = useState('nemotron-3-nano:30b-cloud');
  const [guidePrompt, setGuidePrompt] = useState('');
  const [outputLanguage, setOutputLanguage] = useState<'ko' | 'en'>('ko');
  const [promptVersion, setPromptVersion] = useState('scholarly-digest-v1');
  const [ollamaApiKey, setOllamaApiKey] = useState('');
  const [hasOllamaApiKey, setHasOllamaApiKey] = useState(false);
  const [markdownTheme, setMarkdownTheme] = useState<MarkdownTheme>('lapis-dark');
  const [activeTab, setActiveTab] = useState<'general' | 'prompt'>('general');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setIsLoading(true);
      setOllamaApiKey('');
      setSaveError(null);
      Promise.all([
        window.ipcRenderer.invoke('list-models'),
        window.ipcRenderer.invoke('get-settings')
      ])
        .then(([list, settings]: [string[], AppSettings]) => {
          setModels(list || []);
          if (settings && settings.ai) {
             setChatModel(settings.ai.chatModel);
             setGuideModel(settings.ai.guideModel || 'nemotron-3-nano:30b-cloud');
             setGuidePrompt(settings.ai.guidePrompt || '');
             setOutputLanguage(settings.ai.outputLanguage === 'en' ? 'en' : 'ko');
             setPromptVersion(settings.ai.promptVersion || 'scholarly-digest-v1');
             setHasOllamaApiKey(settings.ai.hasOllamaApiKey);
          }
          if (settings && settings.ui) {
             setMarkdownTheme(settings.ui.markdownTheme);
          }
        })
        .finally(() => setIsLoading(false));
    }
  }, [isOpen]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const result = await window.ipcRenderer.invoke<SaveSettingsResult>('save-settings', {
        ai: { chatModel, guideModel, guidePrompt, outputLanguage, promptVersion, ollamaApiKey },
        ui: { markdownTheme }
      });
      if (!result.success) {
        setSaveError(result.error);
        return;
      }
      setModels(result.models);
      setHasOllamaApiKey(true);
      onClose();
    } catch (error) {
      setSaveError(String(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetPromptToDefault = async () => {
    try {
      const defaultPrompt = await window.ipcRenderer.invoke<string>('get-default-guide-prompt');
      setGuidePrompt(defaultPrompt || '');
    } catch (error) {
      console.error('Failed to load default guide prompt:', error);
    }
  };

  const modelOptions = Array.from(new Set([...models, chatModel, guideModel].filter(Boolean)));

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-[680px] bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden animate-in zoom-in-95 duration-200">
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

        <div className="px-6 pt-4">
          <div className="inline-flex rounded-xl border border-slate-700/50 bg-slate-800/40 p-1">
            <button
              onClick={() => setActiveTab('general')}
              className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${activeTab === 'general' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'}`}
            >
              General
            </button>
            <button
              onClick={() => setActiveTab('prompt')}
              className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${activeTab === 'prompt' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'}`}
            >
              Digest Guidance
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
          
          {isLoading && (
             <div className="text-center text-slate-500 py-4">Loading settings...</div>
          )}

          {!isLoading && activeTab === 'general' && (
            <>
              {/* Ollama Cloud Connection */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label htmlFor="ollama-api-key" className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Ollama Cloud
                  </label>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${hasOllamaApiKey ? 'text-green-400 bg-green-500/10 border-green-500/20' : 'text-amber-400 bg-amber-500/10 border-amber-500/20'}`}>
                    {hasOllamaApiKey ? 'Key saved' : 'Key required'}
                  </span>
                </div>
                <div className="space-y-2">
                  <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-xs font-mono text-slate-400">
                    https://ollama.com/v1
                  </div>
                  <input
                    id="ollama-api-key"
                    type="password"
                    value={ollamaApiKey}
                    onChange={(event) => setOllamaApiKey(event.target.value)}
                    autoComplete="off"
                    placeholder={hasOllamaApiKey ? 'Enter a new key to replace the saved key' : 'Enter your Ollama API key'}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500/60 transition-colors"
                  />
                  <p className="text-[11px] text-slate-500">
                    Stored with the operating system credential store and sent only to Ollama Cloud.
                  </p>
                </div>
              </div>

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
                        {modelOptions.length === 0 && <option value="">No models found</option>}
                        {modelOptions.map(model => (
                            <option key={`chat-${model}`} value={model}>{model}</option>
                        ))}
                    </select>
                    <p className="text-[11px] text-slate-500">
                        Used for answering questions about the paper in the chat interface.
                    </p>
                </div>
              </div>

              {/* Guide Model Config */}
              <div>
                 <div className="flex items-center justify-between mb-3">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Guide Generation Model
                    </label>
                    <span className="text-[10px] text-cyan-400 font-medium bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                        For Guide
                    </span>
                </div>

                <div className="space-y-2">
                    <select
                        value={guideModel}
                        onChange={(e) => setGuideModel(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-cyan-500/50 focus:bg-slate-800/80 transition-all appearance-none"
                    >
                        {modelOptions.length === 0 && <option value="">No models found</option>}
                        {modelOptions.map(model => (
                            <option key={`guide-${model}`} value={model}>{model}</option>
                        ))}
                    </select>
                    <p className="text-[11px] text-slate-500">
                        Used when generating GUIDE markdown files from PDF content.
                    </p>
                </div>
              </div>

              {/* Digest Contract Config */}
              <div>
                 <div className="flex items-center justify-between mb-3">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Digest Output Language
                    </label>
                    <span className="text-[10px] text-emerald-400 font-medium bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                      {promptVersion}
                    </span>
                 </div>
                 <select
                    value={outputLanguage}
                    onChange={(event) => setOutputLanguage(event.target.value as 'ko' | 'en')}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-all appearance-none"
                 >
                    <option value="ko">Korean body · English contract headers</option>
                    <option value="en">English body · English contract headers</option>
                 </select>
                 <p className="text-[11px] text-slate-500 mt-2">
                    Changing language marks existing digests stale; their files remain until replacement succeeds.
                 </p>
              </div>

              {/* Markdown Theme Config */}
              <div>
                 <div className="mb-3">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Markdown Theme
                    </label>
                </div>

                <div className="space-y-2">
                    <select
                        value={markdownTheme}
                        onChange={(e) => setMarkdownTheme(e.target.value as MarkdownTheme)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-purple-500/50 focus:bg-slate-800/80 transition-all appearance-none"
                    >
                        <option value="lapis-dark">Lapis Dark</option>
                        <option value="lapis">Lapis Light</option>
                        <option value="vercel">Vercel</option>
                        <option value="newsprint">Newsprint</option>
                    </select>
                    <p className="text-[11px] text-slate-500">
                        Theme for displaying guidance and analysis content.
                    </p>
                </div>
              </div>
            </>
          )}

          {!isLoading && activeTab === 'prompt' && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Optional Pedagogical Guidance
                </label>
                <button
                  onClick={handleResetPromptToDefault}
                  className="px-2.5 py-1 text-[10px] font-semibold rounded-md border border-slate-600 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                  title="Clear optional guidance and use only the application contract"
                >
                  Clear Guidance
                </button>
              </div>

              <textarea
                value={guidePrompt}
                onChange={(e) => setGuidePrompt(e.target.value)}
                spellCheck={false}
                className="w-full h-[420px] bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-100 font-mono leading-6 focus:outline-none focus:border-amber-500/50 focus:bg-slate-800/80 transition-all resize-y"
                placeholder="Optional tone or emphasis preferences. The structural and grounding contract is always enforced separately."
              />
              <p className="text-[11px] text-slate-500 mt-2">
                This may refine tone or emphasis but cannot override the non-editable {promptVersion} contract.
              </p>
            </div>
          )}

          {models.length === 0 && !isLoading && (
              <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-center">
                  <p className="text-amber-300 text-sm font-medium">Ollama Cloud models are unavailable.</p>
                  <p className="text-amber-300/70 text-xs mt-1">Enter a valid API key above, then save to connect.</p>
              </div>
          )}

          {saveError && (
            <div role="alert" className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-300">
              {saveError}
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
                disabled={isSaving}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-wait text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-blue-600/20"
            >
                {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
        </div>
      </div>
    </div>
  );
}
