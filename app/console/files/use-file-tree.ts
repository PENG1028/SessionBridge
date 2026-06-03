'use client';

// ─── useFileTree ──────────────────────────────────────────────────
// Manages file system browsing state per connected node.
// Extracted from page.tsx: nodeFileTree, fetchDir, onNavigatePath.

import { useState, useEffect, useCallback } from 'react';
import { useCore } from '../core/core-client-provider';

export interface FileEntry {
  name: string;
  type: 'dir' | 'file';
  path: string;
}

export interface NodeFileTree {
  [dir: string]: {
    items: FileEntry[];
    loaded: boolean;
    error?: string;
  };
}

export function useFileTree(
  wsUrl: string,
  activeNodeWsUrl: string,
  absoluteCwd: string,
) {
  const core = useCore();
  const [nodeFileTree, setNodeFileTree] = useState<Record<string, NodeFileTree>>({});
  const [nodeExpandedDirs, setNodeExpandedDirs] = useState<Record<string, string[]>>({});

  const fileTree = nodeFileTree[activeNodeWsUrl] || {};
  const expandedDirs = new Set(nodeExpandedDirs[activeNodeWsUrl] || [absoluteCwd || '.']);

  const fetchDir = useCallback(async (dir: string) => {
    if (!core?.isConnected) return;
    try {
      const res = await core.call<{ path: string; entries: Array<{ name: string; isDir: boolean; size: number; mode: string }> }>(
        'fs.list', { path: dir },
      );
      const entries = res?.entries ?? [];
      const prefix = dir.endsWith('/') ? dir : dir + '/';
      const items: FileEntry[] = entries.map(e => ({
        name: e.name,
        type: e.isDir ? 'dir' : 'file',
        path: prefix + e.name,
      }));
      setNodeFileTree(prev => ({
        ...prev,
        [activeNodeWsUrl]: { ...(prev[activeNodeWsUrl] || {}), [dir]: { items, loaded: true } },
      }));
    } catch (err) {
      setNodeFileTree(prev => ({
        ...prev,
        [activeNodeWsUrl]: {
          ...(prev[activeNodeWsUrl] || {}),
          [dir]: { items: [], loaded: true, error: String(err) },
        },
      }));
    }
  }, [activeNodeWsUrl, core]);

  // Fetch root on connect or CWD change.
  // Also ensures the CWD is always in expanded dirs so the Files panel
  // follows directory changes (picker, cd, bookmarks).
  useEffect(() => {
    if (absoluteCwd && core.isConnected) {
      fetchDir(absoluteCwd);
      setNodeExpandedDirs(prev => {
        const current = prev[activeNodeWsUrl] || [];
        if (!current.includes(absoluteCwd)) {
          return { ...prev, [activeNodeWsUrl]: [absoluteCwd, ...current] };
        }
        return prev;
      });
    }
  }, [fetchDir, core.isConnected, absoluteCwd, activeNodeWsUrl]);

  const onNavigatePath = useCallback((path: string) => {
    fetchDir(path);
    setNodeExpandedDirs(prev => ({
      ...prev,
      [activeNodeWsUrl]: [absoluteCwd, path],
    }));
  }, [fetchDir, activeNodeWsUrl, absoluteCwd]);

  const toggleDir = useCallback((dirPath: string) => {
    setNodeExpandedDirs(prev => {
      const current = prev[activeNodeWsUrl] || [absoluteCwd || '.'];
      const isExpanded = current.includes(dirPath);
      const next = isExpanded
        ? current.filter(d => d !== dirPath)
        : [...current, dirPath];
      if (!isExpanded) fetchDir(dirPath);
      return { ...prev, [activeNodeWsUrl]: next };
    });
  }, [activeNodeWsUrl, absoluteCwd, fetchDir]);

  return {
    fileTree,
    expandedDirs,
    fetchDir,
    onNavigatePath,
    toggleDir,
    setNodeFileTree,
    setNodeExpandedDirs,
  };
}
