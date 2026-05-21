'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Bell, X, Check, Ban } from 'lucide-react';
import type { CoreClient } from '../core/core-types';

interface PendingApproval {
  requestId: string;
  pluginId: string;
  title: string;
  body: string;
  detail?: string;
  actions?: Array<{ id: string; label: string }>;
  planId?: string;
  createdAt: number;
}

interface ApprovalCenterProps {
  core: CoreClient;
}

/**
 * ApprovalCenter — global approval overlay.
 * Listens for notify.approval.request WS events and displays pending
 * approvals with Approve/Deny buttons. Multiple pending approvals are
 * shown in a collapsible panel.
 */
export function ApprovalCenter({ core }: ApprovalCenterProps) {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Listen for pushed approval events
  useEffect(() => {
    const unsub = core.on('notify.approval.request', (event) => {
      // The WS message has: type, requestId, pluginId, payload (JSON string)
      const raw = event as Record<string, unknown>;
      let payload: Record<string, unknown> = {};
      if (typeof raw.payload === 'string') {
        try { payload = JSON.parse(raw.payload as string); } catch { /* ignore */ }
      } else if (typeof raw.payload === 'object' && raw.payload !== null) {
        payload = raw.payload as Record<string, unknown>;
      }
      // Fallback: top-level fields may carry the data directly
      const approval: PendingApproval = {
        requestId: (raw.requestId || payload.requestId || '') as string,
        pluginId: (raw.pluginId || payload.pluginId || '') as string,
        title: (payload.title || raw.title || 'Approval Request') as string,
        body: (payload.body || raw.body || '') as string,
        detail: (payload.detail || raw.detail) as string | undefined,
        actions: Array.isArray(payload.actions) ? payload.actions as Array<{ id: string; label: string }> : undefined,
        planId: (payload.planId || raw.planId) as string | undefined,
        createdAt: (payload.createdAt || raw.createdAt || Date.now()) as number,
      };
      setApprovals(prev => {
        // Dedup by requestId
        if (prev.some(a => a.requestId === approval.requestId)) return prev;
        return [...prev, approval];
      });
      setExpanded(true);
    });

    // Listen for result events to remove resolved approvals
    const unsubResult = core.on('notify.approval.result', (event) => {
      const raw = event as Record<string, unknown>;
      const requestId = raw.requestId as string;
      if (requestId) {
        setApprovals(prev => prev.filter(a => a.requestId !== requestId));
      }
    });

    return () => { unsub(); unsubResult(); };
  }, [core]);

  const handleAction = useCallback(async (requestId: string, action: 'allow' | 'deny') => {
    setActing(requestId);
    setActionError(null);
    try {
      await core.call('notify.respond', { requestId, action });
      setApprovals(prev => prev.filter(a => a.requestId !== requestId));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `Failed to ${action}`);
    } finally {
      setActing(null);
    }
  }, [core]);

  // Don't render anything if there's nothing to show
  if (approvals.length === 0) return null;

  const pendingCount = approvals.length;

  return (
    <div className="fixed bottom-4 right-4 z-[200] max-w-sm w-full">
      {/* Toggle button */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-3 py-2 bg-yellow-900/80 hover:bg-yellow-900 border border-yellow-800 rounded-lg text-yellow-300 text-sm shadow-lg transition-colors w-full"
      >
        <Bell size={14} />
        <span className="flex-1 text-left">
          {pendingCount} pending approval{pendingCount > 1 ? 's' : ''}
        </span>
        <span className="text-yellow-500 text-xs">{expanded ? 'collapse' : 'expand'}</span>
      </button>

      {/* Expanded list */}
      {expanded && (
        <div className="mt-2 space-y-2 max-h-80 overflow-y-auto">
          {actionError && (
            <div className="px-3 py-2 bg-red-900/40 border border-red-800 rounded text-xs text-red-400">
              {actionError}
              <button onClick={() => setActionError(null)} className="ml-2 text-red-300">&times;</button>
            </div>
          )}
          {approvals.map(approval => (
            <div
              key={approval.requestId}
              className="p-3 bg-gray-900 border border-yellow-800/50 rounded-lg shadow-lg"
            >
              <div className="flex items-start justify-between mb-1">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <code className="text-xs text-yellow-400 font-mono">{approval.pluginId}</code>
                    {approval.planId && (
                      <span className="text-xs text-gray-600">plan: {approval.planId}</span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-gray-200 mt-0.5">{approval.title}</p>
                </div>
              </div>
              {approval.body && (
                <p className="text-xs text-gray-400 mb-2">{approval.body}</p>
              )}
              {approval.detail && (
                <p className="text-xs text-gray-500 mb-2">{approval.detail}</p>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleAction(approval.requestId, 'allow')}
                  disabled={acting === approval.requestId}
                  className="flex items-center gap-1 px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white text-xs rounded transition-colors disabled:opacity-50"
                >
                  <Check size={12} />
                  {acting === approval.requestId ? '...' : 'Approve'}
                </button>
                <button
                  onClick={() => handleAction(approval.requestId, 'deny')}
                  disabled={acting === approval.requestId}
                  className="flex items-center gap-1 px-3 py-1.5 bg-red-700 hover:bg-red-600 text-white text-xs rounded transition-colors disabled:opacity-50"
                >
                  <Ban size={12} />
                  {acting === approval.requestId ? '...' : 'Deny'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
