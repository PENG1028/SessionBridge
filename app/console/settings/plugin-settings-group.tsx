'use client';

import { useState, useCallback } from 'react';
import { ChevronRight } from 'lucide-react';
import type { AppConfigProperty } from '../../lib/app-registry/app-types';

// ── Types ──────────────────────────────────────────────────────

interface PluginSettingsGroupProps {
  pluginId: string;
  pluginName: string;
  title?: string;
  properties: Record<string, AppConfigProperty>;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  onSave: () => Promise<void>;
  saving?: boolean;
  error?: string;
  onRetry?: () => void;
  loading?: boolean;
}

// ── PropertyInput ──────────────────────────────────────────────

interface PropertyInputProps {
  property: AppConfigProperty;
  value: unknown;
  onChange: (value: unknown) => void;
}

function PropertyInput({ property, value, onChange }: PropertyInputProps) {
  switch (property.type) {
    case 'boolean':
      return (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            className="accent-purple-500 w-3 h-3"
          />
          <span className="text-[11px] text-gray-300">{String(value ?? false)}</span>
        </label>
      );

    case 'integer':
    case 'number':
      return (
        <input
          type="number"
          value={typeof value === 'number' ? value : ((property.default as number) ?? 0)}
          onChange={(e) => {
            const parsed =
              property.type === 'integer'
                ? parseInt(e.target.value, 10)
                : parseFloat(e.target.value);
            onChange(isNaN(parsed) ? 0 : parsed);
          }}
          min={property.minimum}
          max={property.maximum}
          className="w-24 bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-purple-500 font-mono"
        />
      );

    case 'string':
      // eslint-disable-next-line no-case-declarations
      const enumValues = property.enum;
      if (enumValues && enumValues.length > 0) {
        return (
          <select
            value={String(value ?? property.default ?? '')}
            onChange={(e) => onChange(e.target.value)}
            className="bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-purple-500"
          >
            {enumValues.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        );
      }
      return (
        <input
          type="text"
          value={String(value ?? property.default ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-purple-500"
        />
      );

    default:
      return (
        <input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-purple-500"
        />
      );
  }
}

// ── PluginSettingsGroup ─────────────────────────────────────────

export function PluginSettingsGroup({
  pluginId: _pluginId,
  pluginName,
  title,
  properties,
  values,
  onChange,
  onSave,
  saving,
  error,
  onRetry,
  loading,
}: PluginSettingsGroupProps) {
  const [collapsed, setCollapsed] = useState(true);

  // Track which keys the user has modified since the last save
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());

  const toggleCollapse = useCallback(() => {
    setCollapsed((v) => !v);
  }, []);

  // Wrap onChange to also track dirty state
  const handleChange = useCallback(
    (key: string, value: unknown) => {
      setDirtyKeys((prev) => new Set(prev).add(key));
      onChange(key, value);
    },
    [onChange],
  );

  const handleSave = useCallback(async () => {
    await onSave();
    setDirtyKeys(new Set());
  }, [onSave]);

  // ── Loading state ──────────────────────────────────────────
  if (loading) {
    return (
      <div className="px-4 py-3 space-y-3 animate-pulse">
        <div className="h-3 bg-gray-800 rounded w-1/3" />
        <div className="h-2 bg-gray-800 rounded w-2/3" />
        <div className="h-2 bg-gray-800 rounded w-1/2" />
        <div className="h-2 bg-gray-800 rounded w-3/4" />
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────
  if (error) {
    return (
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 px-3 py-2 bg-red-900/20 border border-red-800/30 rounded">
          <span className="text-[10px] text-red-400 flex-1">{error}</span>
          {onRetry && (
            <button
              onClick={onRetry}
              className="text-[9px] text-purple-400 hover:text-purple-300"
            >
              retry
            </button>
          )}
        </div>
      </div>
    );
  }

  const propertyEntries = Object.entries(properties);
  if (propertyEntries.length === 0) return null;

  return (
    <div className="border-b border-gray-800/30">
      {/* ── Header ───────────────────────────────────────────── */}
      <button
        onClick={toggleCollapse}
        className="w-full flex items-center gap-2 px-4 py-2 hover:bg-white/[0.02] transition-colors text-left"
      >
        <ChevronRight
          className={`w-3 h-3 text-gray-600 transition-transform ${collapsed ? '' : 'rotate-90'}`}
        />
        <span className="text-[11px] font-semibold text-gray-300">
          {title || pluginName}
        </span>
        {dirtyKeys.size > 0 && (
          <span className="ml-auto text-[8px] text-amber-400 bg-amber-900/20 px-1.5 py-0.5 rounded">
            {dirtyKeys.size} modified
          </span>
        )}
      </button>

      {/* ── Fields ───────────────────────────────────────────── */}
      {!collapsed && (
        <div className="px-4 pb-3 divide-y divide-gray-800/30">
          {propertyEntries.map(([key, prop]) => {
            const currentValue = values[key] ?? prop.default;
            const isDirty = dirtyKeys.has(key);

            return (
              <div
                key={key}
                className={`py-2 ${isDirty ? 'border-l-2 border-amber-500 pl-3 -ml-1' : 'pl-2'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <span className="text-[11px] text-gray-200 font-mono">{key}</span>
                    {prop.description && (
                      <div className="text-[8px] text-gray-600 mt-0.5">
                        {prop.description}
                      </div>
                    )}
                    <div className="text-[8px] text-gray-700 mt-0.5">
                      default:{' '}
                      <span className="font-mono">
                        {JSON.stringify(prop.default ?? '—')}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <PropertyInput
                      property={prop}
                      value={currentValue}
                      onChange={(v) => handleChange(key, v)}
                    />
                  </div>
                </div>
              </div>
            );
          })}

          {/* ── Save button ──────────────────────────────────── */}
          {dirtyKeys.size > 0 && (
            <div className="pt-2 pb-1">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-2.5 py-1 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-[10px] rounded border border-purple-600 transition-colors flex items-center gap-1"
              >
                {saving ? (
                  <>
                    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />{' '}
                    Saving
                  </>
                ) : (
                  'Save'
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
