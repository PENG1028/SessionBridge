'use client';

import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { useCore } from '../app/console/core/core-client-provider';

// Re-export types for consumers
export type { ConnStatus, MsgLog, SessionInfo, InstanceInfo, QueueStatus } from './session-types';
import type { ConnStatus, MsgLog, SessionInfo, InstanceInfo, QueueStatus, RunLike } from './session-types';

function nowTime() {
  return new Date().toISOString().slice(11, 23);
}

function shellCommandForClient() {
  // Let Go Core decide the default shell based on its OS.
  return '';
}

function mapRunToInstance(run: RunLike): InstanceInfo {
  const id = run.runId || run.sessionId || '';
  return {
    id,
    dir: run.metadata?.cwd || '.',
    label: run.label || run.kind || run.process?.command || id || 'Run',
    status: run.state || 'unknown',
    source: 'local',
    adapterId: run.pluginId || run.kind || 'terminal',
    model: null,
    blockCount: 0,
    outputSize: 0,
    checkpointCount: 0,
    createdAt: run.createdAt || Date.now(),
  };
}

/**
 * CoreClient-backed replacement for the old relay WS hook.
 *
 * The return shape intentionally matches the old hook so existing App UI code
 * can migrate incrementally, but this hook does not open its own WebSocket,
 * does not send relay "hello" messages, and does not call legacy /api endpoints.
 */
export function useSession(
  _wsUrl: string,
  _token?: string,
  _initialCols?: number,
  _initialRows?: number,
  onChunk?: (data: string) => void,
  onSystemNotify?: (notification: { type: string; title: string; message?: string; scenarioId?: string; id?: string; duration?: number }) => void,
  _onSystemNotifyDismiss?: (id: string) => void,
  onSystemMessage?: (msg: any) => void,
) {
  const core = useCore();
  const [connStatus, setConnStatus] = useState<ConnStatus>({
    status: core.isConnected ? 'connected' : 'connecting',
  });
  const [output, setOutput] = useState('');
  const [msgLog, setMsgLog] = useState<MsgLog[]>([]);
  const [serverBlocks] = useState<any[]>([]);
  const [queueStatus] = useState<QueueStatus>({ processing: false, source: null, queueDepth: 0 });
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [activeInstanceId, setActiveInstanceId] = useState<string | null>(null);
  const activeInstanceIdRef = useRef<string | null>(null);
  const msgIdRef = useRef(0);
  const outputRef = useRef('');

  const addMsgLog = useCallback((type: string, data: string) => {
    msgIdRef.current++;
    const entry: MsgLog = {
      id: msgIdRef.current,
      time: nowTime(),
      type,
      data: data.length > 200 ? `${data.slice(0, 200)}...` : data,
      size: data.length,
    };
    setMsgLog(prev => {
      const next = [...prev, entry];
      return next.length > 500 ? next.slice(-500) : next;
    });
  }, []);

  const appendOutput = useCallback((data: string) => {
    outputRef.current += data;
    if (outputRef.current.length > 500 * 1024) {
      outputRef.current = outputRef.current.slice(-500 * 1024);
    }
    setOutput(outputRef.current);
    onChunk?.(data);
  }, [onChunk]);

  const refreshRuns = useCallback(async () => {
    if (!core.isConnected) return;
    try {
      const result = await core.call<{ runs?: RunLike[]; entries?: RunLike[] } | RunLike[]>('run.list', {});
      const runs = Array.isArray(result) ? result : (result?.runs || result?.entries || []);
      const mapped = runs.map(mapRunToInstance).filter(i => i.id);
      setInstances(mapped);
      setSessions(mapped.map(i => ({
        id: i.id,
        directory: i.dir,
        label: i.label,
        hasBridge: true,
        hasClient: true,
        webUrl: '',
      })));
      if (!activeInstanceIdRef.current && mapped.length > 0) {
        activeInstanceIdRef.current = mapped[0].id;
        setActiveInstanceId(mapped[0].id);
      }
      if (!activeSessionIdRef.current && mapped.length > 0) {
        activeSessionIdRef.current = mapped[0].id;
        setActiveSessionId(mapped[0].id);
      }
    } catch (err) {
      addMsgLog('error', `run.list failed: ${String(err)}`);
    }
  }, [core, addMsgLog]);

  useEffect(() => {
    setConnStatus({ status: core.isConnected ? 'connected' : 'connecting' });
    void refreshRuns();

    const offStatus = core.on('connectionStatus', (event: any) => {
      setConnStatus({ status: event.status === 'connected' ? 'connected' : event.status });
      if (event.status === 'connected') void refreshRuns();
    });
    const offConnected = core.on('connected', () => {
      setConnStatus({ status: 'connected' });
      void refreshRuns();
    });
    const offChunk = core.on('stream.chunk', (event: any) => {
      if (event?.data != null) {
        appendOutput(String(event.data));
        addMsgLog('output', String(event.data));
      }
    });
    const offSessionStopped = core.on('session.stopped', (event: any) => {
      const id = event.sessionId;
      if (!id) return;
      setInstances(prev => prev.map(i => i.id === id ? { ...i, status: 'stopped' } : i));
    });

    return () => {
      offStatus();
      offConnected();
      offChunk();
      offSessionStopped();
    };
  }, [core, appendOutput, addMsgLog, refreshRuns]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    activeInstanceIdRef.current = activeInstanceId;
  }, [activeInstanceId]);

  const sendInput = useCallback((text: string, sessionId?: string) => {
    const sid = sessionId || activeSessionIdRef.current || activeInstanceIdRef.current || undefined;
    if (sid && core.isConnected) {
      core.call('stream.write', { sessionId: sid, data: text }).catch(err => {
        addMsgLog('error', `stream.write failed: ${String(err)}`);
      });
    }
    addMsgLog('input', text);
  }, [core, addMsgLog]);

  const sendCommand = useCallback((name: string, args?: Record<string, unknown>, sessionId?: string) => {
    const sid = sessionId || activeSessionIdRef.current || activeInstanceIdRef.current || undefined;
    if (name === 'interrupt' && sid && core.isConnected) {
      core.call('run.stop', { runId: sid, signal: 'interrupt' }).catch(err => {
        addMsgLog('error', `run.stop failed: ${String(err)}`);
      });
    }
    if (name === 'clear') {
      outputRef.current = '';
      setOutput('');
    }
    addMsgLog('command', `${name}${args ? ` ${JSON.stringify(args)}` : ''}`);
  }, [core, addMsgLog]);

  const sendShellInput = useCallback((data: string, instanceId: string) => {
    if (core.isConnected) {
      core.call('stream.write', { sessionId: instanceId, data }).catch(err => {
        addMsgLog('error', `stream.write failed: ${String(err)}`);
      });
    }
  }, [core, addMsgLog]);

  const sendResize = useCallback((cols: number, rows: number) => {
    const sid = activeSessionIdRef.current || activeInstanceIdRef.current;
    if (sid && core.isConnected) {
      core.call('process.resize', { sessionId: sid, cols, rows }).catch(err => {
        console.warn('[use-ws] process.resize failed:', err);
      });
    }
  }, [core]);

  const sendMessage = useCallback((type: string, body: Record<string, unknown> = {}) => {
    addMsgLog('system', type);
    onSystemMessage?.({ type, ...body });
    return false;
  }, [addMsgLog, onSystemMessage]);

  const activateSession = useCallback((id: string) => {
    activeSessionIdRef.current = id;
    setActiveSessionId(id);
    activeInstanceIdRef.current = id;
    setActiveInstanceId(id);
  }, []);

  const activateInstance = useCallback((id: string) => {
    activeInstanceIdRef.current = id;
    setActiveInstanceId(id);
    activeSessionIdRef.current = id;
    setActiveSessionId(id);
  }, []);

  const createInstance = useCallback(async (dir: string, label?: string, adapterId?: string) => {
    if (!core.isConnected) {
      return { success: false, error: 'Core is not connected' };
    }
    try {
      const command = adapterId === 'claude-code' ? 'claude' : shellCommandForClient();
      const result = await core.call<any>('run.create', {
        kind: adapterId || 'terminal',
        pluginId: adapterId || 'terminal',
        label: label || adapterId || 'Terminal',
        command,
        cwd: dir || '.',
        pty: true,
        policy: {
          onDisconnect: 'keep_running',
          onCoreShutdown: 'keep_running',
          persistHistory: true,
          restartRestore: false,
        },
        metadata: { source: 'app-ui', cwd: dir || '.', adapterId: adapterId || 'terminal' },
      });
      const run = result?.run || result;
      const instance = mapRunToInstance({
        runId: run.runId,
        sessionId: run.sessionId,
        kind: adapterId || run.kind,
        pluginId: adapterId || run.pluginId,
        label: label || run.label,
        state: run.state || 'running',
        createdAt: run.createdAt,
        metadata: { cwd: dir || '.', adapterId: adapterId || 'terminal' },
      });
      setInstances(prev => prev.some(i => i.id === instance.id) ? prev : [...prev, instance]);
      activateInstance(instance.id);
      addMsgLog('system', `Created run ${instance.id}`);
      return { success: true, instance, runId: instance.id, sessionId: run.sessionId || instance.id };
    } catch (err) {
      addMsgLog('error', `Create run failed: ${String(err)}`);
      return { success: false, error: String(err) };
    }
  }, [core, addMsgLog, activateInstance]);

  const killInstance = useCallback(async (id: string) => {
    setInstances(prev => prev.filter(i => i.id !== id));
    if (activeInstanceIdRef.current === id) {
      activeInstanceIdRef.current = null;
      setActiveInstanceId(null);
    }
    if (core.isConnected) {
      try {
        await core.call('run.stop', { runId: id, signal: 'kill', tree: true });
        addMsgLog('system', `Stopped run ${id}`);
        return { success: true };
      } catch (err) {
        addMsgLog('error', `Stop run failed: ${String(err)}`);
        return { success: false, error: String(err) };
      }
    }
    return { success: false, error: 'Core is not connected' };
  }, [core, addMsgLog]);

  const spawnSession = useCallback(async (directory: string, label?: string) => {
    return createInstance(directory, label, 'terminal');
  }, [createInstance]);

  const activeBlocks = useMemo(() => serverBlocks, [serverBlocks]);

  return {
    connStatus,
    msgLog,
    sendInput,
    sendCommand,
    queueStatus,
    activeSessionId,
    instances,
    activeInstanceId,
    activateInstance,
    createInstance,
    killInstance,
  };
}
