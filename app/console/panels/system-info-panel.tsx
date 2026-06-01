'use client';

// ─── SystemInfoPanel ─────────────────────────────────────────────
// Displays system info and node health from Core.

import { useState, useEffect } from 'react';
import type { HostComponentProps } from '../plugin-host/host-component-registry';

export function SystemInfoPanel({ core, config }: HostComponentProps) {
  if (!config) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-950 text-gray-500 text-xs" data-testid="system-info-panel">
        System Info — not available in this context
      </div>
    );
  }
  const [sysInfo, setSysInfo] = useState<Record<string, unknown> | null>(null);
  const [nodes, setNodes] = useState<Array<{ nodeId: string; status: string; name?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [sys, nodeResult] = await Promise.all([
        core.call<Record<string, unknown>>('system.info'),
        core.call<{ nodes: Array<{ nodeId: string; status: string; name?: string }> }>('node.list'),
      ]);
      setSysInfo(sys);
      setNodes(nodeResult?.nodes || []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-gray-950" data-testid="system-info-panel">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-800 bg-gray-900 text-xs">
        <span className="text-gray-400 font-medium">{config.title}</span>
        <button onClick={refresh} className="text-gray-500 hover:text-gray-300">Refresh</button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 text-xs space-y-3">
        {loading && <div className="text-gray-600">Loading...</div>}
        {error && <div className="text-red-400">Error: {error}</div>}

        {sysInfo && (
          <div>
            <div className="text-gray-500 uppercase tracking-wide mb-1 text-[10px]">System</div>
            <div className="bg-gray-900 rounded p-2 space-y-1">
              <Row label="OS" value={String(sysInfo.os || '')} />
              <Row label="Arch" value={String(sysInfo.arch || '')} />
              <Row label="Hostname" value={String(sysInfo.hostname || '')} />
              <Row label="Go Version" value={String(sysInfo.goVersion || '')} />
              <Row label="CPU Cores" value={String(sysInfo.numCPU || '')} />
            </div>
          </div>
        )}

        {nodes.length > 0 && (
          <div>
            <div className="text-gray-500 uppercase tracking-wide mb-1 text-[10px]">Nodes</div>
            <div className="bg-gray-900 rounded p-2 space-y-1">
              {nodes.map(n => (
                <div key={n.nodeId} className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${n.status === 'connected' || n.status === 'online' ? 'bg-green-500' : 'bg-gray-600'}`} />
                  <span className="text-gray-300">{n.name || n.nodeId}</span>
                  <span className="text-gray-500 ml-auto">{n.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-300 font-mono">{value}</span>
    </div>
  );
}
