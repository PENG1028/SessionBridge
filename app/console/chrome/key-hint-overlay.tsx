'use client';

import { useMemo } from 'react';
import { getBottomRightContextControls } from './chrome-registry';
import { type WhenContext } from '../../../lib/evaluate-when';

interface KeyHintOverlayProps {
  whenContext: WhenContext;
  onCommand?: (command: string) => void;
}

/**
 * Adaptive context control overlay rendered at the bottom-right of the workbench.
 * Shows up to 6 context controls eligible for bottom-right placement:
 *   - placement === "bottom-right" → always shown
 *   - placement === "auto" → shown (host fallback for bottom-right)
 *   - placement undefined + kind === "hint" → legacy keyHint → shown
 * Other placements (header-right, status-left, status-right, bottom-left) are excluded.
 *
 * - kind === "hint": kbd + label style
 * - other kinds: capsule/button with label
 * Hidden on mobile.
 *
 * Phase 4J-b: Upgraded from keyHints-only to unified contextControls model.
 */
export function KeyHintOverlay({ whenContext, onCommand }: KeyHintOverlayProps) {
  const controls = useMemo(
    () => getBottomRightContextControls(whenContext).slice(0, 6),
    [whenContext],
  );

  if (controls.length === 0) return null;

  return (
    <div className="hidden md:flex fixed bottom-8 right-4 z-30 gap-2 pointer-events-none" data-copyable="false">
      {controls.map(ctrl => {
        if (ctrl.kind === 'hint') {
          return (
            <button
              key={ctrl.id}
              onClick={() => {
                if (ctrl.command && onCommand) onCommand(ctrl.command);
              }}
              className={`pointer-events-auto flex items-center gap-1.5 px-2 py-1 rounded text-[9px] bg-[#1a1a1a]/90 border border-gray-800 text-gray-500 hover:text-gray-300 hover:border-gray-700 transition-colors ${
                ctrl.command ? 'cursor-pointer' : 'cursor-default'
              }`}
              title={ctrl.label}
            >
              {ctrl.keys && (
                <kbd className="font-mono text-[9px] text-gray-400 bg-gray-800/60 px-1 rounded">{ctrl.keys}</kbd>
              )}
              <span>{ctrl.label}</span>
            </button>
          );
        }

        // Non-hint kinds: capsule/button style
        const variantStyles: Record<string, string> = {
          primary: 'border-purple-700 bg-purple-900/20 text-purple-400 hover:bg-purple-900/40',
          danger: 'border-red-700 bg-red-900/20 text-red-400 hover:bg-red-900/40',
          warning: 'border-yellow-700 bg-yellow-900/20 text-yellow-400 hover:bg-yellow-900/40',
          success: 'border-emerald-700 bg-emerald-900/20 text-emerald-400 hover:bg-emerald-900/40',
        };
        const vs = ctrl.variant && variantStyles[ctrl.variant]
          ? variantStyles[ctrl.variant]
          : 'border-gray-700 bg-gray-800/60 text-gray-400 hover:bg-gray-700/60 hover:text-gray-300';

        return (
          <button
            key={ctrl.id}
            onClick={() => {
              if (ctrl.command && onCommand) onCommand(ctrl.command);
            }}
            className={`pointer-events-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] border transition-colors ${vs} ${
              ctrl.command ? 'cursor-pointer' : 'cursor-default'
            }`}
            title={ctrl.reason || ctrl.label}
          >
            {ctrl.keys && (
              <kbd className="font-mono text-[9px] opacity-70 bg-black/30 px-1 rounded">{ctrl.keys}</kbd>
            )}
            <span>{ctrl.label}</span>
          </button>
        );
      })}
    </div>
  );
}
