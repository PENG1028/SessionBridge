'use client';

import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import type { CoreClient, NodeInfo } from '../core/core-types';
import { PageHeader, PageLoading, PageError, PageEmpty, PageOffline, type PageState } from './page-utils';
import { listFromResponse, normalizeNodeInfo } from './core-response-utils';

interface NodeManagerProps {
  core: CoreClient;
}

/**
 * Node Manager - view all nodes and their health status.
 * Calls: node.list, node.info, node.health
 * Events: node.health (WS), node.connected (WS), node.disconnected (WS)
 */
export function NodeManager({ core }: NodeManagerProps) {
  const [pageState, setPageState] = useState<PageState>('loading');
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [selectedNode, setSelectedNode] = useState<NodeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchNodes() {
    if (!core.isConnected) {
      setPageState('offline');
      return;
    }

    setPageState('loading');
    setError(null);

    try {
      const result = await core.call<unknown>('node.list');
      const normalized = listFromResponse<Partial<NodeInfo> & Record<string, unknown>>(result, 'nodes').map(normalizeNodeInfo);
      setNodes(normalized);
      setPageState(normalized.length > 0 ? 'ready' : 'empty');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load nodes');
      setPageState('error');
    }
  }

  async function fetchNodeDetail(nodeId: string) {
    try {
      const detail = await core.call<Partial<NodeInfo> & Record<string, unknown>>('node.info', { nodeId });
      setSelectedNode(normalizeNodeInfo(detail));
    } catch (err) {
      setSelectedNode(prev => prev ? { ...prev, status: 'error', address: err instanceof Error ? err.message : prev.address } : prev);
    }
  }

  useEffect(() => {
    fetchNodes();
  }, [core]);

  if (pageState === 'loading') return <div className="flex-1"><PageLoading rows={5} /></div>;
  if (pageState === 'offline') return <div className="flex-1"><PageOffline /></div>;
  if (pageState === 'error') return <div className="flex-1"><PageError message={error || 'Unknown error'} onRetry={fetchNodes} /></div>;
  if (pageState === 'empty') return <div className="flex-1"><PageEmpty title="No nodes configured" description="Add a node to get started with cluster management." /></div>;

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <PageHeader
        title="Nodes"
        actions={
          <button
            onClick={fetchNodes}
            className="p-1.5 rounded hover:bg-[#1a1a1a] text-gray-400 hover:text-gray-200 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
        }
      />

      <div className="flex-1 p-4">
        <div className="space-y-1.5">
          {nodes.map(node => (
            <button
              key={node.nodeId}
              onClick={() => {
                setSelectedNode(node);
                fetchNodeDetail(node.nodeId);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded border text-[10px] text-left transition-colors ${
                selectedNode?.nodeId === node.nodeId
                  ? 'border-purple-500/50 bg-purple-900/10'
                  : 'border-gray-800 bg-[#111] hover:bg-[#1a1a1a]'
              }`}
            >
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                node.status === 'online' ? 'bg-emerald-500' :
                node.status === 'connecting' ? 'bg-yellow-500' :
                node.status === 'error' ? 'bg-red-500' :
                'bg-gray-600'
              }`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-gray-200">{node.name}</span>
                  <span className="text-[9px] text-gray-500 bg-[#1a1a1a] px-1.5 py-0.5 rounded">{node.role || '-'}</span>
                  <span className="text-[9px] text-gray-600">{node.version || ''}</span>
                </div>
                <div className="text-[9px] text-gray-500 mt-0.5">
                  {node.address || ''}
                  {node.uptime ? ` - up ${node.uptime}` : ''}
                </div>
              </div>
              <span className="text-[9px] text-gray-500 flex-shrink-0">
                CPU {node.cpu || '-'}
              </span>
            </button>
          ))}
        </div>

        {selectedNode && (
          <div className="mt-4 p-3 bg-[#111] rounded border border-gray-800">
            <h3 className="text-[11px] font-mono text-gray-200 mb-2">Node Detail: {selectedNode.name}</h3>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <DetailRow label="ID" value={selectedNode.nodeId} />
              <DetailRow label="Role" value={selectedNode.role || '-'} />
              <DetailRow label="Status" value={selectedNode.status} />
              <DetailRow label="Version" value={selectedNode.version || '-'} />
              <DetailRow label="Uptime" value={selectedNode.uptime || '-'} />
              <DetailRow label="Address" value={selectedNode.address || '-'} />
              {selectedNode.os && <DetailRow label="OS" value={`${selectedNode.os} ${selectedNode.arch || ''}`} />}
              {selectedNode.memory && <DetailRow label="Memory" value={selectedNode.memory} />}
              {selectedNode.disk && <DetailRow label="Disk" value={selectedNode.disk} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-gray-500 w-20 flex-shrink-0 text-[10px]">{label}:</span>
      <span className="text-gray-300 text-[10px]">{value}</span>
    </div>
  );
}
