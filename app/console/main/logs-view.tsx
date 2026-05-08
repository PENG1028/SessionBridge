'use client';

import { useWorkbench } from '../workbench/workbench-context';

export function LogsView() {
  const { logs } = useWorkbench();
  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-2 text-[10px] text-gray-400 font-mono bg-black">
      {logs.map((l, i) => (
        <div key={i} className="whitespace-pre-wrap">{l}</div>
      ))}
    </div>
  );
}
