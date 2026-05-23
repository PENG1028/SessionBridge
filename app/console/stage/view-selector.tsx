'use client';

import { type ViewType } from './workbench-state';
import { getAllViewEntries, getViewEntry } from '../main/view-registry';
import { filterLaunchableViews } from '../plugin-host/launchability';

interface ViewSelectorProps {
  onSelect: (viewType: ViewType) => void;
}

/** Derive a compact icon character from the view registry. */
function viewIcon(id: string): string {
  if (id === 'empty') return '+';
  const entry = getViewEntry(id);
  return entry ? entry.meta.title.charAt(0) : '?';
}

function categoryLabel(cat: string): string {
  switch (cat) {
    case 'workspace': return 'WORKSPACE';
    case 'adapter': return 'ADAPTER';
    case 'system': return 'SYSTEM';
    case 'plugin': return 'PLUGINS';
    default: return cat.toUpperCase();
  }
}

export function ViewSelector({ onSelect }: ViewSelectorProps) {
  const allViews = getAllViewEntries();
  // Only show directly launchable editor views.
  // Adapter-only mappings (no launchable/direct) do NOT appear.
  const options = filterLaunchableViews(allViews)
    .map(([id, entry]) => ({
      type: id as ViewType,
      label: entry.meta.title,
      icon: viewIcon(id),
      category: entry.meta.category || 'other',
    }));

  // Group by category
  const grouped = new Map<string, typeof options>();
  for (const opt of options) {
    if (!grouped.has(opt.category)) grouped.set(opt.category, []);
    grouped.get(opt.category)!.push(opt);
  }

  return (
    <div className="p-2 space-y-2">
      {Array.from(grouped.entries()).map(([cat, items]) => (
        <div key={cat}>
          <div className="text-[9px] text-gray-600 font-bold tracking-wider mb-1 px-1">
            {categoryLabel(cat)}
          </div>
          <div className="grid grid-cols-2 gap-1">
            {items.map(opt => (
              <button
                key={opt.type}
                onClick={() => onSelect(opt.type)}
                data-testid={`view-selector-option-${String(opt.type)}`}
                data-view-type={String(opt.type)}
                title={opt.label}
                className="flex items-center gap-2 px-2 py-2 rounded bg-[#1a1a1a] border border-gray-700/50 hover:border-purple-600 hover:bg-gray-800 text-left transition-colors"
              >
                <span className="text-[11px] font-mono w-5 text-center text-purple-400">{opt.icon}</span>
                <div className="flex flex-col">
                  <span className="text-[10px] text-gray-200 font-medium">{opt.label}</span>
                  <span className="text-[8px] text-gray-600">{opt.category}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
