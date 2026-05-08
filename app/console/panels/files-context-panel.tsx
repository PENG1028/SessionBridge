'use client';

import { FileCode } from 'lucide-react';

interface FilesContextPanelProps {
  knownFiles?: Map<string, string>;
  onOpenFile?: (filePath: string) => void;
  shortenPath?: (p: string) => string;
}

export function FilesContextPanel(props: FilesContextPanelProps) {
  const { knownFiles, onOpenFile, shortenPath } = props;

  if (!knownFiles || knownFiles.size === 0) return null;

  return (
    <div className="border-b border-gray-800 bg-[#111]">
      <div className="p-2 text-[10px] font-bold text-gray-500 flex items-center gap-2 tracking-wider">
        <FileCode className="w-3 h-3" />
        FILES IN CONTEXT
        <span className="text-gray-700 font-normal">{knownFiles.size}</span>
      </div>
      <div className="max-h-24 overflow-y-auto px-2 pb-2 space-y-0.5">
        {[...knownFiles.entries()].filter(([,t]) => t === 'file').slice(-30).map(([path]) => (
          <button key={path}
            onClick={() => onOpenFile?.(path)}
            className="w-full flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 text-[10px] transition-colors text-left"
            title={path}
          >
            <FileCode className="w-2.5 h-2.5 shrink-0 text-blue-500" />
            <span className="truncate text-[9px]">{shortenPath ? shortenPath(path) : path}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
