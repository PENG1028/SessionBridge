'use client';

import { useState, useCallback } from 'react';
import type { ContextMenuItem } from '../shell/context-menu';
import { executeCommand } from '../commands/command-registry';

/**
 * Context menu construction for right-click on the main area.
 *
 * Phase 4E: Simplified — isTerminalView uses viewId directly instead of
 * capability inference; Kill Instance dispatches through command registry;
 * extension menus are filtered by menuTarget ('workbench/context' by default).
 *
 * TODO(Phase 4G): Migrate remaining hardcoded items (New Shell, Clear History,
 * Toggle Terminal, Copy All) to registered commands in the command registry.
 */
export function useContextMenu(
  activeAdapterId: string,
  activeInstanceId: string | null | undefined,
  projectInfo: { cwd: string } | null,
  messages: any[],
  createInstance: (dir: string, label?: string, adapterId?: string) => any,
  killInstance: (id: string) => void,
  sendCommand: (cmd: string, args?: any) => void,
  extensionPointsData: Record<string, unknown> | null | undefined,
  viewId: string,
  isActiveRunning: boolean,
  workbenchState: { bottom: any },
  workbenchDispatch: (action: any) => void,
  getAllAdapterTypes: () => { id: string; meta: { label: string } }[],
  getAdapterCapabilities: (adapterId: string) => Record<string, boolean> | undefined,
  evaluateWhen: (expr: string | undefined, ctx: Record<string, unknown>) => boolean,
  /** Filter extension menus by target context. Defaults to 'workbench/context'. */
  menuTarget?: string,
) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  const handleCtx = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const target = menuTarget || 'workbench/context';
    const isTerminalView = viewId === 'terminal';
    const allAdapterTypes = getAllAdapterTypes();
    const newInstanceItems: ContextMenuItem[] = allAdapterTypes
      .filter(a => a.id !== 'shell' || isTerminalView)
      .map(a => ({
        label: `New ${a.meta.label}`,
        shortcut: '⌘T',
        action: () => createInstance(projectInfo?.cwd || '.', undefined, a.id),
      }));
    const items: ContextMenuItem[] = [
      ...newInstanceItems,
      { label: 'Kill Instance', shortcut: '⌘W', action: () => {
        if (activeInstanceId) executeCommand('shell.kill', activeInstanceId);
      }, danger: true },
      { label: '', divider: true, action: () => {} },
      ...(!isTerminalView
        ? [
            { label: 'Clear History', action: () => {} } as ContextMenuItem,
            { label: 'Toggle Terminal', shortcut: '⌘`', action: () => {
              if (workbenchState.bottom) {
                workbenchDispatch({ type: 'CLOSE_BOTTOM_PANE' });
              } else {
                workbenchDispatch({ type: 'ADD_BOTTOM_PANE' });
              }
            } } as ContextMenuItem,
            { label: '', divider: true, action: () => {} } as ContextMenuItem,
            { label: 'Copy All', shortcut: '⌘⇧C', action: () => {
              const text = messages.map((m: any) => `[${m.role}] ${m.content}`).join('\n');
              navigator.clipboard.writeText(text);
            } } as ContextMenuItem,
          ]
        : []),
    ];

    // Extension-contributed menu items from manifests (grouped)
    // Phase 4E: Filter by menuTarget — only show menus targeting this context.
    const extMenus = (extensionPointsData?.menus as any[]) || [];
    const matchedExtItems = extMenus
      .filter((m: any) => (m.menu || 'workbench/context') === target)
      .filter((m: any) => evaluateWhen(m.when, { view: viewId, activeAdapterId, isRunning: isActiveRunning }))
      .map((m: any) => ({
        label: m.title,
        action: () => sendCommand(m.command),
        disabled: m.disabled,
        group: m.group as string | undefined,
      }));
    if (matchedExtItems.length > 0) {
      items.push({ label: '', divider: true, action: () => {} });

      const groupOrder = ['navigation', 'edit', 'debug', 'view'];
      const byGroup = new Map<string, typeof matchedExtItems>();
      const noGroup: typeof matchedExtItems = [];

      for (const item of matchedExtItems) {
        if (item.group && groupOrder.includes(item.group)) {
          const arr = byGroup.get(item.group) || [];
          arr.push(item);
          byGroup.set(item.group, arr);
        } else {
          noGroup.push(item);
        }
      }

      for (const group of groupOrder) {
        const arr = byGroup.get(group);
        if (arr && arr.length > 0) items.push(...arr);
      }

      if (noGroup.length > 0) items.push(...noGroup);
    }

    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, [viewId, activeInstanceId, projectInfo, messages, createInstance, killInstance, workbenchState, workbenchDispatch, extensionPointsData, sendCommand, activeAdapterId, isActiveRunning, getAllAdapterTypes, getAdapterCapabilities, evaluateWhen, menuTarget]);

  return { ctxMenu, setCtxMenu, handleCtx };
}
