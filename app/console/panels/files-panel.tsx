'use client';

import { useRef, useCallback } from 'react';
import { Upload } from 'lucide-react';
import { FileExplorer } from '../sidebar/file-explorer';
import { useCore } from '../core/core-client-provider';

interface FilesPanelProps {
  fileTree?: Record<string, { items: any[]; loaded: boolean; error?: string }>;
  expandedDirs?: Set<string>;
  onToggleDir?: (dirPath: string) => void;
  onOpenFile?: (filePath: string) => void;
  onSendFile?: (filePath: string) => void;
  onBookmarkDir?: (filePath: string) => void;
}

export function FilesPanel(props: FilesPanelProps) {
  const { fileTree, expandedDirs, onToggleDir, onOpenFile, onSendFile, onBookmarkDir } = props;
  const core = useCore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const content = reader.result as string;
      // Prefer CoreClient fs.write when connected
      if (core?.isConnected) {
        const data = content.startsWith('data:') ? atob(content.split(',')[1] || '') : content;
        core.call('fs.write', { path: file.name, data }).catch(() => {});
      } else {
        const b64 = content.split(',')[1] || '';
        try {
          await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: file.name, data: b64, encoding: 'base64' }),
          });
        } catch {}
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, [core]);

  return (
    <>
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
      <div className="flex-1 flex flex-col min-h-0">
        <div className="shrink-0 flex items-center justify-end px-1 pt-1">
          <button onClick={() => fileInputRef.current?.click()} title="Upload file to workspace" className="text-gray-600 hover:text-gray-300">
            <Upload className="w-3 h-3" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-1.5 pb-1.5 text-xs min-h-0">
        {!fileTree?.['.']?.loaded ? (
          <div className="text-gray-600 text-[10px] p-3 italic">Loading files...</div>
        ) : fileTree?.['.']?.error ? (
          <div className="text-gray-700 text-[9px] p-3 italic leading-relaxed">
            Could not load file tree.<br />
            <span className="text-gray-600">{fileTree['.'].error}</span>
          </div>
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
            onBookmarkDir={onBookmarkDir}
          />
        )}
        </div>
      </div>
    </>
  );
}
