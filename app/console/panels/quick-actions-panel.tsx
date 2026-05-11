'use client';

import { useMemo } from 'react';
import { useFocus } from '../workbench/focus-context';
import { getActions } from '../actions/action-registry';

interface QuickActionsPanelProps {
  onQuickAction?: (cmd: string) => void;
  onRewind?: () => void;
}

// Phase 4E: Map action IDs to the command text sent via onQuickAction.
// This avoids needing sendInput in scope (WorkbenchProvider wraps only <main>).
const COMMAND_MAP: Record<string, string | undefined> = {
  'host.quick.npmTest': 'npm test',
  'host.quick.gitStatus': 'git status',
  'terminal.quick.ls': 'ls',
  'claude.quick.analyze': '分析项目结构并优化代码',
  'claude.quick.fix': '找出并修复代码中的问题',
  'claude.quick.explain': '解释当前代码的工作原理',
  'claude.quick.test': '为代码编写测试',
  'claude.quick.commit': '生成提交信息',
};

export function QuickActionsPanel(props: QuickActionsPanelProps) {
  const focus = useFocus();

  const actions = useMemo(() =>
    getActions('quickActions', focus.whenContext as Record<string, unknown>),
    [focus.whenContext],
  );

  if (!props.onQuickAction) return null;
  if (actions.length === 0) return null;

  // Group actions visually
  const grouped = useMemo(() => {
    const groups = new Map<string, typeof actions>();
    const noGroup: typeof actions = [];
    for (const a of actions) {
      if (a.group) {
        const arr = groups.get(a.group) || [];
        arr.push(a);
        groups.set(a.group, arr);
      } else {
        noGroup.push(a);
      }
    }
    return { groups, noGroup };
  }, [actions]);

  const handleClick = (a: typeof actions[number]) => {
    if (a.id === 'claude.rewind') {
      props.onRewind?.();
      return;
    }
    const cmd = COMMAND_MAP[a.id];
    if (cmd) {
      props.onQuickAction?.(cmd);
    }
  };

  return (
    <div className="p-2 border-t border-gray-800 bg-[#151515]">
      <div className="text-[10px] text-gray-500 mb-1.5 font-bold tracking-wider">QUICK ACTIONS</div>
      <div className="flex flex-wrap gap-1">
        {/* Ungrouped first */}
        {grouped.noGroup.map(a => (
          <button key={a.id} onClick={() => handleClick(a)}
            className="px-1.5 py-1 bg-gray-800 hover:bg-gray-700 hover:text-white text-[9px] rounded border border-gray-700 transition-colors"
            title={a.title}
          >{a.title}</button>
        ))}
        {/* Render grouped sections */}
        {Array.from(grouped.groups.entries()).map(([group, items]) => (
          <span key={group} className="flex flex-wrap gap-1">
            {items.map(a => (
              <button key={a.id} onClick={() => handleClick(a)}
                className={`px-1.5 py-1 text-[9px] rounded border transition-colors ${
                  a.id === 'claude.rewind'
                    ? 'bg-gray-800 hover:bg-amber-800 hover:text-amber-200 border-gray-700'
                    : 'bg-gray-800 hover:bg-gray-700 hover:text-white border-gray-700'
                }`}
                title={a.title}
              >{a.title}</button>
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}
