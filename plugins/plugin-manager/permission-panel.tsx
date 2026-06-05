'use client';

// ─── PermissionPanel ──────────────────────────────────────────────
// Shows all declared permissions for a plugin and allows grant toggling.
// Enhanced with visual grouping, mode indicators, and capability counts.

import { useState, useEffect } from 'react';
import { Shield, ShieldCheck, ShieldX, ShieldAlert, Info } from 'lucide-react';
import type { AppPermissionSpec } from '../../sdk';
import { getGrant, setGrant } from '../../sdk';

interface PermissionPanelProps {
  appId: string;
  /** Permission declarations from the plugin manifest. */
  permissions: AppPermissionSpec[];
}

// ─── Mode helpers ───────────────────────────────────────────────────
const MODE_CYCLE: Record<string, string> = {
  allow: 'ask',
  ask: 'deny',
  deny: 'allow',
};

const MODE_LABELS: Record<string, string> = {
  allow: 'Allow — grant access without prompting',
  ask: 'Ask — prompt each time',
  deny: 'Deny — block access',
};

const MODE_COLORS: Record<string, string> = {
  allow: 'bg-green-900/30 text-green-400 border-green-700/50',
  ask: 'bg-yellow-900/30 text-yellow-400 border-yellow-700/50',
  deny: 'bg-red-900/30 text-red-400 border-red-700/50',
};

const MODE_DOTS: Record<string, string> = {
  allow: 'bg-green-500',
  ask: 'bg-yellow-500',
  deny: 'bg-red-500',
};

function ModeIcon({ mode }: { mode: string }) {
  if (mode === 'allow') return <ShieldCheck className="w-3 h-3 text-green-400" />;
  if (mode === 'deny') return <ShieldX className="w-3 h-3 text-red-400" />;
  return <ShieldAlert className="w-3 h-3 text-yellow-400" />;
}

// ─── Component ──────────────────────────────────────────────────────
export function PermissionPanel({ appId, permissions }: PermissionPanelProps) {
  const [grants, setGrants] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  // Load current grants
  useEffect(() => {
    const g: Record<string, string> = {};
    for (const perm of permissions) {
      for (const cap of perm.capabilities) {
        g[cap] = getGrant(appId, cap);
      }
    }
    setGrants(g);
  }, [appId, permissions]);

  async function handleToggle(capability: string, currentMode: string) {
    const next = MODE_CYCLE[currentMode] || 'allow';
    setLoading(true);
    try {
      await setGrant(appId, capability, next as 'allow' | 'deny' | 'ask');
      setGrants(prev => ({ ...prev, [capability]: next }));
    } catch (_e) { /* grant save failed */ }
    setLoading(false);
  }

  if (!permissions.length) {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2">
        <Shield className="w-5 h-5 text-gray-700" />
        <p className="text-[11px] text-gray-600">No permissions declared.</p>
      </div>
    );
  }

  const totalCaps = permissions.reduce((s, p) => s + p.capabilities.length, 0);

  return (
    <div className="p-4">
      {/* Summary bar */}
      <div className="flex items-center gap-2 mb-3 text-[10px] text-gray-600">
        <Shield className="w-3.5 h-3.5 text-purple-400" />
        <span>
          {permissions.length} permission group{permissions.length !== 1 ? 's' : ''},{' '}
          {totalCaps} capabilit{totalCaps !== 1 ? 'ies' : 'y'}
        </span>
        <span className="text-[9px] text-gray-700">— click to cycle Allow/Ask/Deny</span>
      </div>

      <div className="space-y-3">
        {permissions.map(perm => {
          const groupDefault = perm.default;
          return (
            <div
              key={perm.id}
              className="bg-gray-900 rounded border border-gray-800 overflow-hidden"
            >
              {/* Group header */}
              <div className="flex items-center justify-between px-3 py-2 bg-gray-800/40 border-b border-gray-800">
                <div className="flex items-center gap-2">
                  <code className="text-[11px] font-bold text-gray-300">{perm.id}</code>
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded border ${
                      MODE_COLORS[groupDefault]
                    }`}
                  >
                    default: {groupDefault}
                  </span>
                  <span className="text-[9px] text-gray-700">
                    ({perm.capabilities.length} cap{perm.capabilities.length !== 1 ? 's' : ''})
                  </span>
                </div>
              </div>

              {/* Description */}
              {perm.description && (
                <div className="flex items-start gap-1.5 px-3 py-1.5 border-b border-gray-800/40">
                  <Info className="w-3 h-3 text-gray-600 mt-0.5 shrink-0" />
                  <p className="text-[10px] text-gray-500">{perm.description}</p>
                </div>
              )}

              {/* Capability rows */}
              <div className="divide-y divide-gray-800/30">
                {perm.capabilities.map(cap => {
                  const current = grants[cap] || groupDefault;
                  return (
                    <div
                      key={cap}
                      className="flex items-center justify-between px-3 py-2 hover:bg-gray-800/30 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${MODE_DOTS[current]}`} />
                        <code className="text-[10px] text-gray-400 truncate">{cap}</code>
                      </div>
                      <button
                        onClick={() => !loading && handleToggle(cap, current)}
                        disabled={loading}
                        title={MODE_LABELS[current]}
                        className={`flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded border transition-colors disabled:opacity-50 shrink-0 ${MODE_COLORS[current]}`}
                      >
                        <ModeIcon mode={current} />
                        {current}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
