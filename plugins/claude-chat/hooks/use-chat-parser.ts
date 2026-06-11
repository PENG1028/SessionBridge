'use client';

/**
 * useChatParser — subscribes to Core stream events via CoreClient,
 * parses structured blocks (thinking, tool_use, text, token_usage, done),
 * and returns { messages, turns, phase } for chat UI components.
 *
 * Supports two modes:
 *   'cli'     — raw text to Claude CLI, expects JSON-per-line output
 *   'adapter' — JSON messages to adapter process, expects same output format
 *
 * @see docs/archive/core-legacy-2026-05-19/extensions/claude-code/parser.ts
 */

import { useRef, useReducer, useEffect, useMemo, useCallback } from 'react';
import { useCore } from '../../../sdk';
import type { Message, Block, Phase, Turn } from '../types';

// ── Mode ──

export type ChatMode = 'cli' | 'adapter';

// ── Helpers ──

const genId = () => Math.random().toString(36).substring(2, 11);
const getTime = () => new Date().toLocaleTimeString();

function ensureAssistant(msgs: Message[]): Message[] {
  const updated = [...msgs];
  const last = updated[updated.length - 1];
  if (!last || last.role !== 'assistant') {
    updated.push({
      id: genId(), role: 'assistant', content: '',
      timestamp: getTime(), blocks: [], isPending: true,
    });
  }
  return updated;
}

function ensureTextBlock(blocks: Block[]): Block[] {
  const last = blocks[blocks.length - 1];
  if (last?.type === 'text') return blocks;
  return [...blocks, {
    id: genId(), type: 'text' as const, semantic: '', toolName: '',
    detail: '', output: '', toolArgs: '', status: 'done' as const,
    exitCode: -1, content: '', expanded: false, rawData: '',
  }];
}

// ── Parser mutable state (ref, not rendered) ──

interface ParserContext {
  thinkingId: string | null;
  thinkingText: string;
  toolUseId: string | null;
  toolUseName: string;
  toolUseArgs: string;
  toolResult: string;
  chunkBuffer: string;
}

function freshCtx(): ParserContext {
  return { thinkingId: null, thinkingText: '', toolUseId: null, toolUseName: '', toolUseArgs: '', toolResult: '', chunkBuffer: '' };
}

// ── Reducer ──

interface ChatReducerState {
  messages: Message[];
  phase: Phase;
}

type Action =
  | { type: 'USER_MSG'; id: string; text: string; ts: string }
  | { type: 'THINKING_START'; id: string }
  | { type: 'THINKING_DELTA'; id: string; text: string }
  | { type: 'THINKING_DONE'; id: string; text: string }
  | { type: 'TOOL_START'; id: string; name: string; args: string }
  | { type: 'TOOL_DONE'; id: string; result: string }
  | { type: 'TEXT_DELTA'; text: string }
  | { type: 'ASSISTANT_DONE' }
  | { type: 'SET_PHASE'; phase: Phase }
  | { type: 'RESET' };

const INITIAL: ChatReducerState = { messages: [], phase: 'idle' };

function reducer(st: ChatReducerState, a: Action): ChatReducerState {
  let msgs = [...st.messages];

  switch (a.type) {
    case 'USER_MSG': {
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant' && last.isPending) {
        msgs[msgs.length - 1] = { ...last, isPending: false };
      }
      msgs.push({
        id: a.id, role: 'user', content: a.text, timestamp: a.ts, blocks: [], isPending: false,
      });
      return { messages: msgs, phase: 'running' };
    }

    case 'THINKING_START': {
      msgs = ensureAssistant(msgs);
      const asst = { ...msgs[msgs.length - 1] };
      asst.blocks = [...asst.blocks, {
        id: a.id, type: 'thinking', semantic: 'Analyzing...', toolName: '', detail: '',
        output: '', toolArgs: '', status: 'running', exitCode: -1, content: '', expanded: false, rawData: '',
      }];
      msgs[msgs.length - 1] = asst;
      return { ...st, messages: msgs };
    }

    case 'THINKING_DELTA': {
      msgs = ensureAssistant(msgs);
      const asst = { ...msgs[msgs.length - 1] };
      asst.blocks = asst.blocks.map(b => b.id === a.id ? { ...b, content: a.text } : b);
      msgs[msgs.length - 1] = asst;
      return { ...st, messages: msgs };
    }

    case 'THINKING_DONE': {
      msgs = ensureAssistant(msgs);
      const asst = { ...msgs[msgs.length - 1] };
      asst.blocks = asst.blocks.map(b => b.id === a.id ? { ...b, content: a.text, status: 'done' as const } : b);
      msgs[msgs.length - 1] = asst;
      return { ...st, messages: msgs };
    }

    case 'TOOL_START': {
      msgs = ensureAssistant(msgs);
      const asst = { ...msgs[msgs.length - 1] };
      asst.blocks = [...asst.blocks, {
        id: a.id, type: 'tool_use', semantic: '', toolName: a.name,
        detail: '', output: '', toolArgs: a.args, status: 'running' as const,
        exitCode: -1, content: '', expanded: false, rawData: '',
      }];
      msgs[msgs.length - 1] = asst;
      return { ...st, messages: msgs };
    }

    case 'TOOL_DONE': {
      msgs = ensureAssistant(msgs);
      const asst = { ...msgs[msgs.length - 1] };
      asst.blocks = asst.blocks.map(b =>
        b.id === a.id ? { ...b, status: 'done' as const, output: a.result } : b
      );
      msgs[msgs.length - 1] = asst;
      return { ...st, messages: msgs };
    }

    case 'TEXT_DELTA': {
      msgs = ensureAssistant(msgs);
      const asst = { ...msgs[msgs.length - 1] };
      let blocks = [...asst.blocks];
      blocks = ensureTextBlock(blocks);
      const lastB = blocks[blocks.length - 1];
      blocks[blocks.length - 1] = { ...lastB, content: lastB.content + a.text };
      asst.blocks = blocks;
      msgs[msgs.length - 1] = asst;
      return { ...st, messages: msgs };
    }

    case 'ASSISTANT_DONE': {
      msgs = msgs.map(m => m.role === 'assistant' && m.isPending ? { ...m, isPending: false } : m);
      return { ...st, messages: msgs };
    }

    case 'SET_PHASE': {
      msgs = msgs.map(m => m.role === 'assistant' && m.isPending ? { ...m, isPending: false } : m);
      return { messages: msgs, phase: a.phase };
    }

    case 'RESET': {
      return { messages: [], phase: 'idle' };
    }

    default:
      return st;
  }
}

// ─── Hook ──

export function useChatParser(
  instanceId: string,
  mode: ChatMode = 'cli',
) {
  const core = useCore();
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const ctxRef = useRef<ParserContext>(freshCtx());

  // Subscribe to stream.chunk for response data
  useEffect(() => {
    if (!core?.isConnected || !instanceId) return;

    const handler = (event: any) => {
      if (event.type !== 'stream.chunk') return;
      const raw = String(event.data || '');
      if (!raw) return;

      const ctx = ctxRef.current;
      ctx.chunkBuffer += raw;

      const lines = ctx.chunkBuffer.split('\n');
      ctx.chunkBuffer = lines.pop() || '';

      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        let ev: any;
        try { ev = JSON.parse(t); } catch { continue; }
        if (!ev?.type) continue;
        processEvent(ev, ctx, dispatch);
      }
    };

    core.on('stream.chunk', handler);
    return () => { core.off('stream.chunk', handler); };
  }, [core, instanceId]);

  // Build turns for components
  const turns = useMemo((): Turn[] => {
    const result: Turn[] = [];
    for (const msg of state.messages) {
      if (msg.role === 'user') result.push({ userMsg: msg, assistantMsgs: [] });
      else if (result.length > 0) result[result.length - 1].assistantMsgs.push(msg);
    }
    return result;
  }, [state.messages]);

  // ── Send user message ──
  const sendMessage = useCallback((text: string) => {
    if (!text.trim() || !core?.isConnected) return;
    const id = genId();
    dispatch({ type: 'USER_MSG', id, text, ts: getTime() });

    if (mode === 'adapter') {
      // JSON message for adapter
      core.call('stream.write', {
        sessionId: instanceId,
        data: JSON.stringify({ type: 'user_message', text }) + '\n',
      }).catch(() => {});
    } else {
      // Raw text for CLI
      core.call('stream.write', { sessionId: instanceId, data: text + '\n' }).catch(() => {});
    }
  }, [core, instanceId, mode]);

  // ── Configure adapter ──
  const sendConfigure = useCallback((cfg: {
    provider: string;
    apiKey: string;
    baseUrl: string;
    model: string;
    systemPrompt?: string;
  }) => {
    if (!core?.isConnected) return;
    core.call('stream.write', {
      sessionId: instanceId,
      data: JSON.stringify({ type: 'configure', ...cfg }) + '\n',
    }).catch(() => {});
  }, [core, instanceId]);

  // ── Send tool result back to adapter ──
  const sendToolResult = useCallback((toolUseId: string, content: string) => {
    if (!core?.isConnected) return;
    core.call('stream.write', {
      sessionId: instanceId,
      data: JSON.stringify({ type: 'tool_result', toolUseId, content }) + '\n',
    }).catch(() => {});
  }, [core, instanceId]);

  // ── Interrupt ──
  const interrupt = useCallback(() => {
    if (core?.isConnected) {
      if (mode === 'adapter') {
        core.call('stream.write', {
          sessionId: instanceId,
          data: JSON.stringify({ type: 'interrupt' }) + '\n',
        }).catch(() => {});
      }
      core.call('run.stop', { runId: instanceId, signal: 'interrupt' }).catch(() => {});
    }
    dispatch({ type: 'SET_PHASE', phase: 'done' });
  }, [core, instanceId, mode]);

  // ── Reset session ──
  const resetSession = useCallback(() => {
    if (core?.isConnected && mode === 'adapter') {
      core.call('stream.write', {
        sessionId: instanceId,
        data: JSON.stringify({ type: 'reset' }) + '\n',
      }).catch(() => {});
    }
    dispatch({ type: 'RESET' });
    ctxRef.current = freshCtx();
  }, [core, instanceId, mode]);

  return {
    messages: state.messages,
    turns,
    phase: state.phase,
    sendMessage,
    sendConfigure,
    sendToolResult,
    interrupt,
    resetSession,
  };
}

// ── JSON event processor (mirrors archived parser.ts) ──

function processEvent(
  ev: any,
  ctx: ParserContext,
  dispatch: React.Dispatch<Action>,
): void {
  switch (ev.type) {

    case 'stream_event': {
      const e = ev.event;
      if (!e) break;

      switch (e.type) {
        case 'content_block_start': {
          const cb = e.content_block;
          if (!cb) break;
          if (cb.type === 'thinking') {
            ctx.thinkingId = cb.id || genId();
            ctx.thinkingText = '';
            dispatch({ type: 'THINKING_START', id: ctx.thinkingId! });
          } else if (cb.type === 'tool_use') {
            ctx.toolUseId = cb.id || genId();
            ctx.toolUseName = cb.name || '';
            ctx.toolUseArgs = JSON.stringify(cb.input || {});
            dispatch({ type: 'TOOL_START', id: ctx.toolUseId!, name: ctx.toolUseName, args: ctx.toolUseArgs });
          }
          break;
        }

        case 'content_block_delta': {
          const d = e.delta;
          if (!d) break;
          if (d.type === 'thinking_delta' && ctx.thinkingId) {
            ctx.thinkingText += d.thinking || '';
            if (ctx.thinkingText.split(/\s+/).length % 20 === 0) {
              dispatch({ type: 'THINKING_DELTA', id: ctx.thinkingId, text: ctx.thinkingText });
            }
          } else if (d.type === 'text_delta') {
            const text = d.text || '';
            if (text) dispatch({ type: 'TEXT_DELTA', text });
          }
          break;
        }
      }
      break;
    }

    case 'user': {
      for (const c of ev.message?.content || []) {
        if (c.type === 'tool_result') {
          const rc = c.content;
          ctx.toolResult = typeof rc === 'string' ? rc
            : Array.isArray(rc) ? rc.map((x: any) => x.text || '').join('\n')
            : JSON.stringify(rc || '');
        }
      }
      break;
    }

    case 'assistant': {
      if (ctx.thinkingId) {
        dispatch({ type: 'THINKING_DONE', id: ctx.thinkingId, text: ctx.thinkingText });
        ctx.thinkingId = null;
        ctx.thinkingText = '';
      }
      for (const c of ev.message?.content || []) {
        if (c.type === 'tool_use') {
          const id = ctx.toolUseId || genId();
          dispatch({ type: 'TOOL_DONE', id, result: ctx.toolResult || '' });
          ctx.toolUseId = null;
          ctx.toolResult = '';
        }
      }
      break;
    }

    case 'result': {
      dispatch({ type: 'ASSISTANT_DONE' });
      dispatch({ type: 'SET_PHASE', phase: ev.subtype === 'success' ? 'done' : 'error' });
      break;
    }

    case 'system': {
      if (ev.subtype === 'error') {
        dispatch({ type: 'SET_PHASE', phase: 'error' });
      }
      break;
    }
  }
}
