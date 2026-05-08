'use client';

import { useFocus } from '../workbench/focus-context';
import { getAdapterCapabilities } from '../main/view-registry';

interface QuickActionsPanelProps {
  onQuickAction?: (cmd: string) => void;
  onRewind?: () => void;
}

export function QuickActionsPanel(props: QuickActionsPanelProps) {
  const { onQuickAction, onRewind } = props;
  const { adapterId } = useFocus();
  const caps = getAdapterCapabilities(adapterId ?? '');
  const isTerminal = caps ? !caps.structuredEvents : true;

  if (!onQuickAction) return null;

  return (
    <div className="p-2 border-t border-gray-800 bg-[#151515]">
      <div className="text-[10px] text-gray-500 mb-1.5 font-bold tracking-wider">QUICK ACTIONS</div>
      <div className="flex flex-wrap gap-1">
        <button onClick={() => onQuickAction('npm test')}
          className="px-1.5 py-1 bg-gray-800 hover:bg-gray-700 hover:text-white text-[9px] rounded border border-gray-700 transition-colors">npm test</button>
        <button onClick={() => onQuickAction('git status')}
          className="px-1.5 py-1 bg-gray-800 hover:bg-gray-700 hover:text-white text-[9px] rounded border border-gray-700 transition-colors">git status</button>
        {isTerminal ? (
          <button onClick={() => onQuickAction('ls')}
            className="px-1.5 py-1 bg-gray-800 hover:bg-gray-700 hover:text-white text-[9px] rounded border border-gray-700 transition-colors">ls</button>
        ) : (
          <>
            <button onClick={() => onQuickAction('分析项目结构并优化代码')}
              className="px-1.5 py-1 bg-gray-800 hover:bg-gray-700 hover:text-white text-[9px] rounded border border-gray-700 transition-colors">Analyze</button>
            <button onClick={onRewind}
              className="px-1.5 py-1 bg-gray-800 hover:bg-amber-800 hover:text-amber-200 text-[9px] rounded border border-gray-700 transition-colors">↩ Rewind</button>
          </>
        )}
      </div>
    </div>
  );
}
