'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Terminal } from 'lucide-react';

interface CommandPaletteCommand {
  id: string;
  title: string;
  category?: string;
}

interface CommandPaletteProps {
  commands: CommandPaletteCommand[];
  onCommand: (commandId: string) => void;
  onClose: () => void;
}

export function CommandPalette({ commands, onCommand, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter(c =>
      c.title.toLowerCase().includes(q) ||
      (c.category && c.category.toLowerCase().includes(q)) ||
      c.id.toLowerCase().includes(q)
    );
  }, [commands, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        onCommand(filtered[selectedIndex].id);
        onClose();
      }
      return;
    }
  }, [filtered, selectedIndex, onCommand, onClose]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-cmd-palette]')) {
        onClose();
      }
    };
    // Delay to prevent the same click that opened it from closing it
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler); };
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-40 flex justify-start pt-12 pointer-events-none" style={{ top: '44px' }}>
      <div data-cmd-palette
        className="w-full max-w-lg mx-auto bg-[#151515] border border-gray-700 rounded-lg shadow-2xl shadow-black/60 overflow-hidden pointer-events-auto max-h-[70vh] flex flex-col"
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 p-3 border-b border-gray-800">
          <Terminal className="w-4 h-4 text-gray-500 shrink-0" />
          <input ref={inputRef} type="text" value={query} onChange={e => { setQuery(e.target.value); }}
            placeholder="Search commands..."
            className="flex-1 bg-transparent outline-none text-gray-200 text-sm placeholder-gray-600"
          />
          {commands.length > 0 && (
            <span className="text-[8px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">{commands.length}</span>
          )}
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400 text-lg leading-none">&times;</button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto max-h-[50vh]">
          {filtered.length === 0 && (
            <div className="p-6 text-center text-gray-600 text-xs">
              {query.trim() ? 'No matching commands' : 'No commands available'}
            </div>
          )}
          {filtered.map((cmd, idx) => (
            <button
              key={cmd.id}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                idx === selectedIndex ? 'bg-purple-900/30 text-white' : 'text-gray-300 hover:bg-gray-800'
              }`}
              onClick={() => { onCommand(cmd.id); onClose(); }}
              onMouseEnter={() => setSelectedIndex(idx)}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{cmd.title}</div>
                <div className="text-[10px] text-gray-500 truncate">
                  {cmd.category && <span>{cmd.category} · </span>}
                  <span className="font-mono">{cmd.id}</span>
                </div>
              </div>
              <span className="text-[8px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded font-mono shrink-0">
                {cmd.id.split('.')[0] || 'ext'}
              </span>
            </button>
          ))}
        </div>

        {/* Footer hint */}
        <div className="p-2 border-t border-gray-800 text-[8px] text-gray-700 text-center flex gap-3 justify-center">
          <span><kbd className="text-gray-500 bg-gray-800 px-1 rounded">↑↓</kbd> Navigate</span>
          <span><kbd className="text-gray-500 bg-gray-800 px-1 rounded">Enter</kbd> Execute</span>
          <span><kbd className="text-gray-500 bg-gray-800 px-1 rounded">Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}
