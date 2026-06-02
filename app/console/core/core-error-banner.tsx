'use client';

// ─── CoreErrorBanner — shows the latest global Core error ──
// Renders a dismissible bar at the top of the workbench area
// when a core.call() fails with certain categories.

import { useCallback } from 'react';
import { useCoreErrors } from './use-core-call';
import { type CoreErrorCategory } from './core-error';

/** Human-readable label for each error category (UI presentation). */
function categoryLabel(cat: CoreErrorCategory): string {
  switch (cat) {
    case 'connection':        return 'Core 未连接';
    case 'mesh-unreachable':  return '远端节点离线';
    case 'timeout':           return '请求超时';
    case 'forbidden':         return '权限不足';
    case 'bad-request':       return '请求参数错误';
    case 'not-found':         return '资源不存在';
    case 'unknown':           return '未知错误';
  }
}

const SHOW_CATEGORIES: CoreErrorCategory[] = ['connection', 'mesh-unreachable', 'timeout', 'forbidden', 'unknown'];
const BANNER_COLORS: Record<CoreErrorCategory, string> = {
  'connection':       'bg-red-900/30 border-red-700/50 text-red-300',
  'mesh-unreachable': 'bg-yellow-900/30 border-yellow-700/50 text-yellow-300',
  'timeout':          'bg-yellow-900/30 border-yellow-700/50 text-yellow-300',
  'forbidden':        'bg-red-900/30 border-red-700/50 text-red-300',
  'bad-request':      'bg-gray-800 border-gray-700 text-gray-400',
  'not-found':        'bg-gray-800 border-gray-700 text-gray-400',
  'unknown':          'bg-red-900/30 border-red-700/50 text-red-300',
};

export function CoreErrorBanner() {
  const { latestByCategory, clearCategory } = useCoreErrors();
  const onDismiss = useCallback((cat: CoreErrorCategory) => clearCategory(cat), [clearCategory]);

  // Show the highest-priority error
  const priority: CoreErrorCategory[] = ['connection', 'mesh-unreachable', 'timeout', 'forbidden', 'unknown', 'bad-request', 'not-found'];
  const visible = priority.find(cat => SHOW_CATEGORIES.includes(cat) && latestByCategory[cat]);

  if (!visible) return null;

  const entry = latestByCategory[visible]!;
  const colorClasses = BANNER_COLORS[visible];

  return (
    <div
      className={`${colorClasses} border-b text-[11px] px-4 py-1.5 flex items-center gap-2 font-mono`}
      role="alert"
    >
      <span className="font-bold tracking-wider uppercase text-[10px]">{categoryLabel(visible)}</span>
      <span className="flex-1 truncate">{entry.error.message}</span>
      <span className="text-[10px] text-gray-500">{entry.method}</span>
      <button
        onClick={() => onDismiss(visible)}
        className="text-gray-500 hover:text-white shrink-0 ml-2 text-[12px] leading-none"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
