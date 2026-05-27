'use client';

import { cn } from './cn';

interface Tab {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
}

interface TabsProps {
  tabs: Tab[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
}

export function Tabs({ tabs, activeId, onChange, className }: TabsProps) {
  return (
    <div className={cn('flex items-center gap-2', className)} role="tablist">
      {tabs.map(tab => {
        const isActive = tab.id === activeId;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={cn(
              'px-2 py-1 text-[10px] font-bold tracking-wider uppercase rounded transition-colors',
              isActive ? 'bg-gray-800 text-gray-200' : 'text-gray-600 hover:text-gray-400',
            )}
          >
            {Icon && <Icon className="w-3 h-3 inline mr-1" />}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
