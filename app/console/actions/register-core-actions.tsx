'use client';

// ── Core Action Registrations ──────────────────────────────────
// Phase 4E: Registers all host and core actions into the registry.
// Module-level side effects — import anywhere to trigger
// registration at module load time (matches __corePanelsRegistered
// and __coreViewsRegistered patterns).
//
// Each action declares which surfaces it appears on, optional
// when-conditions, and a run() handler that receives the live
// ActionRunContext at invocation time.

import { registerAction } from './action-registry';
import type { ActionRunContext, WorkbenchAction } from './action-types';

/** Dummy symbol to prevent tree-shaking. */
export const __coreActionsRegistered = true;

function def(
  id: string,
  title: string,
  surfaces: WorkbenchAction['surfaces'],
  run: (ctx: ActionRunContext) => void,
  opts?: {
    category?: string;
    icon?: string;
    when?: string;
    group?: string;
    order?: number;
    shortcut?: string;
    keybinding?: string;
    danger?: boolean;
  },
): WorkbenchAction {
  return {
    id,
    title,
    surfaces,
    run,
    category: opts?.category,
    icon: opts?.icon,
    when: opts?.when,
    group: opts?.group,
    order: opts?.order,
    shortcut: opts?.shortcut,
    keybinding: opts?.keybinding,
    danger: opts?.danger,
  };
}

// ══════════════════════════════════════════════════════════════
// Host-owned actions — settings, dashboard, search, palette, sidebar
// These are core workbench actions, not owned by any adapter/plugin.
// ══════════════════════════════════════════════════════════════
  registerAction(def('host.settings.open', 'Settings',
    ['commandPalette', 'header.right'],
    (ctx) => ctx.openSettings(),
    { icon: 'settings', shortcut: '⌘,', order: 40, category: 'Host' },
  ));

  registerAction(def('host.search.open', 'Search Sessions',
    ['commandPalette'],
    (ctx) => ctx.openSearch(),
    { icon: 'search', shortcut: '⌘K', order: 20, category: 'Host' },
  ));

  registerAction(def('host.commandPalette.open', 'Command Palette',
    ['commandPalette'],
    (ctx) => ctx.openCommandPalette(),
    { icon: 'terminal', shortcut: '⌘⇧P', order: 10, category: 'Host' },
  ));

  registerAction(def('host.sidebar.left.toggle', 'Toggle Left Sidebar',
    ['commandPalette', 'keybinding'],
    (ctx) => ctx.toggleLeftSidebar(),
    { shortcut: '⌘B', keybinding: 'Ctrl+B', order: 50, category: 'Host' },
  ));

  registerAction(def('host.sidebar.right.toggle', 'Toggle Right Sidebar',
    ['commandPalette'],
    (ctx) => ctx.toggleRightSidebar(),
    { order: 60, category: 'Host' },
  ));

  // ── Host context menu actions (Phase 4K) ─────────────────────
  registerAction(def('host.killInstance', 'Kill Instance',
    ['contextMenu', 'keybinding'],
    (ctx) => { if (ctx.instanceId) ctx.killInstance(ctx.instanceId); },
    { when: 'isRunning', shortcut: '⌘W', keybinding: 'Ctrl+W', order: 10, category: 'Host', danger: true, group: 'navigation' },
  ));

  registerAction(def('host.toggleTerminal', 'Toggle Terminal',
    ['contextMenu'],
    (ctx) => {
      const state = ctx.workbenchState as any;
      if (state?.bottom) {
        ctx.workbenchDispatch({ type: 'CLOSE_BOTTOM_PANE' });
      } else {
        ctx.workbenchDispatch({ type: 'ADD_BOTTOM_PANE' });
      }
    },
    { shortcut: '⌘`', keybinding: 'Ctrl+`', order: 20, category: 'Host', group: 'view' },
  ));

  // ══════════════════════════════════════════════════════════════
  // Claude-specific actions — need ActionRunContext so cannot be
  // plain commands. Prioritized for manifest-declared dispatch.
  // ══════════════════════════════════════════════════════════════
  registerAction(def('claude.copyLastAssistant', 'Copy Last Response',
    ['commandPalette', 'keybinding', 'contextMenu'],
    (ctx) => {
      const msgs = [...ctx.messages].reverse();
      const last = msgs.find(m => m.role === 'assistant');
      if (last?.content) {
        navigator.clipboard.writeText(last.content).catch(() => {});
      }
    },
    { when: 'view == "claude-chat"', shortcut: '⌘⇧C', keybinding: 'Ctrl+Shift+C', order: 20, category: 'Claude' },
  ));

  registerAction(def('claude.mode.toggle', 'Toggle Mode Picker',
    ['commandPalette', 'keybinding'],
    () => { window.dispatchEvent(new CustomEvent('toggle-mode-picker')); },
    { when: 'view == "claude-chat"', shortcut: '⌘⇧M', keybinding: 'Ctrl+Shift+M', order: 40, category: 'Claude' },
  ));

  registerAction(def('claude.copyAll', 'Copy All',
    ['contextMenu'],
    (ctx) => {
      const text = [...ctx.messages].map(m => `[${m.role}] ${m.content}`).join('\n');
      navigator.clipboard.writeText(text).catch(() => {});
    },
    { when: 'view == "claude-chat"', shortcut: '⌘⇧C', keybinding: 'Ctrl+Shift+C', order: 30, category: 'Claude', group: 'edit' },
  ));

  // ══════════════════════════════════════════════════════════════
  // Shell-specific actions — need ActionRunContext so cannot be
  // plain commands.
  // ══════════════════════════════════════════════════════════════
  registerAction(def('terminal.new', 'New Terminal',
    ['commandPalette', 'contextMenu'],
    (ctx) => ctx.createInstance(ctx.projectCwd, undefined, 'shell'),
    { when: 'view == "terminal"', order: 10, category: 'Terminal' },
  ));

  // ── Quick actions ──────────────────────────────────────────
  registerAction(def('host.quick.npmTest', 'npm test',
    ['quickActions'],
    (ctx) => ctx.sendInput('npm test'),
    { group: 'run', order: 10 },
  ));

  registerAction(def('host.quick.gitStatus', 'git status',
    ['quickActions'],
    (ctx) => ctx.sendInput('git status'),
    { group: 'run', order: 20 },
  ));

  registerAction(def('terminal.quick.ls', 'ls',
    ['quickActions'],
    (ctx) => ctx.sendInput('ls'),
    {
      when: 'view == "terminal"',
      group: 'run', order: 30,
    },
  ));

  registerAction(def('claude.quick.analyze', 'Analyze',
    ['quickActions'],
    (ctx) => ctx.sendInput('分析项目结构并优化代码'),
    {
      when: 'view == "claude-chat"',
      group: 'edit', order: 10,
    },
  ));

  registerAction(def('claude.quick.fix', 'Fix Issues',
    ['quickActions'],
    (ctx) => ctx.sendInput('找出并修复代码中的问题'),
    {
      when: 'view == "claude-chat"',
      group: 'edit', order: 20,
    },
  ));

  registerAction(def('claude.quick.explain', 'Explain',
    ['quickActions'],
    (ctx) => ctx.sendInput('解释当前代码的工作原理'),
    {
      when: 'view == "claude-chat"',
      group: 'edit', order: 30,
    },
  ));

  registerAction(def('claude.quick.test', 'Write Tests',
    ['quickActions'],
    (ctx) => ctx.sendInput('为代码编写测试'),
    {
      when: 'view == "claude-chat"',
      group: 'edit', order: 40,
    },
  ));

  registerAction(def('claude.quick.commit', 'Generate Commit',
    ['quickActions'],
    (ctx) => ctx.sendInput('生成提交信息'),
    {
      when: 'view == "claude-chat"',
      group: 'edit', order: 50,
    },
  ));

  registerAction(def('claude.rewind', 'Rewind',
    ['quickActions'],
    (ctx) => ctx.sendCommand('rewind'),
    {
      when: 'view == "claude-chat"',
      group: 'navigate', order: 10,
    },
  ));

void __coreActionsRegistered;
