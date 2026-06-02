'use client';

// ─── useAppRuntime ────────────────────────────────────────────────
// Manages Core-derived application runtime data.
// Extracted from page.tsx: projectInfo, absoluteCwd.

import { useState, useEffect } from 'react';
import { useCore } from './core-client-provider';
import { useCoreErrors, type CoreErrorEntry } from './use-core-call';
import { classifyCoreError } from './core-error';

export interface ProjectInfo {
  cwd: string;
  projectName: string;
  homeDir: string;
}

export function useAppRuntime(activeInstanceId: string | null): {
  projectInfo: ProjectInfo | null;
  absoluteCwd: string;
} {
  const core = useCore();
  const coreErrors = useCoreErrors();
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);
  const [absoluteCwd, setAbsoluteCwd] = useState('');

  // ── Fetch project info on connect and when active node changes ──
  useEffect(() => {
    if (!core?.isConnected) return;
    let cancelled = false;
    core.call<{ cwd?: string; projectName?: string; homeDir?: string }>('node.info', {})
      .then(info => {
        if (cancelled) return;
        setProjectInfo(prev => ({
          cwd: info.cwd || prev?.cwd || '.',
          projectName: info.projectName || prev?.projectName || '',
          homeDir: info.homeDir || prev?.homeDir || '',
        }));
      })
      .catch(err => {
        if (cancelled) return;
        coreErrors.reportError({
          method: 'node.info',
          error: classifyCoreError(err),
          timestamp: Date.now(),
        });
      });
    return () => { cancelled = true; };
  }, [core, core.isConnected, activeInstanceId]);

  // ── Fetch real filesystem CWD (only updates absoluteCwd, not projectInfo) ──
  useEffect(() => {
    if (!core?.isConnected) return;
    let cancelled = false;
    core.call<{ cwd?: string }>('env.cwd', {})
      .then(res => {
        if (cancelled) return;
        const cwd = (res?.cwd || '').replace(/\\/g, '/');
        if (cwd) setAbsoluteCwd(cwd);
      })
      .catch(err => {
        if (cancelled) return;
        coreErrors.reportError({
          method: 'env.cwd',
          error: classifyCoreError(err),
          timestamp: Date.now(),
        });
      });
    return () => { cancelled = true; };
  }, [core, core.isConnected]);

  return { projectInfo, absoluteCwd };
}
