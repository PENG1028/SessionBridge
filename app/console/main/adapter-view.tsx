'use client';

import type { ReactNode } from 'react';
import { viewRegistry } from './view-registry';

export interface AdapterViewProps {
  activeInstanceId: string | null;
  /** adapter.viewId — used to look up the render component */
  viewId: string | null;
  /** Props forwarded to the resolved view component */
  viewProps?: Record<string, unknown>;
  /** Fallback when no instance or unknown viewId */
  children?: ReactNode;
}

export function AdapterView({ activeInstanceId, viewId, viewProps = {}, children }: AdapterViewProps) {
  if (!activeInstanceId) {
    return <>{children}</>;
  }

  const View = viewId ? viewRegistry[viewId] : null;
  if (!View) {
    return <>{children}</>;
  }

  return <View {...viewProps} />;
}
