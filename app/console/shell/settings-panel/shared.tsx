'use client';

import { ChevronRight } from 'lucide-react';

// ── ConnectionDot ─────────────────────────────────────────────────
export function ConnectionDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    connected: 'bg-emerald-500',
    connecting: 'bg-yellow-500 animate-pulse',
    disconnected: 'bg-gray-600',
    error: 'bg-red-500',
  };
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[status] || 'bg-gray-600'}`} />;
}

export function connectionStatusLabel(status: string): string {
  switch (status) {
    case 'connected': return 'Connected';
    case 'connecting': return 'Connecting...';
    case 'disconnected': return 'Disconnected';
    case 'error': return 'Connection Error';
    default: return status;
  }
}

// ── ConfigField ───────────────────────────────────────────────────
function inferConfigType(value: unknown): 'boolean' | 'number' | 'string' {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  return 'string';
}

export function ConfigField({
  keyName,
  value,
  onChange,
  onReset,
  isDirty,
  validationError,
}: {
  keyName: string;
  value: unknown;
  onChange: (value: unknown) => void;
  onReset: () => void;
  isDirty: boolean;
  validationError?: string;
}) {
  const label = keyName;
  const type = inferConfigType(value);

  let input: React.ReactNode;

  switch (type) {
    case 'boolean':
      input = (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            className="accent-purple-500 w-3 h-3"
          />
          <span className="text-[11px] text-gray-300">{label}</span>
        </label>
      );
      break;
    case 'number':
      input = (
        <input
          type="number"
          value={typeof value === 'number' ? value : 0}
          onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
          className="w-28 bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-purple-500 font-mono"
        />
      );
      break;
    case 'string':
    default:
      input = (
        <input
          type="text"
          value={typeof value === 'string' ? value : String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-purple-500"
        />
      );
      break;
  }

  return (
    <div className={`py-2 ${isDirty ? 'border-l-2 border-purple-500 pl-3 -ml-1' : 'pl-2'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <span className="text-[11px] text-gray-200 font-mono">{label}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {input}
          {isDirty && (
            <button
              onClick={onReset}
              className="text-[8px] text-gray-600 hover:text-gray-400 transition-colors shrink-0"
              title="Reset to default"
            >
              reset
            </button>
          )}
        </div>
      </div>
      {validationError && (
        <span className="text-[8px] text-red-400 mt-0.5 block">{validationError}</span>
      )}
    </div>
  );
}

// ── CollapsibleSection ────────────────────────────────────────────
export function CollapsibleSection({
  id,
  title,
  subtitle,
  collapsed,
  onToggle,
  badge,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  collapsed: boolean;
  onToggle: (id: string) => void;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={() => onToggle(id)}
        className="w-full flex items-center gap-2 px-4 py-2 hover:bg-white/[0.02] transition-colors text-left sticky top-0 bg-[#151515] border-b border-gray-800/50"
      >
        <ChevronRight className={`w-3 h-3 text-gray-600 transition-transform ${collapsed ? '' : 'rotate-90'}`} />
        <span className="text-[11px] font-semibold text-gray-300">{title}</span>
        {subtitle && <span className="text-[9px] text-gray-600">{subtitle}</span>}
        {badge && <span className="ml-auto">{badge}</span>}
      </button>
      {!collapsed && <div className="px-4 divide-y divide-gray-800/30">{children}</div>}
    </div>
  );
}
