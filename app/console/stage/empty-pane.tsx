'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { ViewSelector } from './view-selector';
import type { ViewType } from './workbench-state';

interface EmptyPaneProps {
  onSelectView: (viewType: ViewType) => void;
}

export function EmptyPane({ onSelectView }: EmptyPaneProps) {
  const [showPicker, setShowPicker] = useState(false);

  if (showPicker) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0a0a] min-h-0">
        <ViewSelector onSelect={(vt) => { onSelectView(vt); setShowPicker(false); }} />
        <button
          onClick={() => setShowPicker(false)}
          className="text-[9px] text-gray-600 hover:text-gray-400 mt-1 transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0a0a] min-h-0 gap-2">
      <button
        onClick={() => setShowPicker(true)}
        className="flex items-center justify-center w-10 h-10 rounded-full border-2 border-dashed border-gray-700 text-gray-500 hover:border-purple-500 hover:text-purple-400 transition-colors"
      >
        <Plus className="w-5 h-5" />
      </button>
      <span className="text-[10px] text-gray-600">Select a view to open</span>
    </div>
  );
}
