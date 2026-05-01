'use client';

import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { WSClient, SessionInfo, QueueStatus } from './ws-client';

export interface ConnStatus {
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  sessionId?: string;
}

export interface ParsedInfo {
  model?: string;
  version?: string;
  task?: string;
  tool?: string;
  toolArgs?: string;
  inputTokens?: number;
  outputTokens?: number;
  cost?: string;
  turnCount?: number;
  cwd?: string;
}

export interface MsgLog {
  id: number;
  time: string;
  type: string;
  data: string;
  size: number;
}

export function useSession(
  wsUrl: string,
  token?: string,
  initialCols?: number,
  initialRows?: number,
  onChunk?: (data: string) => void,
) {
  const clientRef = useRef<WSClient | null>(null);
  const [connStatus, setConnStatus] = useState<ConnStatus>({ status: 'connecting' });
  const [output, setOutput] = useState<string>('');
  const [parsed, setParsed] = useState<ParsedInfo>({});
  const [msgLog, setMsgLog] = useState<MsgLog[]>([]);
  const [toolHistory, setToolHistory] = useState<{ tool: string; args: string; time: string }[]>([]);
  const [serverBlocks, setServerBlocks] = useState<any[]>([]);
  const [queueStatus, setQueueStatus] = useState<QueueStatus>({ processing: false, source: null, queueDepth: 0 });
  const outputRef = useRef('');
  const msgIdRef = useRef(0);
  const toolHistRef = useRef<{ tool: string; args: string; time: string }[]>([]);
  const blocksRef = useRef<any[]>([]);

  // Workspace mode state
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const isWorkspace = !token; // workspace mode when no token

  const appendOutput = useCallback((data: string) => {
    outputRef.current += data;
    // Keep only last 500KB to avoid memory issues
    if (outputRef.current.length > 500 * 1024) {
      outputRef.current = outputRef.current.slice(-500 * 1024);
    }
    setOutput(outputRef.current);
  }, []);

  const addMsgLog = useCallback((type: string, data: string) => {
    msgIdRef.current++;
    const entry: MsgLog = {
      id: msgIdRef.current,
      time: new Date().toISOString().slice(11, 23),
      type,
      data: data.length > 200 ? data.slice(0, 200) + '...' : data,
      size: data.length,
    };
    setMsgLog(prev => {
      const next = [...prev, entry];
      return next.length > 500 ? next.slice(-500) : next;
    });
  }, []);

  // Parse output for structured info
  const parseOutput = useCallback((data: string) => {
    // Try to extract model name from Claude Code header
    // Format: "ClaudeCode v2.1.123 deepseek-v4-flash · API Usage Billing <cwd>"
    // or     "Claude Code v2.1.123 deepseek-v4-flash · API Usage Billing <cwd>"
    const headerMatch = data.match(/(?:Claude\s*Code)\s+(v[\d.]+)\s+([\w.-]+)/);
    if (headerMatch) {
      setParsed(prev => ({ ...prev, version: headerMatch[1], model: headerMatch[2] }));
    }
    // Extract cwd from status line: "· API Usage Billing F:\path"
    // or just "Billing F:\path"
    const cwdMatch = data.match(/Billing\s+((?:[A-Za-z]:)?[\\\/][^\s\x1B[?]*[^\s\x1B[?;,])/);
    if (cwdMatch) {
      const cwd = cwdMatch[1].trim();
      if (cwd.length > 2) setParsed(prev => ({ ...prev, cwd }));
    }
    // Try extracting from the header line if Billing pattern didn't work
    if (!cwdMatch) {
      const altCwd = data.match(/(?:API\s*Usage|Billing)\s+((?:[A-Za-z]:)?[\\\/][^\x1B\r\n\x1B[?]{2,}?)/);
      if (altCwd) {
        const cwd = altCwd[1].replace(/[\x1B\[\]\d;]+$/, '').trim();
        if (cwd.length > 2) setParsed(prev => ({ ...prev, cwd }));
      }
    }
    // Try to extract tool calls from output
    if (data.includes('●') || data.includes('Read ') || data.includes('Edit ') || data.includes('Bash ') || data.includes('Tool ')) {
      const toolMatch = data.match(/(Read|Edit|Bash|Glob|Grep|Tool)\s+(.+?)(?:\n|$)/);
      if (toolMatch) {
        const toolName = toolMatch[1];
        const toolArgs = toolMatch[2].trim();
        setParsed(prev => ({
          ...prev,
          tool: toolName,
          toolArgs: toolArgs.length > 80 ? toolArgs.slice(0, 80) + '...' : toolArgs,
        }));
        toolHistRef.current = [
          ...toolHistRef.current.slice(-49),
          { tool: toolName, args: toolArgs, time: new Date().toISOString().slice(11, 19) },
        ];
        setToolHistory(toolHistRef.current);
      }
    }
    // Try to extract task description
    const taskMatch = data.match(/^#️⃣\s*(.+?)$/m) || data.match(/^##\s*(.+?)$/m) || data.match(/^(.{10,80}?)\s*\.\.\./m);
    if (taskMatch) {
      setParsed(prev => ({ ...prev, task: taskMatch[1].trim() }));
    }
    // Extract token info from status bar
    const tokenMatch = data.match(/(\d+[KMB]?)\s*tokens?/i);
    if (tokenMatch) {
      setParsed(prev => ({ ...prev, inputTokens: parseInt(tokenMatch[1]) }));
    }
    const costMatch = data.match(/\$([\d.]+)/);
    if (costMatch) {
      setParsed(prev => ({ ...prev, cost: '$' + costMatch[1] }));
    }
  }, []);

  const sendInput = useCallback((text: string, sessionId?: string) => {
    const sid = sessionId || activeSessionIdRef.current || undefined;
    clientRef.current?.sendInput(text, sid);
    addMsgLog('input', text);
  }, [addMsgLog]);

  const sendCommand = useCallback((name: string, args?: Record<string, string>, sessionId?: string) => {
    const sid = sessionId || activeSessionIdRef.current || undefined;
    clientRef.current?.sendCommand(name, args, sid);
    addMsgLog('command', name);
  }, [addMsgLog]);

  const sendResize = useCallback((cols: number, rows: number) => {
    clientRef.current?.sendResize(cols, rows);
  }, []);

  // Collect server-side blocks, deduplicate by a simple hash
  const addBlock = useCallback((block: any) => {
    blocksRef.current = [...blocksRef.current, block];
    if (blocksRef.current.length > 200) {
      blocksRef.current = blocksRef.current.slice(-200);
    }
    setServerBlocks(blocksRef.current);
  }, []);

  useEffect(() => {
    const ws = new WSClient(wsUrl, token ?? '', {
      onStatusChange: (info) => {
        if (info.authenticated) {
          setConnStatus({ status: 'connected', sessionId: info.sessionId });
        } else {
          setConnStatus({ status: 'error', sessionId: info.sessionId });
        }
      },
      onOutput: (data) => {
        appendOutput(data);
        addMsgLog('output', data);
        parseOutput(data);
        onChunk?.(data);
      },
      onBlock: (block) => {
        addBlock(block);
        addMsgLog('block', `${block.blockType}: ${block.text ?? block.name ?? ''}`);
      },
      onCommandResult: (result) => {
        addMsgLog('command_result', JSON.stringify(result));
      },
      onError: (msg) => {
        addMsgLog('error', msg);
        setConnStatus(prev => ({ ...prev, status: 'error' }));
      },
      onDisconnect: () => {
        setConnStatus({ status: 'disconnected' });
      },
      onQueueStatus: (status) => {
        setQueueStatus(status);
        addMsgLog('queue', `Queue: ${status.processing ? `processing (${status.source})` : 'idle'} [${status.queueDepth} pending]`);
      },
      // Workspace mode callbacks
      onSessionsList: (list) => {
        setSessions(list);
        // Auto-select first session if none active
        if (list.length > 0 && !activeSessionIdRef.current) {
          const first = list[0].id;
          activeSessionIdRef.current = first;
          setActiveSessionId(first);
        }
      },
      onSessionAdded: (session) => {
        setSessions(prev => {
          const exists = prev.find(s => s.id === session.id);
          return exists ? prev : [...prev, session];
        });
        if (!activeSessionIdRef.current) {
          activeSessionIdRef.current = session.id;
          setActiveSessionId(session.id);
        }
      },
      onSessionRemoved: (id) => {
        setSessions(prev => prev.filter(s => s.id !== id));
        if (activeSessionIdRef.current === id) {
          activeSessionIdRef.current = null;
          setActiveSessionId(null);
        }
      },
      onWorkspaceConnected: () => {
        setConnStatus({ status: 'connected', sessionId: 'workspace' });
      },
    });

    ws.connect(initialCols, initialRows, isWorkspace);
    clientRef.current = ws;

    return () => {
      ws.disconnect();
      clientRef.current = null;
    };
  }, [wsUrl, token, appendOutput, addMsgLog, parseOutput, initialCols, initialRows]);

  // Sync ref with state
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  const activateSession = useCallback((id: string) => {
    activeSessionIdRef.current = id;
    setActiveSessionId(id);
  }, []);

  const spawnSession = useCallback(async (directory: string, label?: string) => {
    const httpBase = wsUrl.replace(/^ws/, 'http');
    try {
      const res = await fetch(`${httpBase}/api/spawn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory, label }),
      });
      const result = await res.json();
      addMsgLog('system', `Spawning agent in ${directory}: ${result.success ? 'OK' : result.error}`);
      return result;
    } catch (err) {
      addMsgLog('error', `Spawn failed: ${err}`);
      return { success: false, error: String(err) };
    }
  }, [wsUrl, addMsgLog]);

  // Block filtering by active session
  const activeBlocks = useMemo(() => {
    if (!isWorkspace) return serverBlocks;
    return serverBlocks.filter((b: any) => !b.sessionId || b.sessionId === activeSessionId);
  }, [serverBlocks, activeSessionId, isWorkspace]);

  return {
    connStatus,
    output,
    parsed,
    msgLog,
    toolHistory,
    serverBlocks,
    sendInput,
    sendCommand,
    sendResize,
    queueStatus,
    // Workspace state
    sessions,
    activeSessionId,
    activateSession,
    spawnSession,
    activeBlocks,
    isWorkspace,
  };
}
