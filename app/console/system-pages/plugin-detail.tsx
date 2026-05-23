'use client';

import React, { useState, useEffect } from 'react';
import type { CoreClient, BlockerEntry } from '../core/core-types';
import { PageLoading, PageError, PageEmpty, PageOffline, PagePermissionDenied, type PageState } from './page-utils';
import { getAllViewEntries } from '../main/view-registry';
import { isViewLaunchable } from '../plugin-host/launchability';

interface PluginDetailProps {
  core: CoreClient;
  pluginId: string;
  onBack?: () => void;
}

type DetailTab =
  | 'overview'
  | 'environment'
  | 'capabilities'
  | 'permissions'
  | 'approvals'
  | 'install'
  | 'config'
  | 'files'
  | 'cache'
  | 'runs'
  | 'logs'
  | 'history'
  | 'raw';

const TABS: { id: DetailTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'environment', label: 'Environment' },
  { id: 'capabilities', label: 'Capabilities' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'install', label: 'Install' },
  { id: 'config', label: 'Config' },
  { id: 'files', label: 'Files' },
  { id: 'cache', label: 'Cache' },
  { id: 'runs', label: 'Runs' },
  { id: 'logs', label: 'Logs' },
  { id: 'history', label: 'History' },
  { id: 'raw', label: 'Raw Manifest' },
];

export function PluginDetail({ core, pluginId, onBack = () => {} }: PluginDetailProps) {
  const [pageState, setPageState] = useState<PageState>('loading');
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

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

  async function handleToggle() {
    const currentStatus = str(manifest?.status);
    setToggling(true);
    setToggleError(null);
    try {
      if (currentStatus === 'enabled') {
        await core.call('plugin.disable', { pluginId });
      } else {
        await core.call('plugin.enable', { pluginId });
      }
      await fetchPlugin();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Toggle failed';
      setToggleError(msg.includes('not_implemented') ? 'Toggle not supported by Go Core' : msg);
    } finally {
      setToggling(false);
    }
  }

  useEffect(() => {
    fetchPlugin();
  }, [core, pluginId]);

  if (pageState === 'loading') return <div className="flex-1"><PageLoading rows={8} /></div>;
  if (pageState === 'offline') return <div className="flex-1"><PageOffline /></div>;
  if (pageState === 'permission_denied') return <div className="flex-1"><PagePermissionDenied /></div>;
  if (pageState === 'error') return <div className="flex-1"><PageError message={error || 'Unknown error'} onRetry={fetchPlugin} /></div>;

  const isBuiltin = str(manifest?.type) === 'builtin';

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-1.5 border-b border-gray-800">
        <button onClick={onBack} className="text-[10px] text-purple-400 hover:text-purple-300 transition-colors">
          &lt; Plugin Manager
        </button>
        <h1 className="text-[11px] font-mono text-gray-100">{pluginId}</h1>
        {manifest && (
          <>
            <span className="text-[9px] text-gray-500 bg-[#1a1a1a] px-1.5 py-0.5 rounded">
              {str(manifest.version)}
            </span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded ${
              str(manifest.status) === 'enabled'
                ? 'bg-emerald-900/20 text-emerald-400'
                : 'bg-[#1a1a1a] text-gray-500'
            }`}>
              {str(manifest.status) || 'unknown'}
            </span>
          </>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          {toggleError && <span className="text-[9px] text-red-400">{toggleError}</span>}
          <button
            onClick={fetchPlugin}
            className="text-[9px] px-3 py-1.5 rounded bg-[#1a1a1a] hover:bg-[#222] text-gray-400 transition-colors"
            title="Refresh plugin data"
          >
            Refresh
          </button>
          {!isBuiltin && (
            <button
              onClick={handleToggle}
              disabled={toggling}
              className={`text-[9px] px-3 py-1.5 rounded transition-colors disabled:opacity-50 ${
                str(manifest?.status) === 'enabled'
                  ? 'bg-red-900/20 hover:bg-red-900/40 text-red-400'
                  : 'bg-emerald-900/20 hover:bg-emerald-900/40 text-emerald-400'
              }`}
            >
              {toggling ? '...' : (str(manifest?.status) === 'enabled' ? 'Disable' : 'Enable')}
            </button>
          )}
          {isBuiltin && <span className="text-[9px] text-gray-600">builtin — always on</span>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 px-4 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-[10px] font-mono whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 p-4">
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
    case 'overview': return <OverviewTab pluginId={pluginId} manifest={manifest} />;
    case 'environment': return <EnvironmentTab core={core} pluginId={pluginId} />;
    case 'capabilities': return <CapabilitiesTab core={core} pluginId={pluginId} />;
    case 'permissions': return <PermissionsTab core={core} pluginId={pluginId} />;
    case 'approvals': return <ApprovalsTab core={core} pluginId={pluginId} />;
    case 'install': return <InstallTab core={core} pluginId={pluginId} />;
    case 'config': return <ConfigTab core={core} pluginId={pluginId} />;
    case 'files': return <FilesTab core={core} pluginId={pluginId} />;
    case 'cache': return <CacheTab core={core} pluginId={pluginId} />;
    case 'runs': return <RunsTab core={core} pluginId={pluginId} />;
    case 'logs': return <LogsTab core={core} pluginId={pluginId} />;
    case 'history': return <HistoryTab core={core} pluginId={pluginId} />;
    case 'raw': return <RawTab manifest={manifest} />;
  }
}

// ─── Overview ─────────────────────────────────────────────────────

function OverviewTab({ pluginId, manifest }: { pluginId: string; manifest: Record<string, unknown> | null }) {
  if (!manifest) return <div className="text-gray-500 text-[10px]">No manifest data available.</div>;

  const contributes = (manifest.contributes || {}) as Record<string, unknown>;
  const manifestViews = safeArray(contributes.views);
  const manifestPanels = safeArray(contributes.panels);

  // Build a set of view IDs declared by this plugin's manifest
  const pluginViewIds = new Set(manifestViews.map((v: Record<string, unknown>) => str(v.id)));

  // Check launchable from manifest contributes, cross-referenced with view registry.
  // Uses the shared isViewLaunchable helper to keep parity with ViewSelector and PluginManager.
  let launchable = false;
  let launchableViews: string[] = [];
  const otherViews: string[] = [];
  for (const [vid, entry] of getAllViewEntries()) {
    // Only consider views declared by THIS plugin's manifest
    if (!pluginViewIds.has(vid)) continue;
    if (isViewLaunchable(entry.meta)) {
      launchable = true;
      launchableViews.push(vid);
    } else if (vid !== 'empty') {
      otherViews.push(vid);
    }
  }

  const caps = safeArray(manifest.capabilities);

  return (
    <div className="max-w-2xl space-y-5">
      {/* Basic info */}
      <Section title="Basic Info">
        <InfoRow label="Plugin ID" value={pluginId} />
        <InfoRow label="Version" value={str(manifest.version)} />
        <InfoRow label="Name" value={str(manifest.name)} />
        <InfoRow label="Description" value={str(manifest.description) || '—'} />
        <InfoRow label="Type" value={str(manifest.type) || 'feature'} />
        <InfoRow label="Status" value={str(manifest.status) || 'unknown'} />
        <InfoRow label="Enabled" value={str(manifest.enabled)} />
      </Section>

      {/* Launchable status */}
      <Section title="Tab / Window">
        <div className="flex items-center gap-2 text-[10px]">
          <span className={launchable ? 'text-emerald-400' : 'text-gray-500'}>
            Can open as tab: {launchable ? 'Yes' : 'No'}
          </span>
        </div>
        {launchable ? (
          <p className="text-[9px] text-emerald-400/70 mt-1">
            Has {launchableViews.length} launchable view{launchableViews.length > 1 ? 's' : ''}: {launchableViews.join(', ')}
          </p>
        ) : (
          <p className="text-[9px] text-gray-500 mt-1">
            No direct-launchable view declared. Plugin {otherViews.length > 0 ? `contributes ${otherViews.join(', ')} (non-direct)` : 'has no registered views'}.
          </p>
        )}
      </Section>

      {/* Contributes summary */}
      {(manifestViews.length > 0 || manifestPanels.length > 0) && (
        <Section title="Contributions">
          {manifestViews.length > 0 && (
            <div className="text-[9px] text-gray-400">
              <span className="text-gray-500">Views:</span>{' '}
              {manifestViews.map((v: Record<string, unknown>) => str(v.id)).join(', ')}
            </div>
          )}
          {manifestPanels.length > 0 && (
            <div className="text-[9px] text-gray-400">
              <span className="text-gray-500">Panels:</span>{' '}
              {manifestPanels.map((p: Record<string, unknown>) => str(p.id)).join(', ')}
            </div>
          )}
        </Section>
      )}

      {/* Capability summary */}
      {caps.length > 0 && (
        <Section title={`Declared Capabilities (${caps.length})`}>
          <div className="flex flex-wrap gap-1">
            {caps.map((cap: Record<string, unknown>, idx: number) => (
              <span key={idx} className="text-[10px] px-2 py-0.5 bg-[#1a1a1a] text-gray-400 rounded">
                {str(cap.id) || str(cap)}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Last error */}
      {!!manifest.error && (
        <Section title="Last Error">
          <p className="text-[9px] text-red-400">{str(manifest.error)}</p>
        </Section>
      )}
    </div>
  );
}

// ─── Environment ──────────────────────────────────────────────────

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
        <h3 className="text-[10px] font-mono text-gray-300">Environment Check</h3>
        <button onClick={runCheck} disabled={loading}
          className="text-[9px] px-3 py-1 rounded bg-[#1a1a1a] hover:bg-[#222] text-gray-400 transition-colors disabled:opacity-50"
        >
          {loading ? 'Running...' : 'Run Check Again'}
        </button>
        {data && (
          <span className={`text-[9px] px-2 py-0.5 rounded ${
            data.status === 'ok' ? 'bg-emerald-900/20 text-emerald-400' : 'bg-yellow-900/50 text-yellow-400'
          }`}>
            {data.status}
          </span>
        )}
      </div>

      {fetchError && <p className="text-red-400 text-[10px] mb-3">{fetchError}</p>}

      {!data ? (
        <div className="text-gray-500 text-[10px]">Running check...</div>
      ) : !data.dependencies || data.dependencies.length === 0 ? (
        <div className="text-gray-500 text-[10px]">No dependencies.</div>
      ) : (
        <div className="space-y-2">
          {data.dependencies.map((dep, i) => {
            const isMissingRequired = !!dep.required && dep.status !== 'ok';
            return (
            <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded border text-[10px] ${
              isMissingRequired
                ? 'bg-red-950/30 border-red-900/50'
                : 'bg-[#111] border-gray-800'
            }`}>
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                dep.status === 'ok' ? 'bg-emerald-500' :
                dep.status === 'skipped' ? 'bg-gray-600' :
                dep.status === 'pending' ? 'bg-yellow-500' : 'bg-red-500'
              }`} />
              <span className="text-gray-200 font-mono">{dep.id}</span>
              <span className="text-[9px] text-gray-500">({dep.type})</span>
              {dep.command && <span className="text-[9px] text-gray-600">cmd: {dep.command}</span>}
              {dep.required && (
                <span className={`text-[9px] ${isMissingRequired ? 'text-red-400 font-mono' : 'text-red-400/70'}`}>
                  required{isMissingRequired ? ' (missing)' : ''}
                </span>
              )}
              {dep.versionCommand && <span className="text-[9px] text-gray-600">ver: {dep.versionCommand}</span>}
              {dep.requiredVersion && <span className="text-[9px] text-gray-600">≥ {dep.requiredVersion}</span>}
              {dep.installHint && (
                <span className="text-[9px] text-purple-400/70 ml-auto" title={dep.installHint}>
                  install hint
                </span>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Capabilities ─────────────────────────────────────────────────

interface CapEntry {
  capability: string;
  supported: boolean;
  level: string;
  reason?: string;
  detail?: string;
}

function CapabilitiesTab({ core, pluginId }: { core: CoreClient; pluginId: string }) {
  const [checkResult, setCheckResult] = useState<{ status: string; blockers: BlockerEntry[]; capabilities: CapEntry[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

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

  useEffect(() => { runCheck(); }, [core, pluginId]);

  if (loading) return <div className="text-gray-500 text-[10px]">Checking capabilities...</div>;
  if (fetchError) return (
    <div>
      <p className="text-red-400 text-[10px] mb-2">{fetchError}</p>
      <button onClick={runCheck} className="text-[9px] px-3 py-1 rounded bg-[#1a1a1a] hover:bg-[#222] text-gray-400">Retry</button>
    </div>
  );
  if (!checkResult) return null;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-[10px] font-mono text-gray-300">Capability Status</h3>
        <button onClick={runCheck} disabled={loading}
          className="text-[9px] px-3 py-1 rounded bg-[#1a1a1a] hover:bg-[#222] text-gray-400 transition-colors disabled:opacity-50"
        >
          {loading ? 'Running...' : 'Re-check'}
        </button>
        <span className={`text-[9px] px-2 py-0.5 rounded ${
          checkResult.status === 'ok' ? 'bg-emerald-900/20 text-emerald-400' :
          checkResult.status === 'blocked' ? 'bg-red-900/20 text-red-400' :
          'bg-yellow-900/50 text-yellow-400'
        }`}>
          {checkResult.status}
        </span>
      </div>

      {checkResult.blockers.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-[9px] font-mono text-red-400">Blockers ({checkResult.blockers.length})</h4>
          {checkResult.blockers.map((b, i) => (
            <div key={i} className="px-3 py-2 bg-[#111] rounded border border-gray-800 text-[9px] space-y-1">
              <div className="flex items-center gap-2">
                <span className={`px-1.5 py-0.5 rounded ${
                  b.kind === 'missing_dependency' ? 'bg-red-900/20 text-red-400' :
                  b.kind === 'missing_grant' ? 'bg-yellow-900/50 text-yellow-400' :
                  b.kind === 'unsupported_capability' ? 'bg-red-900/20 text-red-400' :
                  b.kind === 'unknown_capability' ? 'bg-orange-900/50 text-orange-400' :
                  'bg-[#1a1a1a] text-gray-500'
                }`}>
                  {b.kind}
                </span>
                <code className="text-gray-200">{b.capability || b.dependency || '(unknown)'}</code>
              </div>
              <p className="text-gray-500">Reason: {b.reason}</p>
            </div>
          ))}
        </div>
      )}

      {checkResult.capabilities.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-800">
                <th className="pb-2 pr-4">Capability</th>
                <th className="pb-2 pr-4">Platform</th>
                <th className="pb-2 pr-4">Level</th>
                <th className="pb-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {checkResult.capabilities.map((cap, idx) => (
                <tr key={idx} className="border-b border-gray-800/50 text-gray-300">
                  <td className="py-2 pr-4 font-mono text-[9px] text-gray-200">{cap.capability}</td>
                  <td className="py-2 pr-4">
                    <span className={`text-[9px] ${cap.supported ? 'text-emerald-400' : 'text-red-400'}`}>
                      {cap.supported ? 'supported' : 'unsupported'}
                    </span>
                  </td>
                  <td className="py-2 pr-4">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                      cap.level === 'full' ? 'bg-emerald-900/20 text-emerald-400' :
                      cap.level === 'partial' ? 'bg-yellow-900/50 text-yellow-400' :
                      cap.level === 'none' ? 'bg-red-900/20 text-red-400' :
                      'bg-[#1a1a1a] text-gray-500'
                    }`}>{cap.level}</span>
                  </td>
                  <td className="py-2 text-[9px] text-gray-500 max-w-xs truncate">
                    {cap.reason || cap.detail || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {checkResult.blockers.length === 0 && checkResult.capabilities.length === 0 && (
        <div className="text-gray-500 text-[10px]">No blockers. All declared capabilities are supported.</div>
      )}
    </div>
  );
}

// ─── Permissions ──────────────────────────────────────────────────

/** Normalize response shapes: [], { primaryKey: [] }, { fallbackKey1: [] }, { fallbackKey2: [] }, etc. */
function listFromResponse(result: Record<string, unknown> | unknown, primaryKey: string, ...fallbackKeys: string[]): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const obj = result as Record<string, unknown> | null | undefined;
  if (!obj) return [];
  const primary = obj[primaryKey];
  if (Array.isArray(primary)) return primary as Record<string, unknown>[];
  for (const key of fallbackKeys) {
    const fb = obj[key];
    if (Array.isArray(fb)) return fb as Record<string, unknown>[];
  }
  return [];
}

function PermissionsTab({ core, pluginId }: { core: CoreClient; pluginId: string }) {
  const [permissions, setPermissions] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [permDenied, setPermDenied] = useState(false);
  const [notImpl, setNotImpl] = useState(false);
  // Per-row grant/revoke state: keyed by permission id
  const [grantState, setGrantState] = useState<Record<string, {
    loading: boolean;
    error: string | null;
    approvalStatus?: string | null; // 'requires_approval' | 'requesting' | 'pending' | 'approved' | 'denied'
    planId?: string | null;
    requestId?: string | null;
  }>>({});

  async function fetchPermissions() {
    setLoading(true);
    setFetchError(null);
    setPermDenied(false);
    setNotImpl(false);
    try {
      const result = await core.call<Record<string, unknown>>('plugin.permissions.list', { pluginId });
      if (result?.status === 'not_implemented') {
        setNotImpl(true);
        setPermissions([]);
        return;
      }
      const items = listFromResponse(result, 'permissions', 'grants');
      setPermissions(items);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      if (msg.includes('CAPABILITY_NOT_DECLARED') || msg.includes('permission_denied') || msg.includes('not permitted')) {
        setPermDenied(true);
      } else {
        setFetchError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleGrant(permId: string, perm: Record<string, unknown>) {
    setGrantState(prev => ({ ...prev, [permId]: { loading: true, error: null, approvalStatus: null, planId: null, requestId: null } }));
    try {
      const caps = Array.isArray(perm.capabilities) ? (perm.capabilities as string[]) : [];
      const capability = caps[0] || str(perm.id);
      const result = await core.call<Record<string, unknown>>('plugin.permissions.grant', { pluginId, capability, mode: 'allow' });

      if ((result?.status as string) === 'requires_approval') {
        const planId = (result?.planId as string) || null;
        if (!planId) {
          setGrantState(prev => ({ ...prev, [permId]: { loading: false, error: 'Approval required but no planId returned from Core.' } }));
          return;
        }
        setGrantState(prev => ({ ...prev, [permId]: { loading: false, error: null, approvalStatus: 'requires_approval', planId } }));
        return;
      }

      // Immediate grant success (status: "granted" or undefined/other)
      await fetchPermissions();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Grant failed';
      setGrantState(prev => ({ ...prev, [permId]: { loading: false, error: msg } }));
    }
  }

  async function handleRequestApproval(permId: string) {
    const state = grantState[permId];
    if (!state?.planId) {
      setGrantState(prev => ({ ...prev, [permId]: { ...prev[permId], error: 'Missing planId — cannot request approval.' } }));
      return;
    }
    setGrantState(prev => ({ ...prev, [permId]: { ...prev[permId], loading: true, approvalStatus: 'requesting', error: null } }));
    try {
      const res = await core.call<Record<string, unknown>>('notify.request', {
        title: `Grant permission ${permId} for ${pluginId}`,
        body: `Permission grant requires approval for ${pluginId}`,
        planId: state.planId,
        kind: 'approval',
        timeout: 300,
      });
      const requestId = (res?.requestId as string) || null;
      if (!requestId) {
        setGrantState(prev => ({ ...prev, [permId]: { ...prev[permId], loading: false, error: 'notify.request succeeded but no requestId returned.' } }));
        return;
      }
      setGrantState(prev => ({ ...prev, [permId]: { ...prev[permId], loading: false, approvalStatus: 'pending', requestId, error: null } }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Approval request failed';
      setGrantState(prev => ({ ...prev, [permId]: { ...prev[permId], loading: false, error: msg } }));
    }
  }

  async function handleApproveGrant(permId: string, perm: Record<string, unknown>) {
    const state = grantState[permId];
    if (!state?.requestId) {
      setGrantState(prev => ({ ...prev, [permId]: { ...prev[permId], error: 'Missing requestId — cannot approve.' } }));
      return;
    }
    setGrantState(prev => ({ ...prev, [permId]: { ...prev[permId], loading: true, error: null } }));
    try {
      await core.call('notify.respond', { requestId: state.requestId, action: 'allow' });
      // Re-call grant with planId to complete the approved grant
      const caps = Array.isArray(perm.capabilities) ? (perm.capabilities as string[]) : [];
      const capability = caps[0] || str(perm.id);
      await core.call('plugin.permissions.grant', { pluginId, capability, mode: 'allow', planId: state.planId });
      setGrantState(prev => ({ ...prev, [permId]: { ...prev[permId], loading: false, approvalStatus: 'approved' } }));
      await fetchPermissions();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Approval failed';
      setGrantState(prev => ({ ...prev, [permId]: { ...prev[permId], loading: false, error: msg } }));
    }
  }

  async function handleDenyGrant(permId: string) {
    const state = grantState[permId];
    if (!state?.requestId) {
      setGrantState(prev => ({ ...prev, [permId]: { ...prev[permId], error: 'Missing requestId — cannot deny.' } }));
      return;
    }
    setGrantState(prev => ({ ...prev, [permId]: { ...prev[permId], loading: true, error: null } }));
    try {
      await core.call('notify.respond', { requestId: state.requestId, action: 'deny' });
      setGrantState(prev => ({ ...prev, [permId]: { ...prev[permId], loading: false, approvalStatus: 'denied' } }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Deny failed';
      setGrantState(prev => ({ ...prev, [permId]: { ...prev[permId], loading: false, error: msg } }));
    }
  }

  async function handleRevoke(permId: string, perm: Record<string, unknown>) {
    setGrantState(prev => ({ ...prev, [permId]: { loading: true, error: null, approvalStatus: null, planId: null, requestId: null } }));
    try {
      const caps = Array.isArray(perm.capabilities) ? (perm.capabilities as string[]) : [];
      const capability = caps[0] || str(perm.id);
      await core.call('plugin.permissions.revoke', { pluginId, capability });
      await fetchPermissions();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Revoke failed';
      setGrantState(prev => ({ ...prev, [permId]: { loading: false, error: msg } }));
    }
  }

  useEffect(() => { fetchPermissions(); }, [core, pluginId]);

  if (loading) return <div className="text-gray-500 text-[10px]">Loading permissions...</div>;
  if (permDenied) return <PagePermissionDenied />;
  if (notImpl) return <div className="text-gray-500 text-[10px]">Permission management is not available in Phase 1.</div>;
  if (fetchError) return <p className="text-red-400 text-[10px]">{fetchError}</p>;
  if (permissions.length === 0) return <PageEmpty title="No permissions found" />;

  return (
    <div className="space-y-1.5">
      {permissions.map((p, i) => {
        const pid = str(p.id);
        const rowState = grantState[pid] || { loading: false, error: null };
        const grantMode = (p.grant as Record<string, unknown> | undefined)?.mode;
        const canGrant = grantMode !== 'allow';
        const canRevoke = grantMode === 'allow';
        return (
          <div key={i} className="px-4 py-1.5 bg-[#111] rounded border border-gray-800">
            <div className="flex items-center gap-2 mb-1">
              <code className="text-[10px] text-gray-200 font-mono">{pid}</code>
              <DefaultBadge value={str(p.default)} />
              <GrantBadge grant={p.grant as Record<string, unknown> | undefined | null} />
            </div>
            <p className="text-[9px] text-gray-500 mb-2">{str(p.description)}</p>
            {Array.isArray(p.capabilities) && (
              <div className="flex flex-wrap gap-1 mb-2">
                {(p.capabilities as string[]).map(cap => (
                  <span key={cap} className="text-[9px] px-1.5 py-0.5 bg-[#1a1a1a] text-gray-400 rounded">{cap}</span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Approval flow UI */}
              {rowState.approvalStatus === 'requires_approval' && (
                <>
                  <span className="text-[9px] text-yellow-400">Requires approval</span>
                  {rowState.planId && <span className="text-[9px] text-gray-500">{rowState.planId}</span>}
                  <button
                    onClick={() => handleRequestApproval(pid)}
                    disabled={rowState.loading}
                    className="text-[9px] px-2 py-1 rounded bg-yellow-900/50 hover:bg-yellow-800/50 text-yellow-400 transition-colors disabled:opacity-50"
                  >
                    {rowState.loading ? '...' : 'Request Approval'}
                  </button>
                </>
              )}
              {rowState.approvalStatus === 'requesting' && (
                <span className="text-[9px] text-gray-400">Requesting approval...</span>
              )}
              {rowState.approvalStatus === 'pending' && (
                <>
                  <span className="text-[9px] text-yellow-400">Awaiting approval</span>
                  {rowState.requestId && <span className="text-[9px] text-gray-600">({rowState.requestId})</span>}
                  <button
                    onClick={() => handleApproveGrant(pid, p)}
                    disabled={rowState.loading}
                    className="text-[9px] px-2 py-1 rounded bg-emerald-900/20 hover:bg-emerald-900/40 text-white transition-colors disabled:opacity-50"
                  >
                    {rowState.loading ? '...' : 'Approve'}
                  </button>
                  <button
                    onClick={() => handleDenyGrant(pid)}
                    disabled={rowState.loading}
                    className="text-[9px] px-2 py-1 rounded bg-red-700 hover:bg-red-600 text-white transition-colors disabled:opacity-50"
                  >
                    {rowState.loading ? '...' : 'Deny'}
                  </button>
                </>
              )}
              {rowState.approvalStatus === 'approved' && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-900/20 text-emerald-400">Grant approved</span>
              )}
              {rowState.approvalStatus === 'denied' && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-900/20 text-red-400">Grant denied</span>
              )}
              {/* Default grant/revoke buttons (when no approval flow active) */}
              {!rowState.approvalStatus && canGrant && (
                <button
                  onClick={() => handleGrant(pid, p)}
                  disabled={rowState.loading}
                  className="text-[9px] px-2 py-1 rounded bg-emerald-900/20 hover:bg-emerald-900/40 text-emerald-400 transition-colors disabled:opacity-50"
                >
                  {rowState.loading ? '...' : 'Grant Allow'}
                </button>
              )}
              {!rowState.approvalStatus && canRevoke && (
                <button
                  onClick={() => handleRevoke(pid, p)}
                  disabled={rowState.loading}
                  className="text-[9px] px-2 py-1 rounded bg-red-900/20 hover:bg-red-900/40 text-red-400 transition-colors disabled:opacity-50"
                >
                  {rowState.loading ? '...' : 'Revoke'}
                </button>
              )}
              {rowState.error && (
                <span className="text-[9px] text-red-400">{rowState.error}</span>
              )}
            </div>
            {!!p.constraints && (
              <details className="mt-2">
                <summary className="text-[9px] text-gray-600 cursor-pointer hover:text-gray-400">Constraints</summary>
                <pre className="text-[9px] text-gray-500 mt-1 bg-[#0a0a0a] p-2 rounded">{JSON.stringify(p.constraints, null, 2)}</pre>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GrantBadge({ grant }: { grant: Record<string, unknown> | undefined | null }) {
  if (!grant) return <span className="text-[9px] text-gray-600">grant: not set</span>;
  const mode = str(grant.mode);
  const colors: Record<string, string> = {
    allow: 'bg-emerald-900/20 text-emerald-400',
    ask: 'bg-yellow-900/50 text-yellow-400',
    deny: 'bg-red-900/20 text-red-400',
  };
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded ${colors[mode] || 'bg-[#1a1a1a] text-gray-500'}`}>
      grant: {mode}
    </span>
  );
}

function DefaultBadge({ value }: { value: string }) {
  const colors: Record<string, string> = {
    allow: 'bg-emerald-900/20 text-emerald-400',
    ask: 'bg-yellow-900/50 text-yellow-400',
    deny: 'bg-red-900/20 text-red-400',
  };
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded ${colors[value] || 'bg-[#1a1a1a] text-gray-500'}`}>{value}</span>
  );
}

// ─── Approvals ────────────────────────────────────────────────────

function ApprovalsTab({ core, pluginId }: { core: CoreClient; pluginId: string }) {
  const [requests, setRequests] = useState<Array<{ requestId: string; title: string; status: string; pluginId?: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const result = await core.call<Record<string, unknown>>('approval.list');
        if (cancelled) return;
        // Normalize: primary contract is { approvals: [...] }, fallback { requests: [...] } or []
        const all = listFromResponse(result, 'approvals', 'requests');
        // Filter to current pluginId: use pluginId field first, title includes as fallback
        const filtered = all.filter((r: Record<string, unknown>) => {
          if (r.pluginId && str(r.pluginId) === pluginId) return true;
          return str(r.title).includes(pluginId);
        });
        setRequests(filtered as Array<{ requestId: string; title: string; status: string; pluginId?: string }>);
      } catch {
        if (!cancelled) setRequests([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [core, pluginId]);

  if (loading) return <div className="text-gray-500 text-[10px]">Loading approvals...</div>;

  if (requests.length === 0) {
    return <div className="text-gray-500 text-[10px]">No pending approvals for this plugin.</div>;
  }

  return (
    <div className="space-y-2">
      {requests.map((r, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-1.5 bg-[#111] rounded border border-gray-800">
          <div className="flex-1">
            <div className="text-[10px] text-gray-200">{r.title}</div>
            <div className="text-[9px] text-gray-500">ID: {r.requestId}</div>
          </div>
          <span className={`text-[9px] px-2 py-0.5 rounded ${
            r.status === 'pending' ? 'bg-yellow-900/50 text-yellow-400' :
            r.status === 'approved' ? 'bg-emerald-900/20 text-emerald-400' :
            'bg-[#1a1a1a] text-gray-500'
          }`}>
            {r.status}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Install ──────────────────────────────────────────────────────

interface InstallState {
  plan: Record<string, unknown> | null;
  planLoading: boolean;
  planError: string | null;
  executing: boolean;
  executionResult: Record<string, unknown> | null;
}

function InstallTab({ core, pluginId }: { core: CoreClient; pluginId: string }) {
  const [install, setInstall] = useState<InstallState>({
    plan: null, planLoading: false, planError: null, executing: false, executionResult: null,
  });
  const [approvalRequestId, setApprovalRequestId] = useState<string | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<string | null>(null);

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
    const planId = str((install.plan as Record<string, unknown>).planId);
    if (!planId) {
      setInstall(prev => ({ ...prev, planError: 'Plan ID is missing — cannot request approval.' }));
      return;
    }
    setApprovalStatus('requesting');
    try {
      const res = await core.call<Record<string, unknown>>('notify.request', {
        title: `Install ${pluginId}`,
        body: str((install.plan as Record<string, unknown>).summary) || `Install plan for ${pluginId}`,
        planId,
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
    const planId = str((install.plan as Record<string, unknown>).planId);
    if (!planId) {
      setInstall(prev => ({ ...prev, planError: 'Plan ID is missing — cannot execute.' }));
      return;
    }
    setInstall(prev => ({ ...prev, executing: true, executionResult: null, planError: null }));
    try {
      const result = await core.call<Record<string, unknown>>('plugin.install.execute', { planId });
      if (str(result?.status) === 'not_implemented') {
        setInstall(prev => ({ ...prev, executing: false, planError: 'Execution not implemented by Core yet' }));
      } else {
        setInstall(prev => ({ ...prev, executing: false, executionResult: result ?? null }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Execution failed';
      setInstall(prev => ({
        ...prev, executing: false,
        planError: msg.includes('not_implemented') ? 'Execution not implemented by Core yet' : msg,
      }));
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-[10px] font-mono text-gray-300">Install Plan</h3>
        <button
          onClick={createInstallPlan}
          disabled={install.planLoading}
          className="text-[9px] px-3 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-white transition-colors disabled:opacity-50"
        >
          {install.planLoading ? 'Creating...' : 'Create Install Plan'}
        </button>
      </div>

      <p className="text-[9px] text-gray-600">
        Install execution is not implemented by Core yet. Plan can be viewed but not executed.
      </p>

      {install.planError && <p className="text-red-400 text-[10px]">{install.planError}</p>}

      {install.plan && (
        <div className="space-y-1.5">
          <div className="px-3 py-2 bg-[#111] rounded border border-gray-800 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-gray-500">Plan:</span>
              <code className="text-[9px] text-gray-300">{str((install.plan as Record<string, unknown>).planId)}</code>
              <RiskBadge risk={str((install.plan as Record<string, unknown>).risk)} />
              <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                str((install.plan as Record<string, unknown>).status) === 'pending_approval' ? 'bg-yellow-900/50 text-yellow-400' :
                str((install.plan as Record<string, unknown>).status) === 'approved' ? 'bg-emerald-900/20 text-emerald-400' :
                'bg-[#1a1a1a] text-gray-500'
              }`}>
                {str((install.plan as Record<string, unknown>).status)}
              </span>
            </div>
            <p className="text-[9px] text-gray-400">{str((install.plan as Record<string, unknown>).summary)}</p>
          </div>

          {Array.isArray((install.plan as Record<string, unknown>).steps) && (
            <div className="space-y-1">
              {((install.plan as Record<string, unknown>).steps as Array<Record<string, unknown>>).map((step, idx) => (
                <div key={idx} className="flex items-center gap-3 px-3 py-2 bg-[#111] rounded border border-gray-800 text-[9px]">
                  <span className="text-gray-600 w-4">{str(step.order)}.</span>
                  <span className="text-gray-300 flex-1">{str(step.description)}</span>
                  <RiskBadge risk={str(step.risk)} />
                  <span className={str(step.status) === 'completed' ? 'text-emerald-400' : str(step.status) === 'running' ? 'text-purple-400' : 'text-gray-600'}>
                    {str(step.status)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            {!approvalStatus && !install.executing && str((install.plan as Record<string, unknown>).status) === 'pending_approval' && (
              <button onClick={requestApproval}
                className="text-[9px] px-3 py-1.5 rounded bg-yellow-600 hover:bg-yellow-500 text-white transition-colors"
              >
                Request Approval
              </button>
            )}
            {approvalStatus === 'pending' && approvalRequestId && (
              <>
                <span className="text-[9px] text-yellow-400">Awaiting approval ({approvalRequestId})</span>
                <button onClick={approvePlan} className="text-[9px] px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white transition-colors">Approve</button>
                <button onClick={denyPlan} className="text-[9px] px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white transition-colors">Deny</button>
              </>
            )}
            {approvalStatus === 'requesting' && <span className="text-[9px] text-gray-400">Requesting approval...</span>}
            {approvalStatus === 'approved' && (
              <button onClick={executePlan} disabled={install.executing}
                className="text-[9px] px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50"
              >
                {install.executing ? 'Executing...' : 'Execute Install'}
              </button>
            )}
            {approvalStatus === 'denied' && <span className="text-[9px] text-red-400">Plan denied.</span>}
          </div>
        </div>
      )}

      {install.executionResult && (
        <div className="px-3 py-2 bg-[#111] rounded border border-gray-800 text-[9px] space-y-1">
          <div className="flex items-center gap-2">
            <span className={str(install.executionResult.status) === 'completed' ? 'text-emerald-400' : 'text-red-400'}>
              {str(install.executionResult.status)}
            </span>
            {!!install.executionResult.dryRun && <span className="text-gray-500">(dry-run)</span>}
            {install.executionResult.steps != null && <span className="text-gray-500">({str(install.executionResult.steps)} steps)</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function RiskBadge({ risk }: { risk: string }) {
  const colors: Record<string, string> = {
    low: 'bg-emerald-900/20 text-emerald-400',
    medium: 'bg-yellow-900/50 text-yellow-400',
    high: 'bg-red-900/20 text-red-400',
  };
  return <span className={`text-[9px] px-1.5 py-0.5 rounded ${colors[risk] || 'bg-[#1a1a1a] text-gray-500'}`}>{risk}</span>;
}

// ─── Config ───────────────────────────────────────────────────────

function ConfigTab({ core, pluginId }: { core: CoreClient; pluginId: string }) {
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
      // Core plugin.config.set expects { key, value } per entry, not entire config object.
      // Save each key individually; batch errors are collected but best-effort.
      const entries = Object.entries(config);
      let firstError: string | null = null;
      for (const [key, value] of entries) {
        try {
          await core.call('plugin.config.set', { pluginId, key, value });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Save failed';
          if (!firstError) firstError = msg.includes('not_implemented') ? 'Save not supported by Go Core' : msg;
        }
      }
      if (firstError) {
        setSaveMsg(firstError);
      } else {
        setSaveMsg('Saved');
      }
      const configRes = await core.call<Record<string, unknown>>('plugin.config.get', { pluginId });
      setConfig((configRes?.config as Record<string, unknown>) || {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      setSaveMsg(msg.includes('not_implemented') ? 'Save not supported by Go Core' : msg);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-gray-500 text-[10px]">Loading config...</div>;
  if (fetchError) return <p className="text-red-400 text-[10px]">{fetchError}</p>;
  if (!schema) return <div className="text-gray-500 text-[10px]">No configuration schema declared.</div>;

  const properties = (schema.properties as Record<string, unknown>) || {};
  const entries = Object.entries(properties);
  if (entries.length === 0) return <div className="text-gray-500 text-[10px]">No configuration properties defined.</div>;

  return (
    <div className="max-w-xl space-y-1.5">
      {entries.map(([key, prop]) => {
        const propObj = prop as Record<string, unknown>;
        const currentVal = config[key];
        return (
          <div key={key} className="px-4 py-1.5 bg-[#111] rounded border border-gray-800">
            <div className="flex items-center justify-between mb-1">
              <code className="text-[10px] text-gray-200 font-mono">{key}</code>
              <span className="text-[9px] text-gray-600">{String(propObj.type || 'string')}</span>
            </div>
            {!!propObj.description && <p className="text-[9px] text-gray-500 mb-2">{String(propObj.description)}</p>}
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-gray-500">Current:</span>
              <code className="text-[9px] text-gray-300 bg-[#1a1a1a] px-2 py-0.5 rounded">
                {currentVal !== undefined ? JSON.stringify(currentVal) : '(not set)'}
              </code>
            </div>
            {Array.isArray(propObj.enum) && (
              <div className="mt-1 flex items-center gap-1">
                <span className="text-[9px] text-gray-600">enum:</span>
                {(propObj.enum as string[]).map(e => (
                  <span key={e} className="text-[9px] text-gray-500 bg-[#1a1a1a] px-1.5 py-0.5 rounded">{e}</span>
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
          className="text-[9px] px-4 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-white transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save to Core'}
        </button>
        {saveMsg && (
          <span className={`text-[9px] ${saveMsg === 'Saved' ? 'text-emerald-400' : 'text-red-400'}`}>{saveMsg}</span>
        )}
      </div>
    </div>
  );
}

// ─── Files ────────────────────────────────────────────────────────

function FilesTab({ core, pluginId }: { core: CoreClient; pluginId: string }) {
  return <TabApiFetcher
    core={core} pluginId={pluginId}
    apiMethod="plugin.files.list"
    dataKey="files"
    renderTitle="Files"
    render={(items) => (
      <table className="w-full text-[10px]">
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
              <td className="py-2 pr-4 font-mono text-[9px]">{str(f.id)}</td>
              <td className="py-2 pr-4 font-mono text-[9px] text-gray-400 max-w-xs truncate">{str(f.path)}</td>
              <td className="py-2 pr-4 text-[9px] text-gray-500">{str(f.purpose) || str(f.description) || '—'}</td>
              <td className="py-2">{f.clearable ? <span className="text-[9px] text-yellow-400">yes</span> : <span className="text-[9px] text-gray-600">no</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  />;
}

// ─── Cache ────────────────────────────────────────────────────────

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
      const plan = await core.call<Record<string, unknown>>('plugin.cache.clear.plan', { pluginId, cacheId });
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
      const planStr = plan.summary ? String(plan.summary) : JSON.stringify(plan, null, 2);
      if (!window.confirm(`Cache Clear Plan:\n${planStr}\n\nProceed with clearing?`)) {
        setClearingId(null);
        return;
      }
      await core.call('plugin.cache.clear.execute', { pluginId, cacheId, planId: plan.planId });
      setClearMsg('Cleared');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      setClearMsg(msg.includes('not_implemented') ? 'Cache clear not available' : msg);
    } finally {
      setClearingId(null);
    }
  }

  useEffect(() => { fetchCache(); }, [core, pluginId]);

  if (loading) return <div className="text-gray-500 text-[10px]">Loading cache...</div>;
  if (fetchError) return <p className="text-red-400 text-[10px]">{fetchError}</p>;
  if (notImpl) return <div className="text-gray-500 text-[10px]">Cache management is not available in Phase 1.</div>;
  if (cacheEntries.length === 0) return <PageEmpty title="No cache entries found" />;

  return (
    <div className="space-y-2">
      {cacheEntries.map((c, i) => {
        const isClearable = c.clearable !== false; // undefined/null/true → clearable
        return (
        <div key={i} className="flex items-center gap-3 px-4 py-1.5 bg-[#111] rounded border border-gray-800">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <code className="text-[10px] text-gray-200 font-mono">{str(c.id)}</code>
              {!!c.risk && <RiskBadge risk={str(c.risk)} />}
            </div>
            <p className="text-[9px] text-gray-500 mt-0.5 truncate">{str(c.path)}</p>
            {!!c.description && <p className="text-[9px] text-gray-600 mt-0.5">{str(c.description)}</p>}
          </div>
          <button
            onClick={() => handleClear(str(c.id))}
            disabled={!isClearable || clearingId === str(c.id)}
            title={!isClearable ? 'This cache is not clearable' : undefined}
            className="text-[9px] px-2 py-1 rounded bg-[#1a1a1a] hover:bg-[#222] text-gray-400 disabled:opacity-50 transition-colors"
          >
            {clearingId === str(c.id) ? '...' : 'Clear'}
          </button>
        </div>
        );
      })}
      {clearMsg && (
        <p className={`text-[9px] mt-2 ${clearMsg === 'Cleared' ? 'text-emerald-400' : 'text-gray-500'}`}>{clearMsg}</p>
      )}
    </div>
  );
}

// ─── Runs ─────────────────────────────────────────────────────────

function RunsTab({ core, pluginId }: { core: CoreClient; pluginId: string }) {
  const [runs, setRuns] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Per-run stop state: keyed by runId
  const [stopState, setStopState] = useState<Record<string, { loading: boolean; error: string | null }>>({});
  // Per-run attach state: keyed by runId
  const [attachState, setAttachState] = useState<Record<string, { loading: boolean; error: string | null; sessionId?: string }>>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setFetchError(null);
      try {
        const result = await core.call<Record<string, unknown>>('run.list', { pluginId });
        if (cancelled) return;
        const allRuns = listFromResponse(result, 'runs', 'entries');
        setRuns(allRuns);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Failed to load runs';
        setFetchError(msg);
        setRuns([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [core, pluginId]);

  async function handleStop(runId: string) {
    setStopState(prev => ({ ...prev, [runId]: { loading: true, error: null } }));
    try {
      await core.call('run.stop', { runId });
      // Clear stop state for this run on success, then refresh
      setStopState(prev => {
        const next = { ...prev };
        delete next[runId];
        return next;
      });
      // Refresh runs after stop
      const result = await core.call<Record<string, unknown>>('run.list', { pluginId });
      const allRuns = listFromResponse(result, 'runs', 'entries');
      setRuns(allRuns);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Stop failed';
      setStopState(prev => ({ ...prev, [runId]: { loading: false, error: msg } }));
    }
  }

  async function handleAttach(runId: string) {
    setAttachState(prev => ({ ...prev, [runId]: { loading: true, error: null } }));
    try {
      const result = await core.call<{ sessionId: string; state: string; kind?: string; pluginId?: string }>('run.attach', { runId, replay: false });
      setAttachState(prev => ({ ...prev, [runId]: { loading: false, error: null, sessionId: result.sessionId } }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Attach failed';
      setAttachState(prev => ({ ...prev, [runId]: { loading: false, error: msg } }));
    }
  }

  if (loading) return <div className="text-gray-500 text-[10px]">Loading runs...</div>;
  if (fetchError) return <p className="text-red-400 text-[10px]">{fetchError}</p>;
  if (runs.length === 0) return <div className="text-gray-500 text-[10px]">No active runs for this plugin.</div>;

  return (
    <div className="space-y-2">
      {runs.map((run, i) => {
        const runId = str(run.runId);
        const rowStop = stopState[runId] || { loading: false, error: null };
        const rowAttach = attachState[runId] || { loading: false, error: null, sessionId: undefined };
        const isRunning = str(run.state) === 'running';
        return (
        <div key={i} className="px-4 py-1.5 bg-[#111] rounded border border-gray-800">
          <div className="flex items-center gap-2">
            <code className="text-[9px] text-gray-400 font-mono">{runId}</code>
            <span className="text-[9px] text-gray-600">{str(run.kind)}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded ${
              str(run.state) === 'running' ? 'bg-emerald-900/20 text-emerald-400' :
              str(run.state) === 'orphaned' ? 'bg-yellow-900/50 text-yellow-400' :
              str(run.state) === 'restorable' ? 'bg-purple-900/20 text-purple-400' :
              str(run.state) === 'stopped' ? 'bg-[#1a1a1a] text-gray-500' :
              str(run.state) === 'exited' ? 'bg-[#1a1a1a] text-gray-500' :
              'bg-red-900/20 text-red-400'
            }`}>
              {str(run.state)}
            </span>
            <div className="flex-1" />
            <button
              onClick={() => handleAttach(runId)}
              disabled={rowAttach.loading}
              title={rowAttach.sessionId ? `Attached session ${rowAttach.sessionId}` : 'Attach to run'}
              className={`text-[9px] px-2 py-1 rounded transition-colors disabled:opacity-50 ${
                rowAttach.sessionId
                  ? 'bg-emerald-900/20 text-emerald-400'
                  : 'bg-[#1a1a1a] hover:bg-[#222] text-gray-400'
              }`}
            >
              {rowAttach.loading ? 'Attaching...' : rowAttach.sessionId ? 'Attach verified' : 'Attach'}
            </button>
            {isRunning && (
              <button
                onClick={() => handleStop(runId)}
                disabled={rowStop.loading}
                className="text-[9px] px-2 py-1 rounded bg-red-900/20 hover:bg-red-900/40 text-red-400 transition-colors disabled:opacity-50"
              >
                {rowStop.loading ? 'Stopping...' : 'Stop'}
              </button>
            )}
          </div>
          <div className="text-[9px] text-gray-500 mt-1 space-x-3">
            {!!run.sessionId && <span>session: {str(run.sessionId)}</span>}
            {!!run.nodeId && <span>node: {str(run.nodeId)}</span>}
            {!!run.createdAt && <span>created: {str(run.createdAt)}</span>}
          </div>
          {rowStop.error && (
            <div className="text-[9px] text-red-400 mt-1">{rowStop.error}</div>
          )}
          {rowAttach.sessionId && (
            <div className="text-[9px] text-emerald-400 mt-1">Attached session: {rowAttach.sessionId}</div>
          )}
          {rowAttach.error && (
            <div className="text-[9px] text-red-400 mt-1">{rowAttach.error}</div>
          )}
          {!!run.process && (
            <div className="text-[9px] text-gray-600 mt-1">
              PID {str((run.process as Record<string, unknown>).pid)} | {str((run.process as Record<string, unknown>).state)}
            </div>
          )}
        </div>
        );
      })}
    </div>
  );
}

// ─── Logs ─────────────────────────────────────────────────────────

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

  if (loading) return <div className="text-gray-500 text-[10px]">Loading logs...</div>;
  if (fetchError) return <p className="text-red-400 text-[10px]">{fetchError}</p>;
  if (logs.length === 0) return <div className="text-gray-500 text-[10px]">No log entries found for this plugin.</div>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <button onClick={fetchLogs}
          className="text-[9px] px-3 py-1 rounded bg-[#1a1a1a] hover:bg-[#222] text-gray-400 transition-colors"
        >
          Refresh
        </button>
      </div>
      <div className="space-y-1 max-h-96 overflow-y-auto font-mono text-[9px]">
        {logs.map((entry, i) => (
          <div key={i} className="flex gap-2 px-2 py-1 hover:bg-[#111] rounded">
            <span className="text-gray-600 flex-shrink-0">{entry.timestamp}</span>
            <span className={`flex-shrink-0 ${
              entry.level === 'info' ? 'text-purple-400' :
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

// ─── History ──────────────────────────────────────────────────────

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
      const result = await core.call<Record<string, unknown>>('plugin.history', { pluginId });
      if (result?.status === 'not_implemented') {
        setNotImpl(true);
        setEvents([]);
      } else {
        // Normalize: { events: [...] }, { history: [...] }, { list: [...] }, or [...] directly
        const items = listFromResponse(result, 'events', 'history', 'list');
        setEvents(items);
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

  if (loading) return <div className="text-gray-500 text-[10px]">Loading history...</div>;
  if (fetchError) return <p className="text-red-400 text-[10px]">{fetchError}</p>;
  if (notImpl) return <div className="text-gray-500 text-[10px]">History tracking is not implemented in Phase 1.</div>;
  if (events.length === 0) return <div className="text-gray-500 text-[10px]">No history events recorded.</div>;

  return (
    <div className="space-y-1.5">
      {events.map((evt, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-1.5 bg-[#111] rounded border border-gray-800">
          <div className="w-2 h-2 rounded-full bg-gray-600 mt-1.5 flex-shrink-0" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-200">{str(evt.action) || 'event'}</span>
              {!!evt.version && <span className="text-[9px] text-gray-600">v{str(evt.version)}</span>}
            </div>
            {!!evt.timestamp && <span className="text-[9px] text-gray-600">{str(evt.timestamp)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Raw Manifest ─────────────────────────────────────────────────

function RawTab({ manifest }: { manifest: Record<string, unknown> | null }) {
  if (!manifest) return <div className="text-gray-500 text-[10px]">No manifest data available.</div>;
  return (
    <pre className="text-[10px] text-gray-400 bg-black p-4 rounded overflow-x-auto max-h-[70vh]">
      {JSON.stringify(manifest, null, 2)}
    </pre>
  );
}

// ─── Shared Helpers ───────────────────────────────────────────────

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

  if (loading) return <div className="text-gray-500 text-[10px]">Loading {renderTitle.toLowerCase()}...</div>;
  if (permDenied) return <PagePermissionDenied />;
  if (notImpl) return <div className="text-gray-500 text-[10px]">This feature is not available in Phase 1.</div>;
  if (fetchError) return (
    <div>
      <p className="text-red-400 text-[10px] mb-2">{fetchError}</p>
      <p className="text-[9px] text-gray-600">Core API: {apiMethod} — may not be supported by Go Core.</p>
    </div>
  );
  if (!data || data.length === 0) return <PageEmpty title={`No ${renderTitle.toLowerCase()} found`} />;
  return <>{render(data)}</>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[9px] font-mono text-gray-400 mb-2 uppercase tracking-wider">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-[10px]">
      <span className="text-gray-500 w-28 flex-shrink-0 text-[9px]">{label}:</span>
      <span className="text-gray-300 text-[9px]">{value || '—'}</span>
    </div>
  );
}

function safeArray(val: unknown): Record<string, unknown>[] {
  if (Array.isArray(val)) return val as Record<string, unknown>[];
  return [];
}

function str(val: unknown): string {
  if (typeof val === 'string') return val;
  if (val === null || val === undefined) return '';
  return String(val);
}
