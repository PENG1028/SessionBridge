// ─── Claude Code SessionProvider ──────────────────────────────
// Implements SessionProvider for Claude Code's JSONL session format.
// Extracted from relay-server.ts to keep session logic adapter-local.
//
// Reads ~/.claude/history.jsonl for session search and
// ~/.claude/projects/<slug>/<sessionId>.jsonl for conversation detail.

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import {
  getClaudeDataDir, getClaudeProjectsDir,
  getClaudeHistoryPath, getClaudeSessionPath, getProjectSlug,
} from './runtime';
import type { SessionProvider, SessionSearchResult, SessionDetail, SessionMessage } from '../types';

// ─── Helpers ──────────────────────────────────────────────────

function getSessionFile(slug: string, sessionId: string): string {
  return getClaudeSessionPath(slug, sessionId);
}

// ─── Compaction Count ─────────────────────────────────────────

function getCompactionCount(project: string, sessionId: string): number {
  try {
    const slug = project.replace(/[\\/: ]/g, '-');
    const f = getSessionFile(slug, sessionId);
    if (!existsSync(f)) return 0;
    const c = readFileSync(f, 'utf8');
    return (c.match(/"isCompactSummary":true/g) || []).length;
  } catch {
    return 0;
  }
}

// ─── JSONL Message Parsing ────────────────────────────────────
// Shared logic for /detail and /current endpoints.

function parseSessionLines(lines: string[]): { messages: SessionMessage[]; content?: string } {
  // Pre-scan: queue-operation enqueue content → used to detect system-generated user messages
  const systemContents = new Set<string>();
  for (const line of lines) {
    try {
      const p = JSON.parse(line);
      if (p.type === 'queue-operation' && p.operation === 'enqueue' && typeof p.content === 'string') {
        systemContents.add(p.content.slice(0, 200));
      }
    } catch { /* skip malformed lines */ }
  }

  const messages: SessionMessage[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      const entryType = parsed.type || '';
      if (entryType === 'queue-operation') continue;

      const message = parsed.message || {};
      const role = message.role || '';
      const contentArr = Array.isArray(message.content) ? message.content : [];
      const textContent = typeof message.content === 'string' ? message.content : '';

      if (!role) continue;
      if (contentArr.length === 0 && !textContent) continue;

      const blocks: any[] = [];
      let combinedText = '';

      for (const c of contentArr) {
        switch (c.type) {
          case 'text':
            blocks.push({ type: 'text', text: c.text || '' });
            combinedText += (c.text || '') + ' ';
            break;
          case 'thinking':
            blocks.push({ type: 'thinking', text: c.thinking || '' });
            break;
          case 'tool_use':
            blocks.push({
              type: 'tool_use',
              name: c.name || '',
              input: JSON.stringify(c.input || {}),
            });
            combinedText += `[${c.name}] `;
            break;
          case 'plan':
            blocks.push({ type: 'plan', text: c.plan || c.text || '' });
            combinedText += '[Plan] ';
            break;
          case 'tool_result': {
            const resultText = typeof c.content === 'string' ? c.content
              : Array.isArray(c.content) ? c.content.map((x: any) => x.text || x.content || '').join('\n')
              : JSON.stringify(c.content || '');
            blocks.push({ type: 'tool_result', text: resultText.slice(0, 2000) });
            break;
          }
        }
      }

      if (contentArr.length === 0 && textContent) {
        blocks.push({ type: 'text', text: textContent });
        combinedText = textContent;
      }

      const isSystem = role === 'user' && textContent && systemContents.has(textContent.slice(0, 200));

      messages.push({
        role,
        blocks,
        text: combinedText.trim().slice(0, 5000),
        timestamp: parsed.timestamp || 0,
        isCompactSummary: parsed.isCompactSummary === true || message.isCompactSummary === true,
        isSystem,
      });
    } catch { /* skip malformed lines */ }
  }

  return { messages };
}

// ─── Group consecutive assistant entries ──────────────────────
// Claude Code splits a single assistant turn across multiple JSONL entries
// (one per content block: thinking, tool_use, text). Merge them back.

function groupConsecutiveAssistantEntries(messages: SessionMessage[]): SessionMessage[] {
  const grouped: SessionMessage[] = [];
  for (const msg of messages) {
    const last = grouped[grouped.length - 1];
    if (last && last.role === 'assistant' && msg.role === 'assistant') {
      last.blocks.push(...msg.blocks);
      if (msg.text) last.text = (last.text + ' ' + msg.text).trim().slice(0, 5000);
      if (msg.timestamp) last.timestamp = msg.timestamp;
      if (msg.isCompactSummary) last.isCompactSummary = true;
    } else {
      grouped.push({ ...msg, blocks: [...msg.blocks] });
    }
  }
  return grouped;
}

// ─── Merge tool_results into tool_use blocks ──────────────────

function distributeToolResults(messages: SessionMessage[]): SessionMessage[] {
  const grouped = groupConsecutiveAssistantEntries(messages);
  const merged: SessionMessage[] = [];
  for (const msg of grouped) {
    if (msg.role === 'user' && msg.blocks.length > 0 && msg.blocks.every((b: any) => b.type === 'tool_result')) {
      if (merged.length > 0) {
        const prev = merged[merged.length - 1];
        // Distribute tool_results in order to unmatched tool_use blocks
        let ti = 0;
        for (const block of msg.blocks) {
          if (block.type === 'tool_result') {
            let found = false;
            for (let i = ti; i < prev.blocks.length; i++) {
              if (prev.blocks[i].type === 'tool_use' && !prev.blocks[i].output) {
                prev.blocks[i].output = (block.text || '').slice(0, 3000);
                ti = i + 1;
                found = true;
                break;
              }
            }
            if (!found) {
              for (let i = prev.blocks.length - 1; i >= 0; i--) {
                if (prev.blocks[i].type === 'tool_use') {
                  prev.blocks[i].output = (prev.blocks[i].output || '') + '\n' + (block.text || '').slice(0, 3000);
                  break;
                }
              }
            }
          }
        }
      }
    } else {
      merged.push({
        role: msg.role,
        blocks: msg.blocks,
        text: msg.text,
        timestamp: msg.timestamp,
        isCompactSummary: msg.isCompactSummary,
        isSystem: msg.isSystem,
      });
    }
  }
  return merged;
}

// ─── ClaudeSessionProvider ────────────────────────────────────

export class ClaudeSessionProvider implements SessionProvider {
  searchSessions(query?: string): SessionSearchResult[] {
    const historyFile = getClaudeHistoryPath();
    const results: SessionSearchResult[] = [];

    try {
      if (!existsSync(historyFile)) return [];

      const content = readFileSync(historyFile, 'utf8');
      const lines = content.split('\n').filter(Boolean).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);

      const q = (query || '').toLowerCase().trim();

      for (const entry of lines) {
        const display = entry.display || '';
        const project = entry.project || '';
        const sessionId = entry.sessionId || '';
        const ts = entry.timestamp || 0;

        const inDisplay = q ? display.toLowerCase().includes(q) : false;
        const inProject = q ? project.toLowerCase().includes(q) : false;

        if (q && !inDisplay && !inProject) {
          const projectSlug = project.replace(/[\\/: ]/g, '-');
          const sessionFile = getSessionFile(projectSlug, sessionId);
          try {
            const st = statSync(sessionFile);
            if (st.size > 0 && st.size <= 100 * 1024) { // skip large files to avoid OOM
              const sessionContent = readFileSync(sessionFile, 'utf8');
              if (sessionContent.toLowerCase().includes(q)) {
                const idx = sessionContent.toLowerCase().indexOf(q);
                const start = Math.max(0, idx - 60);
                const end = Math.min(sessionContent.length, idx + q.length + 120);
                results.push({
                  sessionId,
                  display: display.slice(0, 200),
                  project,
                  timestamp: ts,
                  matchedIn: 'content',
                  snippet: sessionContent.slice(start, end).replace(/\n/g, ' ').trim(),
                  compactionCount: (sessionContent.match(/"isCompactSummary":true/g) || []).length,
                });
                continue;
              }
            }
          } catch { /* skip */ }
        }

        if (!q || inDisplay || inProject) {
          results.push({
            sessionId,
            display: display.slice(0, 300),
            project,
            timestamp: ts,
            matchedIn: q ? (inDisplay ? 'display' : 'project') : '',
            snippet: '',
          });
        }
      }

      results.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      // Deduplicate by sessionId (keep most recent entry per session)
      const seen = new Set<string>();
      const deduped = results.filter(r => {
        if (seen.has(r.sessionId)) return false;
        seen.add(r.sessionId);
        return true;
      });
      const limited = deduped.slice(0, 50);
      // Compute compaction count for all limited results
      for (const r of limited) {
        if (r.compactionCount === undefined) {
          r.compactionCount = getCompactionCount(r.project, r.sessionId);
        }
      }

      return limited;
    } catch {
      return [];
    }
  }

  getSessionDetail(sessionId: string, project?: string): SessionDetail | { error: string } {
    if (!sessionId) return { error: 'Missing sessionId' };

    try {
      let sessionContent = '';
      if (project) {
        const projectSlug = project.replace(/[\\/: ]/g, '-');
        const sessionFile = getSessionFile(projectSlug, sessionId);
        if (existsSync(sessionFile)) {
          sessionContent = readFileSync(sessionFile, 'utf8');
        }
      }

      if (!sessionContent) {
        const projectsDir = getClaudeProjectsDir();
        if (existsSync(projectsDir)) {
          const projectDirs = readdirSync(projectsDir);
          for (const pdir of projectDirs) {
            const candidateFile = getSessionFile(pdir, sessionId);
            if (existsSync(candidateFile)) {
              sessionContent = readFileSync(candidateFile, 'utf8');
              break;
            }
          }
        }
      }

      if (!sessionContent) {
        return { sessionId, messages: [] };
      }

      const lines = sessionContent.split('\n').filter(Boolean);
      const { messages } = parseSessionLines(lines);
      const mergedMessages = distributeToolResults(messages);

      return { sessionId, messages: mergedMessages, content: sessionContent.slice(0, 50000) };
    } catch (err) {
      return { error: String(err) };
    }
  }

  getCurrentSession(workingDir: string) {
    try {
      const projectSlug = getProjectSlug(workingDir);
      const projectsDir = getClaudeProjectsDir();
      const targetDir = join(projectsDir, projectSlug);
      let latestFile = '';
      let latestTime = 0;

      if (existsSync(targetDir)) {
        const files = readdirSync(targetDir).filter(f => f.endsWith('.jsonl'));
        for (const f of files) {
          const fp = join(targetDir, f);
          const mtime = statSync(fp).mtimeMs;
          if (mtime > latestTime) { latestTime = mtime; latestFile = fp; }
        }
      }

      if (!latestFile) {
        return { sessionId: '', messages: [], found: false };
      }

      const sessionId = basename(latestFile, '.jsonl');
      const sessionContent = readFileSync(latestFile, 'utf8');
      const lines = sessionContent.split('\n').filter(Boolean);
      const { messages } = parseSessionLines(lines);
      const mergedMessages = distributeToolResults(messages);

      return { sessionId, messages: mergedMessages, found: true };
    } catch {
      return { sessionId: '', messages: [], found: false };
    }
  }

  getCompactionCount(project: string, sessionId: string): number {
    return getCompactionCount(project, sessionId);
  }
}
