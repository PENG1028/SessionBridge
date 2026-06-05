'use client';

import { useState, useCallback } from 'react';
import {
  ConnectionDot,
  connectionStatusLabel,
  CollapsibleSection,
} from '../shell/settings-panel/shared';

// ── Types ──────────────────────────────────────────────────────

interface AboutSectionProps {
  coreStatus: string;
  localPort: string;
}

// ── AboutSection ────────────────────────────────────────────────

export function AboutSection({ coreStatus, localPort }: AboutSectionProps) {
  const [collapsed, setCollapsed] = useState(true);

  const toggleCollapse = useCallback(() => {
    setCollapsed((v) => !v);
  }, []);

  return (
    <CollapsibleSection
      id="about"
      title="About"
      collapsed={collapsed}
      onToggle={toggleCollapse}
    >
      <div className="py-2 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-gray-500">UI Version</span>
          <span className="text-[10px] text-gray-300 font-mono">0.6.0</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-gray-500">Go Core</span>
          <span className="flex items-center gap-1.5">
            <ConnectionDot status={coreStatus} />
            <span className="text-[10px] text-gray-300 font-mono">
              {connectionStatusLabel(coreStatus)}
            </span>
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-gray-500">Core Port</span>
          <span className="text-[10px] text-gray-500 font-mono">{localPort}</span>
        </div>
      </div>
    </CollapsibleSection>
  );
}
