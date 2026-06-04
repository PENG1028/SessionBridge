'use client';

import { AlertCircle } from 'lucide-react';
import type { MsgLog } from '../../../lib/session-types';

interface TerminalLogPanelProps {
  logs?: string[];
  msgLog?: MsgLog[];
  terminalTab?: 'log' | 'raw';
  onTerminalTabChange?: (tab: 'log' | 'raw') => void;
  logsEndRef?: React.RefObject<HTMLDivElement | null>;
}

export function TerminalLogPanel(props: TerminalLogPanelProps) {
  const { logs, msgLog, terminalTab, onTerminalTabChange, logsEndRef } = props;

  return (
    <div className="max-h-64 flex flex-col bg-black min-h-0 border-t border-gray-800">
      <div className="flex border-b border-gray-800 bg-[#111] shrink-0">
        <button onClick={() => onTerminalTabChange?.('log')}
          className={`px-3 py-1.5 text-[10px] tracking-wider flex items-center gap-1.5 transition-colors ${
            terminalTab === 'log' ? 'text-purple-400 border-b border-purple-500 bg-[#0a0a0a]' : 'text-gray-600 hover:text-gray-400'
          }`}>
          <AlertCircle className="w-3 h-3" /> LOG
        </button>
        <button onClick={() => onTerminalTabChange?.('raw')}
          className={`px-3 py-1.5 text-[10px] tracking-wider flex items-center gap-1.5 transition-colors ${
            terminalTab === 'raw' ? 'text-purple-400 border-b border-purple-500 bg-[#0a0a0a]' : 'text-gray-600 hover:text-gray-400'
          }`}>
          <AlertCircle className="w-3 h-3" /> RAW
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 text-gray-400 text-xs font-mono leading-relaxed">
        {terminalTab === 'log' ? (
          !logs || logs.length === 0 ? (
            <div className="text-gray-700 text-[10px] italic">No log entries yet</div>
          ) : (
            logs.map((log, i) => (
              <div key={i} className={`whitespace-pre-wrap ${
                log.includes('Error') || log.includes('[Error]') ? 'text-red-400'
                : log.includes('✓') || log.includes('✅') ? 'text-green-400'
                : log.includes('> ') ? 'text-purple-300'
                : log.includes('[Unknown]') ? 'text-yellow-500'
                : 'text-gray-500'
              }`}>
                {log}
              </div>
            ))
          )
        ) : (
          !msgLog || msgLog.length === 0 ? (
            <div className="text-gray-700 text-[10px] italic">Raw output will appear here</div>
          ) : (
            msgLog.slice(-200).map((entry: MsgLog) => (
              <div key={entry.id} className="text-[10px] leading-relaxed font-mono">
                <span className="text-gray-700">{entry.time}</span>{' '}
                <span className={`${
                  entry.type === 'output' ? 'text-gray-500'
                  : entry.type === 'block' ? 'text-purple-500'
                  : entry.type === 'input' ? 'text-green-500'
                  : entry.type === 'error' ? 'text-red-500'
                  : 'text-gray-600'
                }`}>
                  [{entry.type}]
                </span>{' '}
                <span className="text-gray-400">{entry.data}</span>
              </div>
            ))
          )
        )}
        <div ref={logsEndRef as React.RefObject<HTMLDivElement>} />
      </div>
    </div>
  );
}
