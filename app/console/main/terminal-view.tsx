'use client';

import { Terminal } from 'lucide-react';
import { useState } from 'react';
import { useWorkbench } from '../workbench/workbench-context';
import ShellTerminal from '../../shell-terminal';

interface TerminalViewProps {
  instanceId?: string;
}

export function TerminalView({ instanceId }: TerminalViewProps) {
  const { wsUrl, token, createInstance, bindCurrentTabInstance, projectCwd } = useWorkbench();
  const [creating, setCreating] = useState(false);

  // Phase 4F: No instanceId → show attach/create empty state, never auto-spawn.
  if (!instanceId) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-3 py-1.5 border-b border-gray-800 text-[10px] text-gray-500 font-bold tracking-wider shrink-0">
          TERMINAL
        </div>
        <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0a0a] min-h-0 gap-4">
          <Terminal className="w-10 h-10 text-gray-700" />
          <div className="text-center space-y-1">
            <p className="text-xs text-gray-500">No terminal instance attached</p>
            <p className="text-[10px] text-gray-700">Attach an existing instance or create a new one</p>
          </div>
          <div className="flex flex-col items-center gap-2">
            {/* TODO(Phase 4F): add instance selector for "Attach existing" */}
            <p className="text-[9px] text-gray-700 italic">(Instance selector coming soon)</p>
            <button
              onClick={async () => {
                setCreating(true);
                try {
                  const result = await createInstance(projectCwd || '.', 'Terminal', 'shell');
                  if (result?.instance?.id) {
                    bindCurrentTabInstance(result.instance.id);
                  }
                } finally {
                  setCreating(false);
                }
              }}
              disabled={creating}
              className="flex items-center gap-2 px-4 py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded border border-purple-600 transition-colors"
            >
              <Terminal className="w-4 h-4" />
              {creating ? 'Creating...' : 'Create New Terminal'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 py-1.5 border-b border-gray-800 text-[10px] text-gray-500 font-bold tracking-wider shrink-0">
        TERMINAL
      </div>
      <div className="flex-1 flex flex-col min-h-0">
        <ShellTerminal wsUrl={wsUrl} instanceId={instanceId} token={token} />
      </div>
    </div>
  );
}
