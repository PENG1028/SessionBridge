'use client';

import { type ViewType } from './workbench-state';
import { getAllViewEntries, getAdapterIdForView, getViewEntry } from '../main/view-registry';

interface ViewSelectorProps {
  onSelect: (viewType: ViewType) => void;
}

/** Derive a compact icon character from the view registry. */
function viewIcon(id: string): string {
  if (id === 'empty') return '+';
  const entry = getViewEntry(id);
  return entry ? entry.meta.title.charAt(0) : '?';
}

export function ViewSelector({ onSelect }: ViewSelectorProps) {
  const allViews = getAllViewEntries();
  // Each view declares showInSelector itself. Adapter views additionally
  // appear when they have an adapter mapping (registered by the adapter).
  const options = allViews
    .filter(([id, entry]) => id !== 'empty' && (entry.meta.showInSelector || getAdapterIdForView(id)))
    .map(([id, entry]) => ({
      type: id as ViewType,
      label: entry.meta.title,
      icon: viewIcon(id),
      desc: entry.meta.category || entry.meta.title,
    }));

  return (
    <div className="p-2">
      <div className="text-[9px] text-gray-600 font-bold tracking-wider mb-2 px-1">OPEN VIEW</div>
      <div className="grid grid-cols-2 gap-1">
        {options.map(opt => (
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
              <span className="text-[8px] text-gray-600">{opt.desc}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
