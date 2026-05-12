'use client';

import { getViewEntry } from '../../main/view-registry';
import type { ComponentType } from 'react';

interface MainSlotProps {
  viewId: string;
  instanceId?: string;
}

export function MainSlot({ viewId, instanceId }: MainSlotProps) {
  const entry = getViewEntry(viewId);
  if (!entry) return <div className="flex-1 flex items-center justify-center text-gray-600 text-xs">View not found: {viewId}</div>;

  const Component = entry.component as ComponentType<{ instanceId?: string }>;
  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 animate-fadeIn">
      <Component instanceId={instanceId} />
    </div>
  );
}
