'use client';

import type { HostComponentProps } from '../../console/plugin-host/host-component-registry';

// Placeholder — will be moved from plugin-components.tsx
export default function SystemInfoView({ core, config }: HostComponentProps) {
  return (
    <div className="flex-1 flex items-center justify-center bg-[#0a0a0a]">
      <div className="text-[11px] text-gray-500 font-mono">
        System Info — loading...
      </div>
    </div>
  );
}
