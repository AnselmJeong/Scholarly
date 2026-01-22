import { useState, useCallback, useRef, useEffect } from 'react';

interface ResizablePanelsProps {
  leftPanel: React.ReactNode;
  centerPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  initialLeftWidth?: number;
  initialRightWidth?: number;
  minLeftWidth?: number;
  minCenterWidth?: number;
  minRightWidth?: number;
}

export function ResizablePanels({
  leftPanel,
  centerPanel,
  rightPanel,
  initialLeftWidth = 280,
  initialRightWidth = 384,
  minLeftWidth = 200,
  minCenterWidth = 300,
  minRightWidth = 300,
}: ResizablePanelsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftWidth, setLeftWidth] = useState(initialLeftWidth);
  const [rightWidth, setRightWidth] = useState(initialRightWidth);
  const [isDraggingLeft, setIsDraggingLeft] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!containerRef.current) return;
    
    const containerRect = containerRef.current.getBoundingClientRect();
    const containerWidth = containerRect.width;
    
    if (isDraggingLeft) {
      const newLeftWidth = e.clientX - containerRect.left;
      const maxLeftWidth = containerWidth - rightWidth - minCenterWidth;
      setLeftWidth(Math.max(minLeftWidth, Math.min(newLeftWidth, maxLeftWidth)));
    }
    
    if (isDraggingRight) {
      const newRightWidth = containerRect.right - e.clientX;
      const maxRightWidth = containerWidth - leftWidth - minCenterWidth;
      setRightWidth(Math.max(minRightWidth, Math.min(newRightWidth, maxRightWidth)));
    }
  }, [isDraggingLeft, isDraggingRight, leftWidth, rightWidth, minLeftWidth, minRightWidth, minCenterWidth]);

  const handleMouseUp = useCallback(() => {
    setIsDraggingLeft(false);
    setIsDraggingRight(false);
  }, []);

  useEffect(() => {
    if (isDraggingLeft || isDraggingRight) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDraggingLeft, isDraggingRight, handleMouseMove, handleMouseUp]);

  return (
    <div ref={containerRef} className="flex h-full w-full overflow-hidden">
      {/* Left Panel */}
      <div style={{ width: leftWidth, flexShrink: 0 }} className="h-full overflow-hidden">
        {leftPanel}
      </div>
      
      {/* Left Divider */}
      <div
        className="w-1 h-full bg-slate-700/50 hover:bg-blue-500/50 cursor-col-resize transition-colors flex-shrink-0 relative group"
        onMouseDown={() => setIsDraggingLeft(true)}
      >
        <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-blue-500/20" />
      </div>
      
      {/* Center Panel */}
      <div className="flex-1 h-full overflow-hidden min-w-0">
        {centerPanel}
      </div>
      
      {/* Right Divider */}
      <div
        className="w-1 h-full bg-slate-700/50 hover:bg-blue-500/50 cursor-col-resize transition-colors flex-shrink-0 relative group"
        onMouseDown={() => setIsDraggingRight(true)}
      >
        <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-blue-500/20" />
      </div>
      
      {/* Right Panel */}
      <div style={{ width: rightWidth, flexShrink: 0 }} className="h-full overflow-hidden">
        {rightPanel}
      </div>
    </div>
  );
}
