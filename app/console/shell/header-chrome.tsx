'use client';

import { getActions } from '../actions/action-registry';
import { runWorkbenchCommand } from '../actions/workbench-command-dispatch';
import { getHeaderChromeItems, getContextControls } from '../chrome/chrome-registry';
import { iconRegistry } from '../shared/icon-registry';
import type { ActionRunContext, WorkbenchAction } from '../actions/action-types';

// ─── Header Chrome — right-side action buttons and context controls ───

export function HeaderChrome({
  isMinimal,
  focusCtx,
  actionCtx,
}: {
  isMinimal: boolean;
  focusCtx: Record<string, unknown>;
  actionCtx: ActionRunContext;
}) {
  const headerRightActions: WorkbenchAction[] = getActions('header.right', focusCtx);
  const headerChromeItems: any[] = getHeaderChromeItems(focusCtx);
  const headerContextControls = getContextControls(focusCtx).filter(c => c.placement === 'header-right');

  return (
    <div className="flex items-center gap-2">
      {!isMinimal && headerRightActions.map(a => {
        const IconComp = a.icon ? iconRegistry[a.icon] : null;
        return (
          <button key={a.id}
            onClick={() => { if (actionCtx) a.run(actionCtx); }}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#1a1a1a] border border-gray-700 hover:border-purple-500 text-gray-400 hover:text-gray-200 text-[10px] transition-colors"
            title={a.shortcut ? `${a.title} (${a.shortcut})` : a.title}
          >
            {IconComp && <IconComp className="w-3 h-3" />}
          </button>
        );
      })}

      {!isMinimal && headerChromeItems.map(item => {
        const IconComp = item.icon ? iconRegistry[item.icon] : null;
        return (
        <button key={item.id}
          onClick={() => {
            if (item.command && actionCtx) {
              runWorkbenchCommand({ command: item.command }, actionCtx);
            }
          }}
          className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#1a1a1a] border border-gray-700 hover:border-purple-500 text-gray-400 hover:text-gray-200 text-[10px] transition-colors"
          title={item.title || item.text}
        >
          {IconComp && <IconComp className="w-3 h-3" />}
          {item.text || item.title}
        </button>
        );
      })}

      {!isMinimal && headerContextControls.map(cc => {
        const IconComp = cc.icon ? iconRegistry[cc.icon] : null;
        const hasCommand = !!cc.command;

        // kind === 'button' renders as a standard button.
        // All other non-hint kinds (toggle, menu, progress, approval, jump) render as compact pills.
        if (cc.kind === 'button') {
          return (
            <button key={cc.id}
              onClick={() => {
                if (hasCommand && actionCtx) {
                  runWorkbenchCommand({ command: cc.command! }, actionCtx);
                }
              }}
              disabled={!hasCommand}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#1a1a1a] border border-gray-700 hover:border-purple-500 text-gray-400 hover:text-gray-200 text-[10px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={cc.label}
            >
              {IconComp && <IconComp className="w-3 h-3" />}
              {cc.label}
            </button>
          );
        }

        // Non-button kinds: render as compact pill
        return (
          <span key={cc.id}
            onClick={hasCommand ? () => {
              if (actionCtx) {
                runWorkbenchCommand({ command: cc.command! }, actionCtx);
              }
            } : undefined}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-900 border border-gray-800 text-gray-500 text-[10px] ${hasCommand ? 'cursor-pointer hover:border-purple-500 hover:text-gray-300 transition-colors' : 'opacity-50'}`}
            title={cc.label}
            role={hasCommand ? 'button' : undefined}
          >
            {IconComp && <IconComp className="w-3 h-3" />}
            {cc.label}
          </span>
        );
      })}
    </div>
  );
}
