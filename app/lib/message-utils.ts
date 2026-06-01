// ─── Message Utilities ────────────────────────────────────────────
// Message conversion, session block parsing, display helpers.
// Extracted from page.tsx.

import type { Block, Message } from './session-types';
import type { Message as StorageMessage, Block as StorageBlock } from '../../lib/session-store';
import { getSemantic } from '../console/shared/tool-constants';

export const getTime = () => {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
};

export const genId = () => Math.random().toString(36).substring(2, 11);

export function shortenPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 2) return p;
  return '...' + parts.slice(-2).join('/');
}

export function toAppMessages(sessionId: string, msgs: StorageMessage[]): Message[] {
  return msgs.map((m, i) => ({
    id: `${sessionId}_${i}`,
    role: m.role,
    content: m.content,
    timestamp: typeof m.timestamp === 'number'
      ? new Date(m.timestamp).toLocaleTimeString()
      : m.timestamp || getTime(),
    blocks: (m.blocks || []) as unknown as Block[],
    isPending: false,
    isCompactSummary: (m as any).isCompactSummary,
  }));
}

export function toStorageMessages(msgs: Message[]): StorageMessage[] {
  return msgs.map(m => ({
    role: m.role,
    content: m.content,
    timestamp: Date.parse(m.timestamp) || Date.now(),
    blocks: m.blocks as unknown as StorageBlock[],
  }));
}

export function parseSessionBlocks(apiBlocks: any[]): Block[] {
  const result: Block[] = [];
  for (const b of apiBlocks) {
    switch (b.type) {
      case 'thinking':
        result.push({
          id: genId(), type: 'thinking', semantic: 'Analyzing...',
          toolName: '', detail: '', output: '', toolArgs: '',
          status: 'done', exitCode: -1, content: b.text || '',
          expanded: true, rawData: '',
        });
        break;
      case 'text':
        result.push({
          id: genId(), type: 'text', semantic: '', toolName: '', detail: '',
          output: '', toolArgs: '', status: 'done', exitCode: -1,
          content: b.text || '', expanded: false, rawData: '',
        });
        break;
      case 'tool_use': {
        const name = b.name || '';
        const sem = getSemantic(name);
        let detail = '';
        try {
          const input = JSON.parse(b.input || '{}');
          if (name === 'Read' || name === 'Glob' || name === 'Grep')
            detail = input.file_path || input.pattern || input.path || '';
          else if (name === 'Bash' || name === 'PowerShell')
            detail = input.command || '';
          else if (name === 'Edit' || name === 'Write')
            detail = input.file_path || '';
          else if (name === 'WebSearch')
            detail = input.query || '';
        } catch { /* ignore */ }
        result.push({
          id: genId(), type: 'tool_use', semantic: sem.label,
          toolName: name, detail, output: b.output || '', toolArgs: b.input || '',
          status: 'done', exitCode: 0, content: '', expanded: false, rawData: '',
        });
        break;
      }
      case 'tool_result':
        if (result.length > 0 && result[result.length - 1].type === 'tool_result' && !result[result.length - 1].output) {
          result[result.length - 1].output = (b.text || '').slice(0, 5000);
        } else {
          result.push({
            id: genId(), type: 'tool_result', semantic: 'Tool Result',
            toolName: '', detail: '', output: (b.text || '').slice(0, 5000),
            toolArgs: '', status: 'done', exitCode: 0, content: '',
            expanded: false, rawData: '',
          });
        }
        break;
    }
  }
  return result;
}
