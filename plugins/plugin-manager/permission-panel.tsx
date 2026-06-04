'use client';

// ─── PermissionPanel ──────────────────────────────────────────────
// Shows all declared permissions for a plugin and allows grant toggling.

import { useState, useEffect } from 'react';
import type { AppPermissionSpec } from '../../sdk';
import { getGrant, setGrant } from '../../sdk';

interface PermissionPanelProps {
  appId: string;
  /** Permission declarations from the plugin manifest. */
  permissions: AppPermissionSpec[];
}

export function PermissionPanel({ appId, permissions }: PermissionPanelProps) {
  const [grants, setGrants] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

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
    const next = currentMode === 'allow' ? 'ask' : currentMode === 'ask' ? 'deny' : 'allow';
    setLoading(true);
    try {
      await setGrant(appId, capability, next as 'allow' | 'deny' | 'ask');
      setGrants(prev => ({ ...prev, [capability]: next }));
    } catch (_e) { /* grant save failed */ }
    setLoading(false);
  }

  const modeColors: Record<string, string> = {
    allow: 'bg-green-900/30 text-green-400 border-green-700/50',
    deny: 'bg-red-900/30 text-red-400 border-red-700/50',
    ask: 'bg-yellow-900/30 text-yellow-400 border-yellow-700/50',
  };

  if (!permissions.length) {
    return (
      <div className="text-[11px] text-gray-600 p-4 text-center">
        No permissions declared.
      </div>
    );
  }

  return (
    <div className="space-y-3 p-2">
      {permissions.map(perm => (
        <div key={perm.id} className="bg-gray-900 rounded border border-gray-800 p-3">
          <div className="text-[11px] font-bold text-gray-300 mb-1">{perm.id}</div>
          {perm.description && (
            <div className="text-[10px] text-gray-500 mb-2">{perm.description}</div>
          )}
          <div className="space-y-1.5">
            {perm.capabilities.map(cap => (
              <div key={cap} className="flex items-center justify-between">
                <code className="text-[10px] text-gray-400">{cap}</code>
                <button
                  onClick={() => !loading && handleToggle(cap, grants[cap] || perm.default)}
                  disabled={loading}
                  className={`text-[9px] font-bold px-2 py-0.5 rounded border transition-colors disabled:opacity-50 ${modeColors[grants[cap] || perm.default]}`}
                >
                  {grants[cap] || perm.default}
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
