'use client';

// ─── PluginDetail ──────────────────────────────────────────────────
// Full detail view for a single plugin, with tabbed sections for
// permissions, capabilities, dependencies, and configuration.

import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, RefreshCw, Shield, Puzzle, Box, Sliders, AlertCircle, Package } from 'lucide-react';
import { useCore, getManifest } from '../../sdk';
import { isEnabled, setEnabled } from '../../sdk';
import type { AppManifest } from '../../sdk';
import { PluginConfigForm } from '../../app/console/plugin-host/host-component-registry';
import { PermissionPanel } from './permission-panel';
import { DependencyPanel } from './dependency-panel';
import { InstalledSoftwarePanel } from './installed-software-panel';

// ─── Tab definitions ───────────────────────────────────────────────
type TabId = 'permissions' | 'capabilities' | 'dependencies' | 'installed' | 'config';

interface TabDef {
  id: TabId;
  label: string;
  icon: typeof Shield;
}

const TABS: TabDef[] = [
  { id: 'permissions', label: 'Permissions', icon: Shield },
  { id: 'capabilities', label: 'Capabilities', icon: Puzzle },
  { id: 'dependencies', label: 'Dependencies', icon: Box },
  { id: 'installed', label: 'Installed', icon: Package },
  { id: 'config', label: 'Config', icon: Sliders },
];

// ─── Props ──────────────────────────────────────────────────────────
interface PluginDetailProps {
  appId: string;
  appName: string;
  appVersion: string;
  appType: 'plugin' | 'system';
  appTrusted: boolean;
  appDescription?: string;
  onBack: () => void;
}

// ─── Component ──────────────────────────────────────────────────────
export function PluginDetail({
  appId,
  appName,
  appVersion,
  appType,
  appTrusted,
  appDescription,
  onBack,
}: PluginDetailProps) {
  const core = useCore();
  const [activeTab, setActiveTab] = useState<TabId>('permissions');
  const [manifest, setManifest] = useState<AppManifest | null>(null);
  const [manifestLoading, setManifestLoading] = useState(true);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [enabled, setEnabledState] = useState(isEnabled(appId));

  // Fetch manifest for non-summary details
  const fetchManifest = useCallback(async () => {
    setManifestLoading(true);
    setManifestError(null);
    try {
      const m = await getManifest(appId);
      if (m) {
        setManifest(m);
      } else {
        setManifestError('Failed to load manifest — plugin not found.');
      }
    } catch (err) {
      setManifestError(
        err instanceof Error ? err.message : 'Unknown error loading manifest'
      );
    }
    setManifestLoading(false);
  }, [appId]);

  useEffect(() => {
    fetchManifest();
  }, [fetchManifest]);

  async function handleToggle() {
    const next = !enabled;
    await setEnabled(appId, next);
    setEnabledState(next);
  }

  const permissions = manifest?.core?.permissions || [];

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0a0a0a]">
      {/* Back button + header */}
      <div className="px-4 py-3 border-b border-gray-800">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300 transition-colors mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Apps
        </button>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold text-gray-200">{appName}</h2>
              <code className="text-[10px] text-gray-600 font-mono">{appId}</code>
              <span className="text-[10px] text-gray-600">v{appVersion}</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded border ${
                  appType === 'system'
                    ? 'bg-blue-900/30 text-blue-400 border-blue-700/30'
                    : 'bg-gray-800 text-gray-500 border-gray-700'
                }`}
              >
                {appType}
              </span>
              {appTrusted && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-900/30 text-purple-400 border border-purple-700/30">
                  trusted
                </span>
              )}
            </div>
            {appDescription && (
              <p className="text-[11px] text-gray-500 mt-1.5">{appDescription}</p>
            )}
          </div>

          {/* Enable/Disable toggle */}
          <button
            onClick={handleToggle}
            className={`text-[10px] font-bold px-2.5 py-1 rounded border shrink-0 transition-colors ${
              enabled
                ? 'bg-green-900/30 text-green-400 border-green-700/50 hover:bg-green-800/40'
                : 'bg-gray-800 text-gray-500 border-gray-700 hover:bg-gray-700'
            }`}
          >
            {enabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 px-3">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-[10px] font-medium border-b-2 transition-colors ${
                isActive
                  ? 'text-purple-400 border-purple-500'
                  : 'text-gray-600 border-transparent hover:text-gray-400'
              }`}
            >
              <Icon className="w-3 h-3" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {renderTabContent()}
      </div>
    </div>
  );

  function renderTabContent() {
    // Manifest-dependent tabs show loading/error first
    if (activeTab === 'permissions' || activeTab === 'capabilities') {
      if (manifestLoading) {
        return (
          <div className="flex items-center justify-center h-32">
            <RefreshCw className="w-5 h-5 text-gray-600 animate-spin" />
          </div>
        );
      }
      if (manifestError) {
        return (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <AlertCircle className="w-4 h-4 text-red-400" />
            <p className="text-[11px] text-red-400">{manifestError}</p>
            <button
              onClick={fetchManifest}
              className="flex items-center gap-1 text-[10px] text-purple-400 hover:text-purple-300 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Retry
            </button>
          </div>
        );
      }
    }

    switch (activeTab) {
      case 'permissions':
        return permissions.length === 0 ? (
          <div className="text-[11px] text-gray-600 p-4 text-center">
            No permissions declared.
          </div>
        ) : (
          <PermissionPanel appId={appId} permissions={permissions} />
        );

      case 'capabilities':
        return renderCapabilities();

      case 'dependencies':
        return <DependencyPanel appId={appId} />;

      case 'installed':
        return <InstalledSoftwarePanel appId={appId} />;

      case 'config':
        return (
          <PluginConfigForm
            core={core}
            config={{
              componentId: 'PluginConfigForm',
              pluginId: appId,
              title: 'Configuration',
            }}
            container={{ surface: 'detail', width: 0, height: 0 }}
          />
        );

      default:
        return null;
    }
  }

  function renderCapabilities() {
    if (permissions.length === 0) {
      return (
        <div className="text-[11px] text-gray-600 p-4 text-center">
          No capabilities declared.
        </div>
      );
    }

    return (
      <div className="p-4 space-y-4">
        {permissions.map(perm => (
          <div
            key={perm.id}
            className="bg-gray-900 rounded border border-gray-800 overflow-hidden"
          >
            {/* Group header */}
            <div className="flex items-center justify-between px-3 py-2 bg-gray-800/50 border-b border-gray-800">
              <div className="flex items-center gap-2">
                <code className="text-[11px] font-bold text-gray-300">
                  {perm.id}
                </code>
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded border ${
                    perm.default === 'allow'
                      ? 'bg-green-900/30 text-green-400 border-green-700/30'
                      : perm.default === 'deny'
                        ? 'bg-red-900/30 text-red-400 border-red-700/30'
                        : 'bg-yellow-900/30 text-yellow-400 border-yellow-700/30'
                  }`}
                >
                  {perm.default}
                </span>
              </div>
            </div>

            {/* Description */}
            {perm.description && (
              <p className="text-[10px] text-gray-500 px-3 py-1.5 border-b border-gray-800/50">
                {perm.description}
              </p>
            )}

            {/* Capability list */}
            <div className="p-3">
              <div className="flex flex-wrap gap-1.5">
                {perm.capabilities.map(cap => (
                  <code
                    key={cap}
                    className="text-[10px] text-gray-400 bg-gray-800/80 px-2 py-0.5 rounded border border-gray-700/50"
                  >
                    {cap}
                  </code>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }
}
