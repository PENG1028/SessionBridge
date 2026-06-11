'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useCore } from '../../../sdk';
import type { ProviderConfig } from './use-provider-config';

// ─── State ──────────────────────────────────────────

export type AdapterStatus = 'idle' | 'creating' | 'running' | 'stopped' | 'error';

interface UseAdapterLifecycleReturn {
  instanceId: string | null;
  status: AdapterStatus;
  error: string | null;
  createAdapter: (dir: string, config: ProviderConfig) => Promise<string | null>;
  stopAdapter: () => Promise<void>;
  sendConfigure: () => void;
}

// ─── Hook ───────────────────────────────────────────

export function useAdapterLifecycle(): UseAdapterLifecycleReturn {
  const core = useCore();
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [status, setStatus] = useState<AdapterStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const configRef = useRef<ProviderConfig | null>(null);
  const instanceIdRef = useRef<string | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      const id = instanceIdRef.current;
      if (id && core?.isConnected) {
        core.call('run.stop', { runId: id, signal: 'kill' }).catch(() => {});
      }
    };
  }, [core]);

  const sendConfigure = useCallback(() => {
    const id = instanceIdRef.current;
    const cfg = configRef.current;
    if (!id || !cfg || !core?.isConnected) return;

    const msg = JSON.stringify({
      type: 'configure',
      provider: cfg.provider === 'anthropic' ? 'anthropic' : 'openai',
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      systemPrompt: cfg.systemPrompt || '',
    });

    core.call('stream.write', { sessionId: id, data: msg + '\n' }).catch(() => {});
  }, [core]);

  const createAdapter = useCallback(async (dir: string, config: ProviderConfig): Promise<string | null> => {
    if (!core?.isConnected) {
      setError('Core not connected');
      return null;
    }

    setStatus('creating');
    setError(null);
    configRef.current = config;

    try {
      const result = await core.call<any>('run.create', {
        kind: 'chat-adapter',
        pluginId: 'claude-chat',
        command: 'node',
        args: ['plugins/claude-chat/adapter/index.js'],
        label: 'Claude Chat',
        cwd: dir || '.',
        pty: false,               // pipe mode for structured JSON I/O
        policy: {
          onDisconnect: 'keep_running',
          onCoreShutdown: 'keep_running',
          persistHistory: false,
        },
        metadata: {
          source: 'app-ui',
          cwd: dir || '.',
          adapterId: 'claude-chat',
        },
      });

      const run = result?.run || result;
      const id = run.runId || run.sessionId || '';
      if (!id) {
        setError('No instance ID returned');
        setStatus('error');
        return null;
      }

      instanceIdRef.current = id;
      setInstanceId(id);
      setStatus('running');

      // Send initial configure message
      const msg = JSON.stringify({
        type: 'configure',
        provider: config.provider === 'anthropic' ? 'anthropic' : 'openai',
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        systemPrompt: config.systemPrompt || '',
      });

      await core.call('stream.write', { sessionId: id, data: msg + '\n' }).catch(() => {});

      return id;
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      setError(errMsg);
      setStatus('error');
      return null;
    }
  }, [core]);

  const stopAdapter = useCallback(async () => {
    const id = instanceIdRef.current;
    if (id && core?.isConnected) {
      await core.call('run.stop', { runId: id, signal: 'kill', tree: true }).catch(() => {});
    }
    instanceIdRef.current = null;
    setInstanceId(null);
    setStatus('stopped');
    configRef.current = null;
  }, [core]);

  return {
    instanceId,
    status,
    error,
    createAdapter,
    stopAdapter,
    sendConfigure,
  };
}
