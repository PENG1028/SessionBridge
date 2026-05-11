'use client';

import { useMemo } from 'react';
import { useFocus } from '../workbench/focus-context';
import { getActions } from '../actions/action-registry';

interface QuickActionsPanelProps {
  onCommand?: (commandId: string) => void;
}

export function QuickActionsPanel(props: QuickActionsPanelProps) {
  const focus = useFocus();

  const actions = useMemo(() =>
    getActions('quickActions', focus.whenContext as Record<string, unknown>),
    [focus.whenContext],
  );

  const { onCommand } = props;
  if (!onCommand) return null;
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
    onCommand(a.id);
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
