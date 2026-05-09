'use client';

import { useRef, useCallback, useEffect } from 'react';
import { FileExplorer } from '../sidebar/file-explorer';
import { onPanelAction } from '../sidebar/panel-action-events';

interface FilesPanelProps {
  fileTree?: Record<string, { items: any[]; loaded: boolean }>;
  expandedDirs?: Set<string>;
  onToggleDir?: (dirPath: string) => void;
  onOpenFile?: (filePath: string) => void;
  onSendFile?: (filePath: string) => void;
}

export function FilesPanel(props: FilesPanelProps) {
  const { fileTree, expandedDirs, onToggleDir, onOpenFile, onSendFile } = props;
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

  // Listen for upload action from header button
  useEffect(() => onPanelAction('files-upload', () => {
    fileInputRef.current?.click();
  }), []);

  return (
    <>
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
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
