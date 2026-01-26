import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface TreeNode {
    name: string;
    path: string;
    children: TreeNode[];
    pdfCount: number;
}

interface DirectoryTreeProps {
    onSelectFolder: (path: string | null) => void;
    selectedPath: string | null;
    rootPath: string | null;
}

function TreeItem({ 
    node, 
    level, 
    selectedPath, 
    onSelectFolder 
}: { 
    node: TreeNode; 
    level: number; 
    selectedPath: string | null;
    onSelectFolder: (path: string | null) => void;
}) {
    const [isExpanded, setIsExpanded] = useState(level < 2);
    const hasChildren = node.children.length > 0;
    const isSelected = selectedPath === node.path;

    return (
        <div>
            <button
                onClick={() => {
                    if (isSelected) {
                        onSelectFolder(null); // Deselect
                    } else {
                        onSelectFolder(node.path);
                    }
                }}
                className={cn(
                    "w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-sm transition-colors rounded-md",
                    "hover:bg-slate-700/50",
                    isSelected 
                        ? "bg-blue-600/20 text-blue-300 border-l-2 border-blue-500" 
                        : "text-slate-400"
                )}
                style={{ paddingLeft: `${level * 12 + 8}px` }}
            >
                {hasChildren && (
                    <span 
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsExpanded(!isExpanded);
                        }}
                        className="w-4 text-slate-600 hover:text-slate-400 cursor-pointer"
                    >
                        {isExpanded ? '▼' : '▶'}
                    </span>
                )}
                {!hasChildren && <span className="w-4" />}
                <span className="text-slate-500">📁</span>
                <span className="truncate flex-1">{node.name}</span>
                {node.pdfCount > 0 && (
                    <span className="text-xs text-slate-600 bg-slate-800 px-1.5 py-0.5 rounded-full">
                        {node.pdfCount}
                    </span>
                )}
            </button>
            {isExpanded && hasChildren && (
                <div>
                    {node.children.map((child) => (
                        <TreeItem
                            key={child.path}
                            node={child}
                            level={level + 1}
                            selectedPath={selectedPath}
                            onSelectFolder={onSelectFolder}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export function DirectoryTree({ onSelectFolder, selectedPath, rootPath }: DirectoryTreeProps) {
    const [tree, setTree] = useState<TreeNode[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const fetchTree = async () => {
        if (!rootPath) return;
        setIsLoading(true);
        try {
            const result = await window.ipcRenderer.invoke('get-directory-tree', rootPath);
            if (result.success) {
                setTree(result.tree);
            }
        } catch (e) {
            console.error('Failed to fetch directory tree:', e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchTree();
        
        // Listen for data updates
        const handleUpdate = () => fetchTree();
        window.ipcRenderer.on('data-updated', handleUpdate);
        return () => {
            window.ipcRenderer.off('data-updated', handleUpdate);
        };
    }, [rootPath]);

    const handleClearFilter = () => {
        onSelectFolder(null);
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
                <span className="animate-pulse">Loading folders...</span>
            </div>
        );
    }

    if (!rootPath) {
        return (
            <div className="flex flex-col items-center justify-center h-32 text-slate-500 text-sm text-center px-4">
                <span className="text-2xl mb-2">📂</span>
                <span>Select a root folder first</span>
            </div>
        );
    }

    if (tree.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-32 text-slate-500 text-sm text-center px-4">
                <span className="text-2xl mb-2">📁</span>
                <span>No subfolders found</span>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            {/* Header with clear filter */}
            {selectedPath && (
                <div className="px-3 py-2 bg-blue-600/10 border-b border-slate-700/50 flex items-center justify-between">
                    <span className="text-xs text-blue-400 truncate flex-1">
                        📂 {selectedPath.split('/').pop()}
                    </span>
                    <button
                        onClick={handleClearFilter}
                        className="text-xs text-slate-500 hover:text-slate-300 px-2"
                    >
                        ✕ Clear
                    </button>
                </div>
            )}

            {/* Tree */}
            <div className="flex-1 overflow-y-auto py-2">
                {tree.map((node) => (
                    <TreeItem
                        key={node.path}
                        node={node}
                        level={0}
                        selectedPath={selectedPath}
                        onSelectFolder={onSelectFolder}
                    />
                ))}
            </div>
        </div>
    );
}
