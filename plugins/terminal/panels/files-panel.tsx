'use client';

import { useRef, useCallback, useState } from 'react';
import { Upload } from 'lucide-react';
import { FileExplorer, useCore } from '../../../sdk';

interface FilesPanelProps {
  fileTree?: Record<string, { items: any[]; loaded: boolean; error?: string }>;
  expandedDirs?: Set<string>;
  onToggleDir?: (dirPath: string) => void;
  onOpenFile?: (filePath: string) => void;
  onSendFile?: (filePath: string) => void;
  onBookmarkDir?: (filePath: string) => void;
  /** Absolute working directory path from Go Core. */
  absoluteCwd?: string;
}

export function FilesPanel(props: FilesPanelProps) {
  const { fileTree, expandedDirs, onToggleDir, onOpenFile, onSendFile, onBookmarkDir, absoluteCwd } = props;
  const core = useCore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    const reader = new FileReader();
    reader.onload = async () => {
      const content = reader.result as string;
      if (!core?.isConnected) {
        setUploadError('Core is not connected; upload unavailable.');
        return;
      }
      const data = content.startsWith('data:') ? atob(content.split(',')[1] || '') : content;
      try {
        await core.call('fs.write', { path: file.name, data });
      } catch (err: any) {
        setUploadError(`Upload failed: ${err?.message || err}`);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, [core]);

  return (
    <>
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
      <div className="flex-1 flex flex-col min-h-0">
        <div className="shrink-0 flex items-center justify-end gap-2 px-1 pt-1">
          {uploadError && <span className="text-[9px] text-red-400 truncate max-w-[160px]" title={uploadError}>{uploadError}</span>}
          <button onClick={() => fileInputRef.current?.click()} title="Upload file to workspace" className="text-gray-600 hover:text-gray-300">
            <Upload className="w-3 h-3" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-1.5 pb-1.5 text-xs min-h-0">
        {!fileTree?.[absoluteCwd || '.']?.loaded ? (
          <div className="text-gray-600 text-[10px] p-3 italic">Loading files...</div>
        ) : fileTree?.[absoluteCwd || '.']?.error ? (
          <div className="text-gray-700 text-[9px] p-3 italic leading-relaxed">
            Could not load file tree.<br />
            <span className="text-gray-600">{fileTree[absoluteCwd || '.'].error}</span>
          </div>
        ) : (
          <FileExplorer
            entries={fileTree[absoluteCwd || '.']?.items || []}
            path="."
            depth={0}
            fileTree={fileTree || {}}
            expandedDirs={expandedDirs || new Set()}
            onToggleDir={onToggleDir || (() => {})}
            onOpenFile={onOpenFile || (() => {})}
            onSendFile={onSendFile || (() => {})}
            onBookmarkDir={onBookmarkDir}
            absoluteCwd={absoluteCwd}
          />
        )}
        </div>
      </div>
    </>
  );
}
