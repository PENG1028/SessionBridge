'use client';

import { Terminal } from 'lucide-react';
import { useState } from 'react';
import { useWorkbench } from '../workbench/workbench-context';
import ShellTerminal from '../../shell-terminal';

interface TerminalViewProps {
  instanceId?: string;
}

export function TerminalView({ instanceId }: TerminalViewProps) {
  // Phase 4F: instanceId comes from PaneTab.instanceId.
  // Phase 4I: NO fallback to activeInstanceId. If instanceId is undefined,
  // the empty state is shown with Attach Existing / Create New Terminal.
  // This ensures the activeInstanceId (sidebar management selection) does
  // NOT influence terminal tab behavior.
  const { wsUrl, token, createInstance, bindCurrentTabInstance, projectCwd, instances, activateInstance } = useWorkbench();
  const [creating, setCreating] = useState(false);

  // Filter existing instances that are terminal-capable (shell adapter)
  const terminalInstances = (instances || []).filter(
    (inst: any) => inst.adapterId === 'shell' && inst.id !== instanceId
  );

  // Phase 4F: No instanceId → show attach/create empty state, never auto-spawn.
  if (!instanceId) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-3 py-1.5 border-b border-gray-800 text-[10px] text-gray-500 font-bold tracking-wider shrink-0">
          TERMINAL
        </div>
        <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0a0a] min-h-0 gap-4 overflow-y-auto px-4 py-4">
          <Terminal className="w-10 h-10 text-gray-700 shrink-0" />
          <div className="text-center space-y-1">
            <p className="text-xs text-gray-500">No terminal instance attached</p>
            <p className="text-[10px] text-gray-700">Attach an existing instance or create a new one</p>
          </div>

          {/* Attach Existing */}
          {terminalInstances.length > 0 && (
            <div className="w-full max-w-xs space-y-1.5">
              <p className="text-[9px] text-gray-600 font-bold tracking-wider text-center">ATTACH EXISTING</p>
              {terminalInstances.map((inst: any) => (
                <button
                  key={inst.id}
                  onClick={() => bindCurrentTabInstance(inst.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-[#1a1a1a] hover:bg-[#252525] border border-gray-700 hover:border-gray-600 rounded text-[11px] text-gray-300 transition-colors text-left"
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    inst.status === 'running' ? 'bg-emerald-500/80'
                    : inst.status === 'starting' ? 'bg-yellow-500'
                    : 'bg-gray-600'
                  }`} />
                  <span className="truncate flex-1">{inst.label || inst.id.slice(0, 12)}</span>
                  <span className="text-[9px] text-gray-600 uppercase">{inst.status}</span>
                </button>
              ))}
            </div>
          )}

          {/* Create New */}
          <div className="flex flex-col items-center gap-2">
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
