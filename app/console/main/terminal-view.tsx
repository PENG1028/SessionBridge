'use client';

// ─── Terminal View ──────────────────────────────────────────
// Inline terminal wrapper. Renders ShellTerminal as part of the
// main content area (not as a full-screen overlay).
// This makes it a Core View — always accessible, never hides
// the left sidebar.

import ShellTerminal from '../../shell-terminal';

interface TerminalViewProps {
  wsUrl: string;
  instanceId?: string;
  token?: string;
}

export function TerminalView({ wsUrl, instanceId, token }: TerminalViewProps) {
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
