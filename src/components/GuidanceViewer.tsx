import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

interface GuidanceViewerProps {
    content: string;
    onClose: () => void;
    title: string;
}

export function GuidanceViewer({ content, onClose, title }: GuidanceViewerProps) {
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
               <button 
                onClick={onClose} 
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-lg text-xs font-medium text-slate-400 hover:text-white transition-all border border-slate-700/50 cursor-pointer no-drag"
               >
                   ✕ Close
               </button>
           </div>
           
           <div className="flex-1 overflow-y-auto px-8 py-8 custom-scrollbar bg-slate-900 w-full">
                <div className="max-w-4xl mx-auto pb-16">
                    <article className="prose prose-invert prose-lg max-w-none 
                        prose-headings:text-slate-100 prose-headings:font-bold prose-headings:tracking-tight
                        
                        prose-h1:text-4xl prose-h1:mb-8 prose-h1:border-b prose-h1:border-slate-800 prose-h1:pb-4 prose-h1:mt-2
                        prose-h2:text-3xl prose-h2:mt-12 prose-h2:mb-6 prose-h2:text-white
                        prose-h3:text-2xl prose-h3:mt-10 prose-h3:mb-4 prose-h3:text-white prose-h3:border-l-4 prose-h3:border-blue-500 prose-h3:pl-4
                        prose-h4:text-xl prose-h4:mt-8 prose-h4:mb-3 prose-h4:text-slate-200 prose-h4:font-semibold
                        
                        prose-p:text-slate-300 prose-p:leading-relaxed prose-p:my-5 prose-p:text-base
                        
                        prose-a:text-blue-400 prose-a:no-underline prose-a:font-medium hover:prose-a:text-blue-300 hover:prose-a:underline
                        
                        prose-strong:text-white prose-strong:font-bold prose-strong:bg-white/10 prose-strong:px-1.5 prose-strong:rounded prose-strong:inline-block
                        
                        prose-code:text-emerald-300 prose-code:bg-slate-950 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:border prose-code:border-slate-800/50 prose-code:font-mono prose-code:text-sm prose-code:before:content-none prose-code:after:content-none
                        prose-pre:bg-slate-950 prose-pre:border prose-pre:border-slate-800 prose-pre:p-4 prose-pre:rounded-xl
                        
                        prose-blockquote:border-l-4 prose-blockquote:border-slate-600 prose-blockquote:bg-slate-800/30 prose-blockquote:py-2 prose-blockquote:px-6 prose-blockquote:my-6 prose-blockquote:italic prose-blockquote:text-slate-400 prose-blockquote:rounded-r-lg
                        
                        prose-ul:list-disc prose-ul:pl-6 prose-ul:marker:text-slate-500 prose-ul:my-4
                        prose-ol:list-decimal prose-ol:pl-6 prose-ol:marker:text-slate-500 prose-ol:my-4
                        prose-li:text-slate-300 prose-li:my-2 prose-li:pl-1
                        
                        prose-table:border-collapse prose-table:w-full prose-table:my-8 prose-table:rounded-lg prose-table:overflow-hidden prose-table:shadow-lg
                        prose-th:bg-slate-800 prose-th:text-slate-100 prose-th:p-4 prose-th:text-left prose-th:border-b prose-th:border-slate-700 prose-th:font-semibold
                        prose-td:p-4 prose-td:border-b prose-td:border-slate-800 prose-td:text-slate-300 prose-td:bg-slate-900/50
                        
                        prose-img:rounded-xl prose-img:shadow-2xl prose-img:border prose-img:border-slate-700/50 prose-img:my-8
                        prose-hr:border-slate-800 prose-hr:my-8
                    ">
                        <Markdown 
                            remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]} 
                            rehypePlugins={[rehypeKatex]}
                            components={{
                                a: ({node, href, ...props}: any) => (
                                    <a 
                                        href={href} 
                                        onClick={(e) => {
                                            e.preventDefault();
                                            window.ipcRenderer.invoke('open-external', href);
                                        }}
                                        className="hover:underline cursor-pointer" 
                                        {...props} 
                                    />
                                )
                            }}
                        >
                            {preprocessContent(content)}
                        </Markdown>
                    </article>
                    
                    <div className="mt-16 pt-8 border-t border-slate-800 text-center text-slate-600 text-xs">
                        End of guidance
                    </div>
                </div>
           </div>
        </div>
    );
}
