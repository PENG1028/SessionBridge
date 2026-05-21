'use client';

import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import type { CoreClient } from '../../core/core-types';
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
 * Events: approval.request (WS), approval.response (WS), approval.viewing (WS)
 */
export function Approvals({ core }: ApprovalsProps) {
  const [pageState, setPageState] = useState<PageState>('loading');
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'denied'>('pending');

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
    const unsub = core.on('approval.request', () => {
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
              className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 focus:outline-none"
            >
              <option value="pending">Pending</option>
              <option value="all">All</option>
              <option value="approved">Approved</option>
              <option value="denied">Denied</option>
            </select>
            <button
              onClick={fetchRequests}
              className="p-2 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
              title="Refresh"
            >
              <RefreshCw size={16} />
            </button>
          </div>
        }
      />

      <div className="p-6 space-y-3">
        {requests.map(req => (
          <div
            key={req.requestId}
            className={`p-4 rounded-lg border ${
              req.status === 'pending'
                ? 'border-yellow-800 bg-yellow-900/10'
                : req.status === 'approved'
                ? 'border-green-800 bg-green-900/10'
                : req.status === 'denied'
                ? 'border-red-800 bg-red-900/10'
                : 'border-gray-800 bg-gray-900'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-200">{req.pluginId}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    req.status === 'pending' ? 'bg-yellow-900/50 text-yellow-400' :
                    req.status === 'approved' ? 'bg-green-900/50 text-green-400' :
                    req.status === 'denied' ? 'bg-red-900/50 text-red-400' :
                    'bg-gray-800 text-gray-500'
                  }`}>
                    {req.status}
                  </span>
                </div>
                <p className="text-sm text-gray-300 mt-1">{req.action}</p>
                <p className="text-xs text-gray-500 mt-0.5">{req.detail}</p>
                <div className="text-xs text-gray-600 mt-1">
                  {req.createdAt}
                  {req.expiresAt ? ` · expires ${req.expiresAt}` : ''}
                  {req.approvedBy ? ` · by ${req.approvedBy}` : ''}
                </div>
              </div>

              {req.status === 'pending' && (
                <div className="flex flex-col items-end gap-1 ml-4 flex-shrink-0">
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleApprove(req.requestId)}
                      className="px-4 py-2 bg-green-700 hover:bg-green-600 text-white text-sm rounded transition-colors"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleDeny(req.requestId)}
                      className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white text-sm rounded transition-colors"
                    >
                      Deny
                    </button>
                  </div>
                  {actionError && (
                    <p className="text-xs text-red-400">{actionError}</p>
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
