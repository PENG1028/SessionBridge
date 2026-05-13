'use client';

import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { WSClient, SessionInfo, QueueStatus, InstanceInfo } from './ws-client';

export interface ConnStatus {
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  sessionId?: string;
  retryCount?: number;
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
  onSystemMessage?: (msg: any) => void,
) {
  const clientRef = useRef<WSClient | null>(null);
  const [connStatus, setConnStatus] = useState<ConnStatus>({ status: 'connecting' });
  const [output, setOutput] = useState<string>('');
  const [msgLog, setMsgLog] = useState<MsgLog[]>([]);
  const [serverBlocks, setServerBlocks] = useState<any[]>([]);
  const [queueStatus, setQueueStatus] = useState<QueueStatus>({ processing: false, source: null, queueDepth: 0 });
  const outputRef = useRef('');
  const msgIdRef = useRef(0);
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

  const sendShellInput = useCallback((data: string, instanceId: string) => {
    clientRef.current?.sendShellInput(data, instanceId);
  }, []);

  const sendMessage = useCallback((type: string, body: Record<string, unknown> = {}) => {
    clientRef.current?.send(type, body);
    addMsgLog('system', type);
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
      onInstanceUpdated: (instance) => {
        setInstances(prev => prev.map(i => i.id === instance.id ? { ...i, ...instance } : i));
      },
      onSystemNotify,
      onSystemNotifyDismiss,
      onSystemMessage: (msg: any) => {
        addMsgLog('system', `${msg.title || msg.type || 'message'}: ${msg.detail || msg.message || ''}`);
        onSystemMessage?.(msg);
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
  }, [wsUrl, token, appendOutput, addMsgLog, initialCols, initialRows, onSystemNotify]);

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
    // Optimistic removal from local state so the instance disappears from
    // the UI immediately — prevents repeated clicks while the API call is
    // in flight. The server broadcast (instance.removed) handles cleanup
    // for other clients; this is just for local responsiveness.
    setInstances(prev => prev.filter(i => i.id !== id));
    try {
      const res = await fetch(`${httpBase}/api/instances/${id}`, { method: 'DELETE' });
      const result = await res.json();
      addMsgLog('system', `Killed instance ${id}: ${result.success ? 'OK' : result.error}`);
      return result;
    } catch (err) {
      addMsgLog('error', `Kill instance failed: ${err}`);
      return { success: false, error: String(err) };
    }
  }, [wsUrl, addMsgLog, setInstances]);

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
    msgLog,
    serverBlocks,
    sendInput,
    sendCommand,
    sendShellInput,
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
    // Generic message send
    sendMessage,
  };
}
