'use client';

import { Plus, X, Pencil, Check, Plug } from 'lucide-react';
import { useState, useRef, useEffect, useCallback } from 'react';

interface InstanceInfo {
  id: string;
  label?: string;
  status: string;
  source?: string;
  dir?: string;
}

interface InstanceBarProps {
  instances: InstanceInfo[];
  activeInstanceId: string | null;
  onActivate: (id: string) => void;
  onCreate: () => void;
  onKill: (id: string) => void;
  onRename?: (instanceId: string, newLabel: string) => void;
  onOpenConnection?: () => void;
}

function statusColor(status: string) {
  switch (status) {
    case 'running': return 'bg-emerald-500';
    case 'starting': return 'bg-yellow-500';
    case 'error': return 'bg-red-500';
    default: return 'bg-gray-600';
  }
}

function InstanceLabel({ inst, onRename }: { inst: InstanceInfo; onRename?: (id: string, label: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(inst.label || inst.id.slice(0, 12));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // Sync draft when instance label changes externally
  useEffect(() => {
    if (!editing) setDraft(inst.label || inst.id.slice(0, 12));
  }, [inst.label, inst.id, editing]);

  const commit = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== (inst.label || inst.id.slice(0, 12))) {
      onRename?.(inst.id, trimmed);
    } else {
      setDraft(inst.label || inst.id.slice(0, 12));
    }
    setEditing(false);
  }, [draft, inst.id, inst.label, onRename]);

  if (editing) {
    return (
      <form onSubmit={e => { e.preventDefault(); commit(); }} className="flex items-center gap-0.5">
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => e.key === 'Escape' && (setDraft(inst.label || inst.id.slice(0, 12)), setEditing(false))}
          className="w-20 bg-[#0d0d0d] border border-purple-500 rounded px-1 py-0 text-[11px] text-gray-200 outline-none"
          maxLength={40}
        />
        <button type="submit" className="text-purple-400 hover:text-purple-300 p-0.5">
          <Check className="w-2.5 h-2.5" />
        </button>
      </form>
    );
  }

  return (
    <>
      <span className="truncate max-w-[80px]">{inst.label || inst.id.slice(0, 12)}</span>
      {onRename && (
        <button
          onClick={e => { e.stopPropagation(); setEditing(true); setDraft(inst.label || inst.id.slice(0, 12)); }}
          className="text-gray-700 hover:text-gray-400 transition-colors shrink-0 opacity-0 group-hover:opacity-100 ml-0.5 p-0.5"
          title="Rename"
        >
          <Pencil className="w-2.5 h-2.5" />
        </button>
      )}
    </>
  );
}

export function InstanceBar({ instances, activeInstanceId, onActivate, onCreate, onKill, onRename, onOpenConnection }: InstanceBarProps) {
  const hasInstances = instances.length > 0;

  return (
    <div className="flex items-center h-8 px-2 bg-[#0d0d0d] border-b border-gray-800 gap-1 shrink-0 overflow-x-auto">
      {!hasInstances ? (
        <span className="text-[10px] text-gray-700 italic px-2">No instances — click + to add one</span>
      ) : (
        instances.map(inst => {
          const isActive = inst.id === activeInstanceId;
          return (
            <div
              key={inst.id}
              onClick={() => onActivate(inst.id)}
              className={`group flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer transition-all shrink-0 text-[11px] ${
                isActive
                  ? 'bg-purple-900/30 text-purple-100 ring-1 ring-purple-700/40'
                  : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-300'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor(inst.status)} ${isActive ? 'ring-1 ring-purple-400/40' : ''}`} />
              <InstanceLabel inst={inst} onRename={onRename} />
              {inst.source === 'remote' && (
                <span className="text-[8px] bg-cyan-900/25 text-cyan-400 px-1 rounded font-mono">R</span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isActive && !window.confirm(`Kill active instance "${inst.label || inst.id}"?`)) return;
                  onKill(inst.id);
                }}
                className="text-gray-700 hover:text-red-400 transition-colors shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 ml-0.5"
                title="Kill instance"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          );
        })
      )}

      <button
        onClick={onOpenConnection || onCreate}
        className="flex items-center gap-1 px-1.5 py-0.5 text-gray-500 hover:text-gray-200 hover:bg-gray-800/60 rounded transition-colors shrink-0"
        title="Connection manager"
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  );
}
