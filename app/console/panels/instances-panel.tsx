'use client';

import { Cpu, Plus, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { InstanceList } from '../sidebar/instance-list';
import { usePanelCollapse } from '../sidebar/panel-dnd-wrapper';
import { getAllAdapterTypes } from '../main/view-registry';

interface InstancesPanelProps {
  instances?: any[];
  activeInstanceId?: string | null;
  onActivateInstance?: (id: string) => void;
  onCreateInstance?: (dir: string, model?: string, adapterId?: string) => void;
  onKillInstance?: (id: string) => void;
  projectCwd?: string;
}

export function InstancesPanel(props: InstancesPanelProps) {
  const { instances, activeInstanceId, onActivateInstance, onCreateInstance, onKillInstance, projectCwd } = props;
  const { collapsed, onToggle } = usePanelCollapse();
  const [creating, setCreating] = useState(false);
  const [newDir, setNewDir] = useState(projectCwd || '.');
  const [selectedAdapterId, setSelectedAdapterId] = useState('');

  const adapterTypes = getAllAdapterTypes();

  // TODO(Phase 4F): Replace this inline form with a proper NewRuntimeDialog
  // (directory picker + adapter picker + optional label + model config).
  const handleCreate = () => {
    const dir = newDir.trim() || projectCwd || '.';
    // Always pass explicit adapterId — never silently fallback to default.
    if (!selectedAdapterId) return;
    onCreateInstance?.(dir, undefined, selectedAdapterId);
    setCreating(false);
    setNewDir(projectCwd || '.');
    setSelectedAdapterId('');
  };

  return (
    <div className="border-t border-gray-800 bg-[#111]">
      {/* Compact header: h-8 */}
      <div className="flex items-center h-8 px-2 border-b border-gray-800 gap-1.5 bg-[#0d0d0d]">
        <button
          onClick={onToggle}
          className="text-gray-600 hover:text-gray-300 transition-colors p-0.5 -ml-0.5"
          title="Collapse panel"
        >
          <ChevronDown className="w-3 h-3 transition-transform duration-200" />
        </button>
        <Cpu className="w-3 h-3 text-gray-500 shrink-0" />
        <span className="text-[10px] font-bold text-gray-500 tracking-wider">INSTANCES</span>
        <div className="flex-1" />
        <button
          onClick={() => setCreating(v => !v)}
          className="text-gray-600 hover:text-purple-400 transition-colors p-0.5"
          title="New instance"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {/* Inline new-instance form */}
      {creating && (
        <div className="px-2 py-2 border-b border-gray-800 space-y-1.5 bg-[#0a0a0a]">
          <div className="text-[9px] text-gray-600 font-bold tracking-wider">NEW INSTANCE</div>
          <input
            type="text"
            value={newDir}
            onChange={e => setNewDir(e.target.value)}
            placeholder="Directory path"
            className="w-full bg-[#1a1a1a] border border-gray-700 rounded px-2 py-1 text-[10px] text-gray-200 outline-none focus:border-purple-500"
          />
          <div className="flex gap-1.5">
            <select
              value={selectedAdapterId}
              onChange={e => setSelectedAdapterId(e.target.value)}
              className="flex-1 bg-[#1a1a1a] border border-gray-700 rounded px-2 py-1 text-[10px] text-gray-200 outline-none focus:border-purple-500"
            >
              <option value="">Select adapter...</option>
              {adapterTypes.map(a => (
                <option key={a.id} value={a.id}>{a.meta.label} ({a.id})</option>
              ))}
            </select>
            <button
              onClick={handleCreate}
              disabled={!selectedAdapterId}
              className="px-2 py-1 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[10px] rounded border border-purple-600"
            >
              Create
            </button>
          </div>
        </div>
      )}

      {/* Instance list — scrollable independently */}
      <div className="overflow-y-auto max-h-[calc(60vh-3rem)]">
        {instances && instances.length > 0 ? (
          <InstanceList
            instances={instances}
            activeInstanceId={activeInstanceId || null}
            onActivate={onActivateInstance || (() => {})}
            onKill={onKillInstance || (() => {})}
          />
        ) : (
          <div className="text-gray-700 text-[10px] px-3 pb-3 italic">No instances</div>
        )}
      </div>
    </div>
  );
}
