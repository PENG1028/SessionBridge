'use client';

import { useWorkbench } from '../workbench/workbench-context';
import ShellTerminal from '../../shell-terminal';

interface TerminalViewProps {
  instanceId?: string;
}

export function TerminalView({ instanceId }: TerminalViewProps) {
  const { wsUrl, token } = useWorkbench();
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 py-1.5 border-b border-gray-800 text-[10px] text-gray-500 font-bold tracking-wider shrink-0">
        TERMINAL
      </div>
      <div className="flex-1 min-h-0">
        <ShellTerminal wsUrl={wsUrl} instanceId={instanceId} token={token} />
      </div>
    </div>
  );
}
