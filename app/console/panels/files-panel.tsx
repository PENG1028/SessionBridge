'use client';

import { Folder, Upload, ChevronDown } from 'lucide-react';
import { useRef, useCallback } from 'react';
import { FileExplorer } from '../sidebar/file-explorer';
import { usePanelCollapse } from '../sidebar/panel-dnd-wrapper';

interface FilesPanelProps {
  fileTree?: Record<string, { items: any[]; loaded: boolean }>;
  expandedDirs?: Set<string>;
  onToggleDir?: (dirPath: string) => void;
  onOpenFile?: (filePath: string) => void;
  onSendFile?: (filePath: string) => void;
}

export function FilesPanel(props: FilesPanelProps) {
  const { fileTree, expandedDirs, onToggleDir, onOpenFile, onSendFile } = props;
  const { collapsed, onToggle } = usePanelCollapse();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const data = (reader.result as string).split(',')[1] || '';
      try {
        await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: file.name, data, encoding: 'base64' }),
        });
      } catch {}
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, []);

  return (
    <>
      {/* Compact header: h-8, title + actions + collapse in one row */}
      <div className="flex items-center h-8 px-2 border-b border-gray-800 gap-1.5 bg-[#0d0d0d]">
        <Folder className="w-3 h-3 text-gray-500 shrink-0" />
        <span className="text-[10px] font-bold text-gray-500 tracking-wider">FILES</span>
        <div className="flex-1" />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="text-gray-600 hover:text-gray-300 transition-colors p-0.5"
          title="Upload file to workspace"
        >
          <Upload className="w-3 h-3" />
        </button>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
        <button
          onClick={onToggle}
          className="text-gray-600 hover:text-gray-300 transition-colors p-0.5"
          title="Collapse panel"
        >
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5 text-xs min-h-0">
        {!fileTree?.['.']?.loaded ? (
          <div className="text-gray-600 text-[10px] p-3 italic">Loading files...</div>
        ) : (
          <FileExplorer
            entries={fileTree['.']?.items || []}
            path="."
            depth={0}
            fileTree={fileTree || {}}
            expandedDirs={expandedDirs || new Set()}
            onToggleDir={onToggleDir || (() => {})}
            onOpenFile={onOpenFile || (() => {})}
            onSendFile={onSendFile || (() => {})}
          />
        )}
      </div>
    </>
  );
}
