'use client';

import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import type { CoreClient } from '../core/core-types';
import { PageHeader, PageLoading, PageError, PageOffline, PageEmpty, type PageState } from './page-utils';

interface ApprovalRequest {
  requestId: string;
  pluginId: string;
  action: string;
  detail: string;
  status: 'pending' | 'approved' | 'denied' | 'timeout';
  createdAt: string;
  expiresAt?: string;
  approvedBy?: string;
}

interface ApprovalListResponse {
  approvals?: ApprovalRequest[];
}

interface ApprovalsProps {
  core: CoreClient;
}

/**
 * Approvals — approval request management center.
 * Calls: approval.list, notify.respond
 * Events: notify.approval.request (WS)
 */
export function Approvals({ core }: ApprovalsProps) {
  const [pageState, setPageState] = useState<PageState>('loading');
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending'>('pending');

  async function fetchRequests() {
    if (!core.isConnected) {
      setPageState('offline');
      return;
    }

    setPageState('loading');
    setError(null);

    try {
      const params = filter === 'all' ? {} : { status: filter };
      const result = await core.call<ApprovalListResponse>('approval.list', params);
      const approvals = Array.isArray(result?.approvals) ? result.approvals : [];
      setRequests(approvals);
      setPageState(approvals.length > 0 ? 'ready' : 'empty');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load approvals');
      setPageState('error');
    }
  }

  async function handleApprove(requestId: string) {
    setActionError(null);
    try {
      await core.call('notify.respond', { requestId, action: 'allow' });
      fetchRequests();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to approve';
      setActionError(msg);
    }
  }

  async function handleDeny(requestId: string) {
    setActionError(null);
    try {
      await core.call('notify.respond', { requestId, action: 'deny' });
      fetchRequests();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to deny';
      setActionError(msg);
    }
  }

  useEffect(() => {
    fetchRequests();
  }, [core, filter]);

  useEffect(() => {
    const unsub = core.on('notify.approval.request', () => {
      fetchRequests();
    });
    return unsub;
  }, [core, filter]);

  if (pageState === 'loading') return <div className="flex-1"><PageLoading rows={5} /></div>;
  if (pageState === 'offline') return <div className="flex-1"><PageOffline /></div>;
  if (pageState === 'error') return <div className="flex-1"><PageError message={error || 'Unknown error'} onRetry={fetchRequests} /></div>;
  if (pageState === 'empty') return <div className="flex-1"><PageEmpty title="No approval requests" description="Pending approval requests from plugins will appear here." /></div>;

  const pendingCount = requests.filter(r => r.status === 'pending').length;

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <PageHeader
        title={`Approvals${pendingCount > 0 ? ` (${pendingCount})` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={filter}
              onChange={e => setFilter(e.target.value as typeof filter)}
              className="px-2 py-1 bg-[#1a1a1a] border border-gray-700 rounded text-[9px] text-gray-300 focus:outline-none"
            >
              <option value="pending">Pending</option>
            </select>
            <button
              onClick={fetchRequests}
              className="p-1.5 rounded hover:bg-[#1a1a1a] text-gray-400 hover:text-gray-200 transition-colors"
              title="Refresh"
            >
              <RefreshCw size={16} />
            </button>
          </div>
        }
      />

      <div className="p-4 space-y-2">
        {requests.map(req => (
          <div
            key={req.requestId}
            className={`p-3 rounded border ${
              req.status === 'pending'
                ? 'border-yellow-700/50 bg-yellow-900/10'
                : req.status === 'approved'
                ? 'border-emerald-700/30 bg-emerald-900/10'
                : req.status === 'denied'
                ? 'border-red-700/30 bg-red-900/10'
                : 'border-gray-800 bg-[#111]'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-gray-200">{req.pluginId}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                    req.status === 'pending' ? 'bg-yellow-900/30 text-yellow-400' :
                    req.status === 'approved' ? 'bg-emerald-900/30 text-emerald-400' :
                    req.status === 'denied' ? 'bg-red-900/30 text-red-400' :
                    'bg-[#1a1a1a] text-gray-500'
                  }`}>
                    {req.status}
                  </span>
                </div>
                <p className="text-[10px] text-gray-300 mt-1">{req.action}</p>
                <p className="text-[9px] text-gray-500 mt-0.5">{req.detail}</p>
                <div className="text-[9px] text-gray-600 mt-1">
                  {req.createdAt}
                  {req.expiresAt ? ` · expires ${req.expiresAt}` : ''}
                  {req.approvedBy ? ` · by ${req.approvedBy}` : ''}
                </div>
              </div>

              {req.status === 'pending' && (
                <div className="flex flex-col items-end gap-1 ml-4 flex-shrink-0">
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => handleApprove(req.requestId)}
                      className="px-3 py-1 bg-emerald-900/20 text-emerald-400 border border-emerald-700/30 text-[10px] rounded transition-colors hover:bg-emerald-900/40"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleDeny(req.requestId)}
                      className="px-3 py-1 bg-red-900/20 text-red-400 border border-red-700/30 text-[10px] rounded transition-colors hover:bg-red-900/40"
                    >
                      Deny
                    </button>
                  </div>
                  {actionError && (
                    <p className="text-[9px] text-red-400">{actionError}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
