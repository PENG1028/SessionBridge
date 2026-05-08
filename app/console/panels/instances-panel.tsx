'use client';

import { Cpu, Plus, ChevronDown } from 'lucide-react';
import { InstanceList } from '../sidebar/instance-list';
import { usePanelCollapse } from '../sidebar/panel-dnd-wrapper';

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

  const handleCreate = () => {
    const dir = prompt('Directory for new instance:', projectCwd || '.');
    if (dir && onCreateInstance) onCreateInstance(dir);
  };

  return (
    <div className="border-t border-gray-800 bg-[#111]">
      {/* Compact header: h-8 */}
      <div className="flex items-center h-8 px-2 border-b border-gray-800 gap-1.5 bg-[#0d0d0d]">
        <Cpu className="w-3 h-3 text-gray-500 shrink-0" />
        <span className="text-[10px] font-bold text-gray-500 tracking-wider">INSTANCES</span>
        <div className="flex-1" />
        <button
          onClick={handleCreate}
          className="text-gray-600 hover:text-purple-400 transition-colors p-0.5"
          title="New instance"
        >
          <Plus className="w-3 h-3" />
        </button>
        <button
          onClick={onToggle}
          className="text-gray-600 hover:text-gray-300 transition-colors p-0.5"
          title="Collapse panel"
        >
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>

      {/* Instance list */}
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
  );
}
