import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import '../styles/themes/lapis-dark.css';
import '../styles/themes/lapis.css';
import '../styles/themes/vercel.css';
import '../styles/themes/newsprint.css';

type MarkdownTheme = 'lapis-dark' | 'lapis' | 'vercel' | 'newsprint';

interface GuidanceViewerProps {
    content: string;
    onClose: () => void;
    title: string;
    theme?: MarkdownTheme;
    status?: string;
    isGenerating?: boolean;
    onCancel?: () => void;
    onRewrite?: () => void;
}

const THEME_BACKGROUNDS: Record<MarkdownTheme, string> = {
    'lapis-dark': 'bg-[#1e222a]',
    'lapis': 'bg-white',
    'vercel': 'bg-white',
    'newsprint': 'bg-[#f3f2ee]'
};

export function GuidanceViewer({ content, onClose, title, theme = 'lapis-dark', status, isGenerating, onCancel, onRewrite }: GuidanceViewerProps) {
    // Normalize LaTeX delimiters for remark-math
    const preprocessContent = (text: string) => {
        return text
            // Replace \[ ... \] with $$ ... $$
            .replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$')
            // Replace \( ... \) with $ ... $
            .replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$')
            ;
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-slate-900 border-l border-slate-700/50">
           {/* Header */}
           <div className="flex items-center justify-between p-4 border-b border-slate-700/50 bg-slate-800/50 backdrop-blur-sm sticky top-0 z-10 w-full drag-region">
               <h2 className="text-sm font-semibold text-slate-200 truncate pr-4 flex items-center gap-2">
                   <span className="text-lg">📄</span> 
                   {title}
               </h2>
               <div className="flex gap-2 shrink-0 no-drag">
               {onRewrite && <button onClick={onRewrite} disabled={isGenerating} title="새 노트가 완성되면 교체하고 이전 버전을 보관합니다" className="px-3 py-1.5 rounded-lg text-xs border border-slate-600 text-slate-200 disabled:opacity-40">다시 작성</button>}
               <button 
                onClick={onClose} 
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-lg text-xs font-medium text-slate-400 hover:text-white transition-all border border-slate-700/50 cursor-pointer no-drag"
               >
                   ✕ Close
               </button>
               </div>
           </div>
           
           {status && <div role="status" className="px-4 py-2 text-xs text-slate-300 flex items-center justify-between border-b border-slate-700">
             <span>{status}</span>{isGenerating && <button onClick={onCancel} className="px-3 py-1 rounded bg-slate-700">작성 취소</button>}
           </div>}
           <div className={`flex-1 overflow-y-auto px-8 py-8 custom-scrollbar w-full ${THEME_BACKGROUNDS[theme]}`}>
                <div className="max-w-4xl mx-auto pb-16">
                    <article className={`theme-${theme}`}>
                        <Markdown
                            remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
                            rehypePlugins={[rehypeKatex]}
                            components={{
                                a: ({node: _node, href, ...props}: any) => (
                                    <a
                                        href={href}
                                        onClick={(e) => {
                                            e.preventDefault();
                                            window.ipcRenderer.invoke('open-external', href);
                                        }}
                                        {...props}
                                    />
                                )
                            }}
                        >
                            {preprocessContent(content)}
                        </Markdown>
                    </article>
                    
                    <div className="mt-16 pt-8 border-t border-slate-800 text-center text-slate-600 text-xs">
                        {isGenerating ? '작성 중…' : '학습 노트 끝'}
                    </div>
                </div>
           </div>
        </div>
    );
}
