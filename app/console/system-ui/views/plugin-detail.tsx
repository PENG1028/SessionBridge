'use client';

import React, { useState, useEffect } from 'react';
import type { CoreClient, BlockerEntry } from '../../core/core-types';
import { PageLoading, PageError, PageEmpty, PageOffline, PagePermissionDenied, type PageState } from './page-utils';

interface PluginDetailProps {
  core: CoreClient;
  pluginId: string;
  onBack?: () => void;
}

type DetailTab = 'overview' | 'environment' | 'blockers' | 'permissions' | 'files' | 'cache' | 'settings' | 'logs' | 'history';

const TABS: { id: DetailTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'environment', label: 'Environment' },
  { id: 'blockers', label: 'Blockers & Status' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'files', label: 'Files' },
  { id: 'cache', label: 'Cache' },
  { id: 'settings', label: 'Settings' },
  { id: 'logs', label: 'Logs' },
  { id: 'history', label: 'History' },
];

export function PluginDetail({ core, pluginId, onBack = () => {} }: PluginDetailProps) {
  const [pageState, setPageState] = useState<PageState>('loading');
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchPlugin() {
    if (!core.isConnected) {
      setPageState('offline');
      return;
    }

    setPageState('loading');
    setError(null);

    try {
      const result = await core.call('plugin.get', { pluginId });
      setManifest(result as Record<string, unknown>);
      setPageState('ready');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load plugin';
      if (msg.includes('CAPABILITY_NOT_DECLARED') || msg.includes('not permitted') || msg.includes('Permission denied')) {
        setPageState('permission_denied');
      } else {
        setError(msg);
        setPageState('error');
      }
    }
  }

  useEffect(() => {
    fetchPlugin();
  }, [core, pluginId]);

  if (pageState === 'loading') return <div className="flex-1"><PageLoading rows={8} /></div>;
  if (pageState === 'offline') return <div className="flex-1"><PageOffline /></div>;
  if (pageState === 'permission_denied') return <div className="flex-1"><PagePermissionDenied /></div>;
  if (pageState === 'error') return <div className="flex-1"><PageError message={error || 'Unknown error'} onRetry={fetchPlugin} /></div>;

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-800">
        <button onClick={onBack} className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
          &lt; Plugin Manager
        </button>
        <h1 className="text-lg font-semibold text-gray-100">{pluginId}</h1>
        {manifest && (
          <>
            <span className="text-xs text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
              {str(manifest.version)}
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              str(manifest.status) === 'enabled'
                ? 'bg-green-900/50 text-green-400'
                : 'bg-gray-800 text-gray-500'
            }`}>
              {str(manifest.status) || 'unknown'}
            </span>
          </>
        )}
      </div>

      <div className="flex border-b border-gray-800 px-6 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 p-6">
        <TabContent core={core} pluginId={pluginId} tab={activeTab} manifest={manifest} />
      </div>
    </div>
  );
}

function TabContent({
  core, pluginId, tab, manifest,
}: {
  core: CoreClient; pluginId: string; tab: DetailTab; manifest: Record<string, unknown> | null;
}) {
  switch (tab) {
    case 'overview': return <OverviewTab manifest={manifest} />;
    case 'environment': return <EnvironmentTab core={core} pluginId={pluginId} />;
    case 'blockers': return <BlockersStatusTab core={core} pluginId={pluginId} />;
    case 'permissions': return <PermissionsTab core={core} pluginId={pluginId} />;
    case 'files': return <FilesTab core={core} pluginId={pluginId} />;
    case 'cache': return <CacheTab core={core} pluginId={pluginId} />;
    case 'settings': return <SettingsTab core={core} pluginId={pluginId} />;
    case 'logs': return <LogsTab core={core} pluginId={pluginId} />;
    case 'history': return <HistoryTab core={core} pluginId={pluginId} />;
  }
}

// ─── Overview Tab ───────────────────────────────────────────────────

function OverviewTab({ manifest }: { manifest: Record<string, unknown> | null }) {
  if (!manifest) return <div className="text-gray-500 text-sm">No manifest data available.</div>;

  const capabilities = safeArray(manifest.capabilities);
  return (
    <div className="max-w-2xl space-y-6">
      <Section title="Basic Info">
        {['id', 'pluginId', 'version', 'name', 'description', 'enabled', 'trusted', 'manifestVersion'].map(key => {
          if (manifest[key] === undefined || manifest[key] === null) return null;
          return (
            <div key={key} className="flex gap-2 text-sm">
              <span className="text-gray-500 w-36 flex-shrink-0">{key}:</span>
              <span className="text-gray-300">{String(manifest[key])}</span>
            </div>
          );
        })}
      </Section>

      {capabilities.length > 0 && (
        <Section title="Declared Capabilities">
          <div className="flex flex-wrap gap-1">
            {capabilities.map((cap, idx) => (
              <span key={idx} className="text-xs px-2 py-1 bg-gray-800 text-gray-400 rounded">
                {str(cap.id) || String(cap)}
              </span>
            ))}
          </div>
        </Section>
      )}

      {!!manifest.core && (
        <Section title="Core Spec">
          <pre className="text-xs text-gray-500 bg-gray-950 p-3 rounded-lg overflow-x-auto max-h-48">
            {JSON.stringify(manifest.core, null, 2)}
          </pre>
        </Section>
      )}

      {!!manifest.adapters && (
        <Section title="Adapters">
          <pre className="text-xs text-gray-500 bg-gray-950 p-3 rounded-lg overflow-x-auto max-h-48">
            {JSON.stringify(manifest.adapters, null, 2)}
          </pre>
        </Section>
      )}

      {!!manifest.contributes && (
        <Section title="Contributes">
          <pre className="text-xs text-gray-500 bg-gray-950 p-3 rounded-lg overflow-x-auto max-h-48">
            {JSON.stringify(manifest.contributes, null, 2)}
          </pre>
        </Section>
      )}
    </div>
  );
}

// ─── Environment Tab ────────────────────────────────────────────────

interface DepEntry {
  id: string; type: string; status: string; command?: string;
  required?: boolean; versionCommand?: string; requiredVersion?: string; installHint?: string;
}

function EnvironmentTab({ core, pluginId }: { core: CoreClient; pluginId: string }) {
  const [data, setData] = useState<{ status: string; dependencies: DepEntry[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  async function runCheck() {
    setLoading(true);
    setFetchError(null);
    try {
      const result = await core.call<{ status: string; dependencies: DepEntry[] }>('plugin.check', { pluginId });
      setData(result);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Check failed');
      setData({ status: 'error', dependencies: [] });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { runCheck(); }, [core, pluginId]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-sm font-medium text-gray-300">Environment Check</h3>
        <button onClick={runCheck} disabled={loading}
          className="text-xs px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors disabled:opacity-50"
        >
          {loading ? 'Running...' : 'Run Check Again'}
        </button>
        {data && (
          <span className={`text-xs px-2 py-0.5 rounded ${
            data.status === 'ok' ? 'bg-green-900/50 text-green-400' : 'bg-yellow-900/50 text-yellow-400'
          }`}>
            {data.status}
          </span>
        )}
      </div>

      {fetchError && <p className="text-red-400 text-sm mb-3">{fetchError}</p>}

      {!data ? (
        <div className="text-gray-500 text-sm">Running check...</div>
      ) : data.dependencies.length === 0 ? (
        <div className="text-gray-500 text-sm">No environment checks defined.</div>
      ) : (
        <div className="space-y-2">
          {data.dependencies.map((dep, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2 bg-gray-900 rounded-lg border border-gray-800 text-sm">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                dep.status === 'ok' ? 'bg-green-500' :
                dep.status === 'skipped' ? 'bg-gray-600' :
                dep.status === 'pending' ? 'bg-yellow-500' : 'bg-red-500'
              }`} />
              <span className="text-gray-200 font-medium">{dep.id}</span>
              <span className="text-xs text-gray-500">({dep.type})</span>
              {dep.command && <span className="text-xs text-gray-600">cmd: {dep.command}</span>}
              {dep.required && <span className="text-xs text-red-400/70">required</span>}
              {dep.versionCommand && <span className="text-xs text-gray-600">ver: {dep.versionCommand}</span>}
              {dep.requiredVersion && <span className="text-xs text-gray-600">≥ {dep.requiredVersion}</span>}
              {dep.installHint && (
                <span className="text-xs text-blue-400/70 ml-auto" title={dep.installHint}>
                  install hint
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Blockers & Status Tab ────────────────────────────────────────────

interface InstallState {
  plan: Record<string, unknown> | null;
  planLoading: boolean;
  planError: string | null;
  executing: boolean;
  executionResult: Record<string, unknown> | null;
}

interface CapabilityEntry {
  capability: string;
  supported: boolean;
  level: string;
  reason?: string;
  detail?: string;
}

function BlockersStatusTab({ core, pluginId }: { core: CoreClient; pluginId: string }) {
  const [checkResult, setCheckResult] = useState<{ status: string; blockers: BlockerEntry[]; capabilities: CapabilityEntry[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Install plan flow state
  const [install, setInstall] = useState<InstallState>({
    plan: null, planLoading: false, planError: null, executing: false, executionResult: null,
  });
  const [approvalRequestId, setApprovalRequestId] = useState<string | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<string | null>(null);

  // Grant approval flow state (per capability)
  const [grantApprovals, setGrantApprovals] = useState<Record<string, { status: string; planId?: string; requestId?: string; message?: string } | null>>({});
  const [grantErrors, setGrantErrors] = useState<Record<string, string | null>>({});

  async function runCheck() {
    setLoading(true);
    setFetchError(null);
    try {
      const result = await core.call<Record<string, unknown>>('plugin.check', { pluginId });
      setCheckResult({
        status: str(result?.status) || 'ok',
        blockers: Array.isArray(result?.blockers) ? (result!.blockers as BlockerEntry[]) : [],
        capabilities: Array.isArray(result?.capabilities)
          ? (result!.capabilities as Array<Record<string, unknown>>).map(c => ({
              capability: str(c.capability),
              supported: !!c.supported,
              level: str(c.level),
              reason: str(c.reason) || undefined,
              detail: str(c.detail) || undefined,
            }))
          : [],
      });
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Check failed');
      setCheckResult({ status: 'error', blockers: [], capabilities: [] });
    } finally {
      setLoading(false);
    }
  }

  async function createInstallPlan() {
    setInstall({ plan: null, planLoading: true, planError: null, executing: false, executionResult: null });
    setApprovalRequestId(null);
    setApprovalStatus(null);
    try {
      const plan = await core.call<Record<string, unknown>>('plugin.install.plan', { pluginId });
      setInstall(prev => ({ ...prev, plan, planLoading: false }));
    } catch (err) {
      setInstall(prev => ({ ...prev, planError: err instanceof Error ? err.message : 'Failed to create plan', planLoading: false }));
    }
  }

  async function requestApproval() {
    if (!install.plan) return;
    setApprovalStatus('requesting');
    try {
      const res = await core.call<Record<string, unknown>>('notify.request', {
        title: `Install ${pluginId}`,
        body: str((install.plan as Record<string, unknown>).summary) || `Install plan for ${pluginId}`,
        planId: str((install.plan as Record<string, unknown>).planId),
        actions: [{ id: 'allow', label: 'Approve' }, { id: 'deny', label: 'Deny' }],
        timeout: 300,
      });
      setApprovalRequestId(str(res?.requestId) || null);
      setApprovalStatus('pending');
    } catch (err) {
      setApprovalStatus(null);
      setInstall(prev => ({ ...prev, planError: err instanceof Error ? err.message : 'Approval request failed' }));
    }
  }

  async function approvePlan() {
    if (!approvalRequestId) return;
    try {
      await core.call('notify.respond', { requestId: approvalRequestId, action: 'allow' });
      setApprovalStatus('approved');
    } catch (err) {
      setInstall(prev => ({ ...prev, planError: err instanceof Error ? err.message : 'Approval failed' }));
    }
  }

  async function denyPlan() {
    if (!approvalRequestId) return;
    try {
      await core.call('notify.respond', { requestId: approvalRequestId, action: 'deny' });
      setApprovalStatus('denied');
    } catch (err) {
      setInstall(prev => ({ ...prev, planError: err instanceof Error ? err.message : 'Deny failed' }));
    }
  }

  async function executePlan() {
    if (!install.plan) return;
    setInstall(prev => ({ ...prev, executing: true, executionResult: null, planError: null }));
    try {
      const result = await core.call<Record<string, unknown>>('plugin.install.execute', {
        planId: str((install.plan as Record<string, unknown>).planId),
      });
      setInstall(prev => ({ ...prev, executing: false, executionResult: result ?? null }));
      runCheck(); // Re-check after completion
    } catch (err) {
      setInstall(prev => ({
        ...prev, executing: false,
        planError: err instanceof Error ? err.message : 'Execution failed',
      }));
    }
  }

  // ─── Grant Approval Flow ───────────────────────────────────────

  /** Step 1: Call plugin.permissions.grant and handle response. */
  async function handleGrantRequest(capability: string) {
    setGrantErrors(prev => ({ ...prev, [capability]: null }));
    try {
      const result = await core.call<Record<string, unknown>>('plugin.permissions.grant', {
        pluginId, capability, mode: 'allow',
      });
      const status = str(result?.status);
      if (status === 'ok') {
        setGrantApprovals(prev => ({ ...prev, [capability]: null }));
        await runCheck();
      } else if (status === 'requires_approval') {
        const planId = str(result?.planId);
        setGrantApprovals(prev => ({ ...prev, [capability]: { status: 'requires_approval', planId: planId || undefined } }));
      } else if (status === 'approval_denied') {
        setGrantApprovals(prev => ({ ...prev, [capability]: { status: 'denied', message: str(result?.message) || 'Approval denied' } }));
      } else {
        setGrantErrors(prev => ({ ...prev, [capability]: `Unexpected status: ${status}` }));
      }
    } catch (err) {
      setGrantErrors(prev => ({ ...prev, [capability]: err instanceof Error ? err.message : 'Grant failed' }));
    }
  }

  /** Step 2: Create a notify.request for plan-based approval. */
  async function requestGrantApproval(capability: string, planId: string) {
    setGrantErrors(prev => ({ ...prev, [capability]: null }));
    try {
      const res = await core.call<Record<string, unknown>>('notify.request', {
        title: `Grant ${capability} for ${pluginId}`,
        body: `High-risk capability "${capability}" requires approval before it can be granted.`,
        planId,
        actions: [{ id: 'allow', label: 'Approve' }, { id: 'deny', label: 'Deny' }],
        timeout: 300,
      });
      const requestId = str(res?.requestId);
      setGrantApprovals(prev => ({ ...prev, [capability]: { status: 'pending', planId, requestId: requestId || undefined } }));
    } catch (err) {
      setGrantErrors(prev => ({ ...prev, [capability]: err instanceof Error ? err.message : 'Approval request failed' }));
      setGrantApprovals(prev => ({ ...prev, [capability]: { status: 'requires_approval', planId } }));
    }
  }

  /** Step 3: Approve the plan via notify.respond, then step 4: re-call grant. */
  async function approveGrant(capability: string) {
    const state = grantApprovals[capability];
    if (!state?.requestId) return;
    setGrantErrors(prev => ({ ...prev, [capability]: null }));
    try {
      await core.call('notify.respond', { requestId: state.requestId, action: 'allow' });
      // Step 4: Re-call grant with the approved planId
      const result = await core.call<Record<string, unknown>>('plugin.permissions.grant', {
        pluginId, capability, mode: 'allow', planId: state.planId,
      });
      const status = str(result?.status);
      if (status === 'ok') {
        setGrantApprovals(prev => ({ ...prev, [capability]: null }));
        setGrantErrors(prev => ({ ...prev, [capability]: null }));
        await runCheck();
      } else {
        setGrantApprovals(prev => ({ ...prev, [capability]: { status: str(result?.status) || 'error', message: str(result?.message) || 'Grant returned non-ok status' } }));
      }
    } catch (err) {
      setGrantErrors(prev => ({ ...prev, [capability]: err instanceof Error ? err.message : 'Approval or grant failed' }));
    }
  }

  /** Deny the grant approval request. */
  async function denyGrant(capability: string) {
    const state = grantApprovals[capability];
    if (!state?.requestId) return;
    setGrantErrors(prev => ({ ...prev, [capability]: null }));
    try {
      await core.call('notify.respond', { requestId: state.requestId, action: 'deny' });
      setGrantApprovals(prev => ({ ...prev, [capability]: { status: 'denied', message: 'Approval denied by user' } }));
    } catch (err) {
      setGrantErrors(prev => ({ ...prev, [capability]: err instanceof Error ? err.message : 'Deny failed' }));
    }
  }

  useEffect(() => { runCheck(); }, [core, pluginId]);

  // ── Render ──

  if (loading) return <div className="text-gray-500 text-sm">Checking blockers...</div>;
  if (fetchError) return (
    <div>
      <p className="text-red-400 text-sm mb-2">{fetchError}</p>
      <button onClick={runCheck} className="text-xs px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400">Retry</button>
    </div>
  );

  if (!checkResult) return null;

  const statusIcon = checkResult.status === 'blocked' ? '\u{1F534}' :
    checkResult.status === 'incomplete' ? '\u{1F7E1}' : '\u{1F7E2}';

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-gray-300">Blockers & Status</h3>
        <button onClick={runCheck} disabled={loading}
          className="text-xs px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors disabled:opacity-50"
        >
          {loading ? 'Running...' : 'Run Check Again'}
        </button>
        <span className={`text-xs px-2 py-0.5 rounded ${
          checkResult.status === 'ok' ? 'bg-green-900/50 text-green-400' :
          checkResult.status === 'blocked' ? 'bg-red-900/50 text-red-400' :
          'bg-yellow-900/50 text-yellow-400'
        }`}>
          {statusIcon} {checkResult.status}
        </span>
      </div>

      {/* Blockers list */}
      {checkResult.blockers.length === 0 ? (
        <div className="text-gray-500 text-sm">No blockers. All capabilities and dependencies are satisfied.</div>
      ) : (
        <div className="space-y-3">
          {checkResult.blockers.map((b, i) => (
            <div key={i} className="px-4 py-3 bg-gray-900 rounded-lg border border-gray-800 space-y-2">
              <div className="flex items-center gap-2">
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  b.kind === 'missing_dependency' ? 'bg-red-900/50 text-red-400' :
                  b.kind === 'missing_grant' ? 'bg-yellow-900/50 text-yellow-400' :
                  b.kind === 'unsupported_capability' ? 'bg-red-900/50 text-red-400' :
                  'bg-orange-900/50 text-orange-400'
                }`}>
                  {b.kind}
                </span>
                <code className="text-sm text-gray-200 font-mono">
                  {b.capability || b.dependency || '(unknown)'}
                </code>
              </div>
              <p className="text-xs text-gray-500">Reason: {b.reason}</p>

              {/* Action per blocker kind */}
              <div className="pt-1 space-y-2">
                {b.kind === 'missing_dependency' && (
                  <button
                    onClick={createInstallPlan}
                    disabled={install.planLoading}
                    className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50"
                  >
                    {install.planLoading ? 'Creating...' : 'Create Install Plan'}
                  </button>
                )}
                {b.kind === 'missing_grant' && (
                  <>
                    {(() => {
                      const cap = b.capability || '';
                      const approvalState = grantApprovals[cap];
                      const errMsg = grantErrors[cap];

                      if (!approvalState) {
                        return (
                          <button
                            onClick={() => handleGrantRequest(cap)}
                            className="text-xs px-3 py-1.5 rounded bg-yellow-600 hover:bg-yellow-500 text-white transition-colors"
                          >
                            Request Permission
                          </button>
                        );
                      }

                      if (approvalState.status === 'requires_approval') {
                        return (
                          <div className="space-y-2">
                            <p className="text-xs text-yellow-400">
                              Requires approval{approvalState.planId ? ` — plan: ${approvalState.planId}` : ''}
                            </p>
                            <button
                              onClick={() => requestGrantApproval(cap, approvalState.planId || '')}
                              className="text-xs px-3 py-1.5 rounded bg-yellow-600 hover:bg-yellow-500 text-white transition-colors"
                            >
                              Request Approval
                            </button>
                          </div>
                        );
                      }

                      if (approvalState.status === 'pending') {
                        return (
                          <div className="space-y-2">
                            <p className="text-xs text-yellow-400">
                              Awaiting approval{approvalState.requestId ? ` (${approvalState.requestId})` : ''}
                            </p>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => approveGrant(cap)}
                                className="text-xs px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 text-white transition-colors"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => denyGrant(cap)}
                                className="text-xs px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white transition-colors"
                              >
                                Deny
                              </button>
                            </div>
                          </div>
                        );
                      }

                      if (approvalState.status === 'denied') {
                        return (
                          <p className="text-xs text-red-400">
                            {approvalState.message || 'Approval denied'}
                          </p>
                        );
                      }

                      return null;
                    })()}
                    {(() => {
                      const cap = b.capability || '';
                      const errMsg = grantErrors[cap];
                      return errMsg ? <p className="text-xs text-red-400">{errMsg}</p> : null;
                    })()}
                  </>
                )}
                {b.kind === 'unsupported_capability' && (
                  <p className="text-xs text-gray-500 italic">
                    This capability is not supported on the current platform. It may become available after a system update or on a different platform.
                  </p>
                )}
                {b.kind === 'unknown_capability' && (
                  <p className="text-xs text-gray-500 italic">
                    This capability is not recognized by the current Go Core version. Check if the plugin or Core needs an update.
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Capability Status Table */}
      {checkResult.capabilities.length > 0 && (
        <div className="border-t border-gray-800 pt-4 mt-4">
          <h4 className="text-sm font-medium text-gray-300 mb-3">Capability Status</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-800">
                  <th className="pb-2 pr-4">Capability</th>
                  <th className="pb-2 pr-4">Support Level</th>
                  <th className="pb-2 pr-4">Supported</th>
                  <th className="pb-2 pr-4">Reason</th>
                  <th className="pb-2 pr-4">Grant Status</th>
                  <th className="pb-2">Blocker</th>
                </tr>
              </thead>
              <tbody>
                {checkResult.capabilities.map((cap, idx) => {
                  const capBlockers = checkResult.blockers.filter(
                    bl => bl.capability === cap.capability
                  );
                  const grantBlocker = capBlockers.find(bl => bl.kind === 'missing_grant');
                  const otherBlocker = capBlockers.find(bl => bl.kind !== 'missing_grant');
                  const grantApprovalState = grantApprovals[cap.capability];

                  return (
                    <tr key={idx} className="border-b border-gray-800/50 text-gray-300">
                      <td className="py-2 pr-4 font-mono text-xs text-gray-200">{cap.capability}</td>
                      <td className="py-2 pr-4">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          cap.level === 'full' ? 'bg-green-900/50 text-green-400' :
                          cap.level === 'partial' ? 'bg-yellow-900/50 text-yellow-400' :
                          cap.level === 'none' ? 'bg-red-900/50 text-red-400' :
                          'bg-gray-800 text-gray-500'
                        }`}>{cap.level}</span>
                      </td>
                      <td className="py-2 pr-4">
                        <span className={`text-xs ${cap.supported ? 'text-green-400' : 'text-red-400'}`}>
                          {cap.supported ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-xs text-gray-500 max-w-xs truncate">
                        {cap.reason || cap.detail || '—'}
                      </td>
                      <td className="py-2 pr-4">
                        {grantApprovalState ? (
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            grantApprovalState.status === 'requires_approval' ? 'bg-yellow-900/50 text-yellow-400' :
                            grantApprovalState.status === 'pending' ? 'bg-blue-900/50 text-blue-400' :
                            grantApprovalState.status === 'denied' ? 'bg-red-900/50 text-red-400' :
                            'bg-gray-800 text-gray-500'
                          }`}>
                            {grantApprovalState.status === 'requires_approval' ? 'needs approval' :
                             grantApprovalState.status === 'pending' ? 'awaiting...' :
                             grantApprovalState.status}
                          </span>
                        ) : grantBlocker ? (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-900/50 text-yellow-400">not granted</span>
                        ) : (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-green-900/50 text-green-400">granted</span>
                        )}
                      </td>
                      <td className="py-2">
                        {otherBlocker ? (
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            otherBlocker.kind === 'unsupported_capability' ? 'bg-red-900/50 text-red-400' :
                            'bg-orange-900/50 text-orange-400'
                          }`}>
                            {otherBlocker.kind}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-600">{'—'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Install Plan Flow */}
      {(install.planLoading || install.plan || install.executing || install.executionResult) && (
        <div className="border-t border-gray-800 pt-4 mt-4">
          <h4 className="text-sm font-medium text-gray-300 mb-3">Install Plan</h4>

          {install.planLoading && (
            <div className="text-gray-500 text-sm">Creating install plan...</div>
          )}

          {install.planError && (
            <p className="text-red-400 text-sm mb-2">{install.planError}</p>
          )}

          {install.plan && (
            <div className="space-y-3">
              {/* Plan summary */}
              <div className="px-3 py-2 bg-gray-900 rounded border border-gray-800 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Plan:</span>
                  <code className="text-xs text-gray-300">{str((install.plan as Record<string, unknown>).planId)}</code>
                  <RiskBadge risk={str((install.plan as Record<string, unknown>).risk)} />
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    str((install.plan as Record<string, unknown>).status) === 'pending_approval' ? 'bg-yellow-900/50 text-yellow-400' :
                    str((install.plan as Record<string, unknown>).status) === 'approved' ? 'bg-green-900/50 text-green-400' :
                    'bg-gray-800 text-gray-500'
                  }`}>
                    {str((install.plan as Record<string, unknown>).status)}
                  </span>
                </div>
                <p className="text-xs text-gray-400">{str((install.plan as Record<string, unknown>).summary)}</p>
              </div>

              {/* Steps */}
              {Array.isArray((install.plan as Record<string, unknown>).steps) && (
                <div className="space-y-1">
                  <span className="text-xs text-gray-500">Steps:</span>
                  {((install.plan as Record<string, unknown>).steps as Array<Record<string, unknown>>).map((step, idx) => (
                    <div key={idx} className="flex items-center gap-3 px-3 py-2 bg-gray-900 rounded border border-gray-800 text-xs">
                      <span className="text-gray-600 w-4">{str(step.order)}.</span>
                      <span className="text-gray-300 flex-1">{str(step.description)}</span>
                      <RiskBadge risk={str(step.risk)} />
                      <span className={`${
                        str(step.status) === 'completed' ? 'text-green-400' :
                        str(step.status) === 'running' ? 'text-blue-400' :
                        'text-gray-600'
                      }`}>{str(step.status)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                {/* Request Approval */}
                {!approvalStatus && !install.executing && str((install.plan as Record<string, unknown>).status) === 'pending_approval' && (
                  <button
                    onClick={requestApproval}
                    className="text-xs px-3 py-1.5 rounded bg-yellow-600 hover:bg-yellow-500 text-white transition-colors"
                  >
                    Request Approval
                  </button>
                )}

                {/* Approval pending: inline approve/deny */}
                {approvalStatus === 'pending' && approvalRequestId && (
                  <>
                    <span className="text-xs text-yellow-400">Awaiting approval ({approvalRequestId})</span>
                    <button onClick={approvePlan}
                      className="text-xs px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 text-white transition-colors"
                    >
                      Approve
                    </button>
                    <button onClick={denyPlan}
                      className="text-xs px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white transition-colors"
                    >
                      Deny
                    </button>
                  </>
                )}

                {/* Requesting */}
                {approvalStatus === 'requesting' && (
                  <span className="text-xs text-gray-400">Requesting approval...</span>
                )}

                {/* Approved: show Execute button */}
                {approvalStatus === 'approved' && (
                  <button
                    onClick={executePlan}
                    disabled={install.executing}
                    className="text-xs px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 text-white transition-colors disabled:opacity-50"
                  >
                    {install.executing ? 'Executing...' : 'Execute Install'}
                  </button>
                )}

                {/* Denied */}
                {approvalStatus === 'denied' && (
                  <span className="text-xs text-red-400">Plan denied. Re-run check and try again.</span>
                )}
              </div>

              {/* Execution result */}
              {install.executionResult && (
                <div className="space-y-1">
                  <div className={`text-xs px-3 py-2 rounded border ${
                    str(install.executionResult.status) === 'completed' ? 'bg-green-900/30 border-green-800 text-green-400' :
                    str(install.executionResult.status) === 'plan_not_approved' ? 'bg-yellow-900/30 border-yellow-800 text-yellow-400' :
                    'bg-gray-900 border-gray-800 text-gray-400'
                  }`}>
                    Status: {str(install.executionResult.status)}
                    {install.executionResult.steps !== undefined && (
                      <span className="ml-2">({String(install.executionResult.steps)} steps)</span>
                    )}
                    {!!install.executionResult.dryRun && <span className="ml-2 text-gray-500">(dry-run)</span>}
                  </div>
                  {str(install.executionResult.status) === 'plan_not_approved' && !!install.executionResult.message && (
                    <p className="text-xs text-yellow-400">{str(install.executionResult.message)}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Permissions Tab ────────────────────────────────────────────────

function PermissionsTab({ core, pluginId }: { core: CoreClient; pluginId: string }) {
  return <TabApiFetcher
    core={core} pluginId={pluginId}
    apiMethod="plugin.permissions.list"
    dataKey="permissions"
    renderTitle="Permissions"
    render={(items) => (
      <div className="space-y-3">
        {items.map((p, i) => (
          <div key={i} className="px-4 py-3 bg-gray-900 rounded-lg border border-gray-800">
            <div className="flex items-center gap-2 mb-1">
              <code className="text-sm text-gray-200 font-mono">{str(p.id)}</code>
              <DefaultBadge value={str(p.default)} />
              <GrantBadge grant={p.grant as Record<string, unknown> | undefined | null} />
            </div>
            <p className="text-xs text-gray-500 mb-2">{str(p.description)}</p>
            {Array.isArray(p.capabilities) && (
              <div className="flex flex-wrap gap-1">
                {(p.capabilities as string[]).map(cap => (
                  <span key={cap} className="text-xs px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded">{cap}</span>
                ))}
              </div>
            )}
            {!!p.constraints && (
              <details className="mt-2">
                <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-400">Constraints</summary>
                <pre className="text-xs text-gray-500 mt-1 bg-gray-950 p-2 rounded">{JSON.stringify(p.constraints, null, 2)}</pre>
              </details>
            )}
          </div>
        ))}
      </div>
    )}
  />;
}

function GrantBadge({ grant }: { grant: Record<string, unknown> | undefined | null }) {
  if (!grant) return <span className="text-xs text-gray-600">grant: not set</span>;
  const mode = str(grant.mode);
  const colors: Record<string, string> = {
    allow: 'bg-green-900/50 text-green-400',
    ask: 'bg-yellow-900/50 text-yellow-400',
    deny: 'bg-red-900/50 text-red-400',
  };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${colors[mode] || 'bg-gray-800 text-gray-500'}`}>
      grant: {mode}
    </span>
  );
}

function DefaultBadge({ value }: { value: string }) {
  const colors: Record<string, string> = {
    allow: 'bg-green-900/50 text-green-400',
    ask: 'bg-yellow-900/50 text-yellow-400',
    deny: 'bg-red-900/50 text-red-400',
  };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${colors[value] || 'bg-gray-800 text-gray-500'}`}>{value}</span>
  );
}

// ─── Files Tab ──────────────────────────────────────────────────────

function FilesTab({ core, pluginId }: { core: CoreClient; pluginId: string }) {
  return <TabApiFetcher
    core={core} pluginId={pluginId}
    apiMethod="plugin.files.list"
    dataKey="files"
    renderTitle="Files"
    render={(items) => (
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b border-gray-800">
            <th className="pb-2 pr-4">ID</th>
            <th className="pb-2 pr-4">Path</th>
            <th className="pb-2 pr-4">Purpose</th>
            <th className="pb-2">Clearable</th>
          </tr>
        </thead>
        <tbody>
          {items.map((f, i) => (
            <tr key={i} className="border-b border-gray-800/50 text-gray-300">
              <td className="py-2 pr-4 font-mono text-xs">{str(f.id)}</td>
              <td className="py-2 pr-4 font-mono text-xs text-gray-400 max-w-xs truncate">{str(f.path)}</td>
              <td className="py-2 pr-4 text-xs text-gray-500">{str(f.purpose) || str(f.description) || '—'}</td>
              <td className="py-2">{f.clearable ? <span className="text-xs text-yellow-400">yes</span> : <span className="text-xs text-gray-600">no</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  />;
}

// ─── Cache Tab ──────────────────────────────────────────────────────

function CacheTab({ core, pluginId }: { core: CoreClient; pluginId: string }) {
  const [cacheEntries, setCacheEntries] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [notImpl, setNotImpl] = useState(false);
  const [clearingId, setClearingId] = useState<string | null>(null);
  const [clearMsg, setClearMsg] = useState<string | null>(null);

  async function fetchCache() {
    setLoading(true);
    setFetchError(null);
    setNotImpl(false);
    setClearMsg(null);
    try {
      const result = await core.call<Record<string, unknown>>('plugin.cache.list', { pluginId });
      if (result?.status === 'not_implemented') {
        setNotImpl(true);
        setCacheEntries([]);
        setLoading(false);
        return;
      }
      const items = result?.caches;
      setCacheEntries(Array.isArray(items) ? items : []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      if (msg.includes('CAPABILITY_NOT_DECLARED')) {
        setNotImpl(true);
      } else {
        setFetchError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleClear(cacheId: string) {
    setClearingId(cacheId);
    setClearMsg(null);
    try {
      // Step 1: Ask Core for a clear plan
      const plan = await core.call<Record<string, unknown>>('plugin.cache.clear.plan', { pluginId, cacheId });

      // If plan is not_implemented or undefined, fall back to direct clear
      if (!plan || plan?.status === 'not_implemented') {
        try {
          await core.call('plugin.cache.clear', { pluginId, cacheId });
        } catch {
          setClearMsg('Cache clear not available');
          return;
        }
        setClearMsg('Cleared');
        return;
      }

      // Step 2: Show confirmation with plan summary
      const planStr = plan.summary ? String(plan.summary) : JSON.stringify(plan, null, 2);
      if (!window.confirm(`Cache Clear Plan:\n${planStr}\n\nProceed with clearing?`)) {
        setClearingId(null);
        return;
      }

      // Step 3: Execute the plan
      await core.call('plugin.cache.clear.execute', { pluginId, planId: plan.planId });
      setClearMsg('Cleared');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      setClearMsg(msg.includes('not_implemented') ? 'Cache clear not available' : msg);
    } finally {
      setClearingId(null);
    }
  }

  useEffect(() => { fetchCache(); }, [core, pluginId]);

  if (loading) return <div className="text-gray-500 text-sm">Loading cache...</div>;
  if (fetchError) return <p className="text-red-400 text-sm">{fetchError}</p>;
  if (notImpl) return <div className="text-gray-500 text-sm">Cache management is not available in Phase 1.</div>;
  if (cacheEntries.length === 0) return <PageEmpty title="No cache entries found" />;

  return (
    <div className="space-y-2">
      {cacheEntries.map((c, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3 bg-gray-900 rounded-lg border border-gray-800">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <code className="text-sm text-gray-200 font-mono">{str(c.id)}</code>
              {!!c.risk && <RiskBadge risk={str(c.risk)} />}
            </div>
            <p className="text-xs text-gray-500 mt-0.5 truncate">{str(c.path)}</p>
            {!!c.description && <p className="text-xs text-gray-600 mt-0.5">{str(c.description)}</p>}
          </div>
          <button
            onClick={() => handleClear(str(c.id))}
            disabled={clearingId === str(c.id)}
            className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 disabled:opacity-50 transition-colors"
          >
            {clearingId === str(c.id) ? '...' : 'Clear'}
          </button>
        </div>
      ))}
      {clearMsg && (
        <p className={`text-xs mt-2 ${clearMsg === 'Cleared' ? 'text-green-400' : 'text-gray-500'}`}>{clearMsg}</p>
      )}
    </div>
  );
}

function RiskBadge({ risk }: { risk: string }) {
  const colors: Record<string, string> = {
    low: 'bg-green-900/50 text-green-400',
    medium: 'bg-yellow-900/50 text-yellow-400',
    high: 'bg-red-900/50 text-red-400',
  };
  return <span className={`text-xs px-1.5 py-0.5 rounded ${colors[risk] || 'bg-gray-800 text-gray-500'}`}>{risk}</span>;
}

// ─── Settings Tab ───────────────────────────────────────────────────

function SettingsTab({ core, pluginId }: { core: CoreClient; pluginId: string }) {
  const [schema, setSchema] = useState<Record<string, unknown> | null>(null);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setFetchError(null);
      try {
        const [schemaRes, configRes] = await Promise.all([
          core.call<Record<string, unknown>>('plugin.config.schema', { pluginId }),
          core.call<Record<string, unknown>>('plugin.config.get', { pluginId }),
        ]);
        if (cancelled) return;
        setSchema((schemaRes?.schema as Record<string, unknown>) || null);
        setConfig((configRes?.config as Record<string, unknown>) || {});
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Failed to load settings';
        if (msg.includes('CAPABILITY_NOT_DECLARED')) {
          setSchema(null);
          setConfig({});
        } else {
          setFetchError(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [core, pluginId]);

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      await core.call('plugin.config.set', { pluginId, config });
      setSaveMsg('Saved');
      // Refresh config
      const configRes = await core.call<Record<string, unknown>>('plugin.config.get', { pluginId });
      setConfig((configRes?.config as Record<string, unknown>) || {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      setSaveMsg(msg.includes('not_implemented') ? 'Save not supported by Go Core' : msg);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-gray-500 text-sm">Loading settings...</div>;
  if (fetchError) return <p className="text-red-400 text-sm">{fetchError}</p>;
  if (!schema) return <div className="text-gray-500 text-sm">No configuration schema declared.</div>;

  const properties = (schema.properties as Record<string, unknown>) || {};
  const entries = Object.entries(properties);

  if (entries.length === 0) return <div className="text-gray-500 text-sm">No configuration properties defined.</div>;

  return (
    <div className="max-w-xl space-y-3">
      {entries.map(([key, prop]) => {
        const propObj = prop as Record<string, unknown>;
        const currentVal = config[key];
        return (
          <div key={key} className="px-4 py-3 bg-gray-900 rounded-lg border border-gray-800">
            <div className="flex items-center justify-between mb-1">
              <code className="text-sm text-gray-200 font-mono">{key}</code>
              <span className="text-xs text-gray-600">{String(propObj.type || 'string')}</span>
            </div>
            {!!propObj.description && <p className="text-xs text-gray-500 mb-2">{String(propObj.description)}</p>}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Current:</span>
              <code className="text-xs text-gray-300 bg-gray-800 px-2 py-0.5 rounded">
                {currentVal !== undefined ? JSON.stringify(currentVal) : '(not set)'}
              </code>
            </div>
            {Array.isArray(propObj.enum) && (
              <div className="mt-1 flex items-center gap-1">
                <span className="text-xs text-gray-600">enum:</span>
                {(propObj.enum as string[]).map(e => (
                  <span key={e} className="text-xs text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">{e}</span>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-xs px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save to Core'}
        </button>
        {saveMsg && (
          <span className={`text-xs ${saveMsg === 'Saved' ? 'text-green-400' : 'text-red-400'}`}>{saveMsg}</span>
        )}
      </div>
    </div>
  );
}

// ─── Logs Tab ───────────────────────────────────────────────────────

interface LogEntry {
  timestamp: string; level: string; message: string; source?: string;
}

function LogsTab({ core, pluginId }: { core: CoreClient; pluginId: string }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  async function fetchLogs() {
    setLoading(true);
    setFetchError(null);
    try {
      const result = await core.call<{ entries?: LogEntry[] }>('logs.query', { source: 'plugin', pluginId });
      setLogs(result?.entries || []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load logs';
      if (msg.includes('CAPABILITY_NOT_DECLARED')) {
        setLogs([]);
      } else {
        setFetchError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchLogs(); }, [core, pluginId]);

  if (loading) return <div className="text-gray-500 text-sm">Loading logs...</div>;
  if (fetchError) return <p className="text-red-400 text-sm">{fetchError}</p>;
  if (logs.length === 0) return <div className="text-gray-500 text-sm">No log entries found.</div>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <button onClick={fetchLogs}
          className="text-xs px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors"
        >
          Refresh
        </button>
      </div>
      <div className="space-y-1 max-h-96 overflow-y-auto font-mono text-xs">
        {logs.map((entry, i) => (
          <div key={i} className="flex gap-2 px-2 py-1 hover:bg-gray-900 rounded">
            <span className="text-gray-600 flex-shrink-0">{entry.timestamp}</span>
            <span className={`flex-shrink-0 ${
              entry.level === 'info' ? 'text-blue-400' :
              entry.level === 'warn' ? 'text-yellow-400' :
              entry.level === 'error' ? 'text-red-400' :
              'text-gray-500'
            }`}>{entry.level.toUpperCase()}</span>
            <span className="text-gray-400">{entry.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── History Tab ────────────────────────────────────────────────────

function HistoryTab({ core, pluginId }: { core: CoreClient; pluginId: string }) {
  const [events, setEvents] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [notImpl, setNotImpl] = useState(false);

  async function fetchHistory() {
    setLoading(true);
    setFetchError(null);
    setNotImpl(false);
    try {
      const result = await core.call<{ events?: Record<string, unknown>[]; status?: string }>('plugin.history', { pluginId });
      if (result?.status === 'not_implemented') {
        setNotImpl(true);
        setEvents([]);
      } else {
        setEvents(result?.events || []);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load history';
      if (msg.includes('CAPABILITY_NOT_DECLARED') || msg.includes('not_implemented')) {
        setNotImpl(true);
      } else {
        setFetchError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchHistory(); }, [core, pluginId]);

  if (loading) return <div className="text-gray-500 text-sm">Loading history...</div>;
  if (fetchError) return <p className="text-red-400 text-sm">{fetchError}</p>;
  if (notImpl) return <div className="text-gray-500 text-sm">History tracking is not implemented in Phase 1.</div>;
  if (events.length === 0) return <div className="text-gray-500 text-sm">No history events recorded.</div>;

  return (
    <div className="space-y-3">
      {events.map((evt, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-3 bg-gray-900 rounded-lg border border-gray-800">
          <div className="w-2 h-2 rounded-full bg-gray-600 mt-1.5 flex-shrink-0" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-200">{str(evt.action) || 'event'}</span>
              {!!evt.version && <span className="text-xs text-gray-600">v{str(evt.version)}</span>}
            </div>
            {!!evt.timestamp && <span className="text-xs text-gray-600">{str(evt.timestamp)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Shared API Fetcher Helper ──────────────────────────────────────

function TabApiFetcher({
  core, pluginId, apiMethod, dataKey, renderTitle, render,
}: {
  core: CoreClient; pluginId: string; apiMethod: string;
  dataKey: string; renderTitle: string;
  render: (data: Record<string, unknown>[]) => React.ReactNode;
}) {
  const [data, setData] = useState<Record<string, unknown>[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [permDenied, setPermDenied] = useState(false);
  const [notImpl, setNotImpl] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setFetchError(null);
      setPermDenied(false);
      setNotImpl(false);
      try {
        const result = await core.call<Record<string, unknown>>(apiMethod, { pluginId });
        if (cancelled) return;
        if (result?.status === 'not_implemented') {
          setNotImpl(true);
          setData([]);
          setLoading(false);
          return;
        }
        const items = result?.[dataKey];
        setData(Array.isArray(items) ? items : []);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Failed';
        if (msg.includes('CAPABILITY_NOT_DECLARED') || msg.includes('permission_denied') || msg.includes('not permitted')) {
          setPermDenied(true);
        } else {
          setFetchError(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [core, pluginId, apiMethod, dataKey]);

  if (loading) return <div className="text-gray-500 text-sm">Loading {renderTitle.toLowerCase()}...</div>;
  if (permDenied) return <PagePermissionDenied />;
  if (notImpl) return <div className="text-gray-500 text-sm">This feature is not available in Phase 1.</div>;
  if (fetchError) return (
    <div>
      <p className="text-red-400 text-sm mb-2">{fetchError}</p>
      <p className="text-xs text-gray-600">Core API: {apiMethod} — may not be supported by Go Core.</p>
    </div>
  );
  if (!data || data.length === 0) return <PageEmpty title={`No ${renderTitle.toLowerCase()} found`} />;

  return <>{render(data)}</>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-gray-400 mb-2">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function safeArray(val: unknown): Record<string, unknown>[] {
  if (Array.isArray(val)) return val as Record<string, unknown>[];
  return [];
}

function str(val: unknown): string {
  if (typeof val === 'string') return val;
  if (val === null || val === undefined) return '';
  return String(val);
}
