'use client';

import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { WSClient, SessionInfo, QueueStatus, InstanceInfo } from './ws-client';

export interface ConnStatus {
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  sessionId?: string;
  retryCount?: number;
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
  onSystemNotify?: (notification: { type: string; title: string; message?: string; scenarioId?: string; id?: string; duration?: number }) => void,
  onSystemNotifyDismiss?: (id: string) => void,
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

  // Instance management state
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [activeInstanceId, setActiveInstanceId] = useState<string | null>(null);
  const activeInstanceIdRef = useRef<string | null>(null);

  // Extension points state (from server welcome message)
  const [extensionPointsData, setExtensionPointsData] = useState<Record<string, unknown> | null>(null);

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

  // Parse output for structured info — delegates to adapter-specific parser
  const parseOutput = useCallback((data: string) => {
    // Dynamic import to avoid hardcoding Claude-specific parsing here.
    // The actual parser is in adapters/claude-code/parse-output.ts
    import('../adapters/claude-code/parse-output').then(({ parseClaudeOutputLine }) => {
      setParsed(prev => {
        const update = parseClaudeOutputLine(data, prev);
        return Object.keys(update).length > 0 ? { ...prev, ...update } : prev;
      });
      // Tool history from output
      if (data.includes('●') || /(?:Read|Edit|Bash|Glob|Grep|Tool)\s+/.test(data)) {
        const toolMatch = data.match(/(Read|Edit|Bash|Glob|Grep|Tool)\s+(.+?)(?:\n|$)/);
        if (toolMatch) {
          toolHistRef.current = [
            ...toolHistRef.current.slice(-49),
            { tool: toolMatch[1], args: toolMatch[2].trim().slice(0, 80), time: new Date().toISOString().slice(11, 19) },
          ];
          setToolHistory(toolHistRef.current);
        }
      }
    }).catch(() => {});
  }, []);

  const sendInput = useCallback((text: string, sessionId?: string) => {
    const sid = sessionId || activeSessionIdRef.current || undefined;
    const iid = activeInstanceIdRef.current || undefined;
    clientRef.current?.sendInput(text, sid, iid);
    addMsgLog('input', text);
  }, [addMsgLog]);

  const sendCommand = useCallback((name: string, args?: Record<string, string>, sessionId?: string) => {
    const sid = sessionId || activeSessionIdRef.current || undefined;
    const iid = activeInstanceIdRef.current || undefined;
    clientRef.current?.sendCommand(name, args, sid, iid);
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
        } else if (info.retryCount) {
          setConnStatus(prev => ({ ...prev, status: 'disconnected', retryCount: info.retryCount }));
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
      // Instance management callbacks
      onInstanceList: (list, activeId) => {
        setInstances(list);
        if (activeId) {
          activeInstanceIdRef.current = activeId;
          setActiveInstanceId(activeId);
        }
      },
      onInstanceAdded: (instance) => {
        setInstances(prev => {
          const exists = prev.find(i => i.id === instance.id);
          return exists ? prev : [...prev, instance];
        });
      },
      onInstanceRemoved: (id) => {
        setInstances(prev => prev.filter(i => i.id !== id));
        if (activeInstanceIdRef.current === id) {
          activeInstanceIdRef.current = null;
          setActiveInstanceId(null);
        }
      },
      onInstanceSwitched: (id) => {
        activeInstanceIdRef.current = id;
        setActiveInstanceId(id);
      },
      onSystemNotify,
      onSystemNotifyDismiss,
      onSystemMessage: (msg: any) => {
        addMsgLog('system', `${msg.title || msg.type || 'message'}: ${msg.detail || msg.message || ''}`);
      },
      onExtensionPoints: (eps) => {
        setExtensionPointsData(eps);
      },
    });

    ws.connect(initialCols, initialRows, isWorkspace);
    clientRef.current = ws;

    return () => {
      ws.disconnect();
      clientRef.current = null;
    };
  }, [wsUrl, token, appendOutput, addMsgLog, parseOutput, initialCols, initialRows, onSystemNotify]);

  // Sync refs with state
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    activeInstanceIdRef.current = activeInstanceId;
  }, [activeInstanceId]);

  const activateSession = useCallback((id: string) => {
    activeSessionIdRef.current = id;
    setActiveSessionId(id);
  }, []);

  // Instance management functions
  const activateInstance = useCallback((id: string) => {
    activeInstanceIdRef.current = id;
    setActiveInstanceId(id);
    clientRef.current?.sendCommand('switch-instance', { instanceId: id });
  }, []);

  const createInstance = useCallback(async (dir: string, label?: string, adapterId?: string) => {
    const httpBase = wsUrl.replace(/^ws/, 'http');
    try {
      const res = await fetch(`${httpBase}/api/instances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir, label, adapterId }),
      });
      const result = await res.json();
      addMsgLog('system', `Created instance in ${dir}: ${result.success ? 'OK' : result.error}`);
      if (result.success && result.instance) {
        setInstances(prev => {
          const exists = prev.find(i => i.id === result.instance.id);
          return exists ? prev : [...prev, result.instance];
        });
      }
      return result;
    } catch (err) {
      addMsgLog('error', `Create instance failed: ${err}`);
      return { success: false, error: String(err) };
    }
  }, [wsUrl, addMsgLog]);

  const killInstance = useCallback(async (id: string) => {
    const httpBase = wsUrl.replace(/^ws/, 'http');
    try {
      const res = await fetch(`${httpBase}/api/instances/${id}`, { method: 'DELETE' });
      const result = await res.json();
      addMsgLog('system', `Killed instance ${id}: ${result.success ? 'OK' : result.error}`);
      return result;
    } catch (err) {
      addMsgLog('error', `Kill instance failed: ${err}`);
      return { success: false, error: String(err) };
    }
  }, [wsUrl, addMsgLog]);

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
    // Instance management
    instances,
    activeInstanceId,
    activateInstance,
    createInstance,
    killInstance,
    // Extension points
    extensionPointsData,
  };
}
