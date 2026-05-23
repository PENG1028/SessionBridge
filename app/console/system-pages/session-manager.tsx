'use client';

import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import type { CoreClient, SessionInfo } from '../core/core-types';
import { PageHeader, PageLoading, PageError, PageEmpty, PageOffline, type PageState } from './page-utils';
import { listFromResponse, normalizeSessionInfo } from './core-response-utils';

interface SessionManagerProps {
  core: CoreClient;
}

/**
 * Session Manager — view all sessions, stream replay, send input.
 * Calls: session.list, session.get, session.destroy, stream.replay, stream.tail, stream.write
 * Events: session.created (WS), session.stopped (WS)
 *
 * Core truth: session list from Core. No localStorage persistence of session data.
 * Tab projections are rebuilt on page load from session.list.
 * stream.write is the ONLY stdinput method.
 */
export function SessionManager({ core }: SessionManagerProps) {
  const [pageState, setPageState] = useState<PageState>('loading');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  const [streamContent, setStreamContent] = useState<string[]>([]);
  const [inputText, setInputText] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function fetchSessions() {
    if (!core.isConnected) {
      setPageState('offline');
      return;
    }

    setPageState('loading');
    setError(null);

    try {
      const result = await core.call<unknown>('session.list');
      const normalized = listFromResponse<Partial<SessionInfo> & Record<string, unknown>>(result, 'sessions').map(normalizeSessionInfo);
      setSessions(normalized);
      setPageState(normalized.length > 0 ? 'ready' : 'empty');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
      setPageState('error');
    }
  }

  async function handleSessionStop(sessionId: string) {
    try {
      await core.call('session.destroy', { sessionId });
      fetchSessions();
    } catch (err) {
      console.error('Failed to stop session:', err);
    }
  }

  async function handleStreamReplay(sessionId: string) {
    try {
      const result = await core.call<{ events?: Array<{ data: string }> }>('stream.replay', {
        sessionId,
        streamType: 'stdout',
      });
      setStreamContent((result?.events || []).map(e => e.data));
    } catch (err) {
      setStreamContent([`[Error: Failed to replay stream — ${err instanceof Error ? err.message : 'unknown error'}]`]);
    }
  }

  async function handleStreamTail(sessionId: string) {
    try {
      const result = await core.call<{ events?: Array<{ data: string }> }>('stream.tail', {
        sessionId,
        streamType: 'stdout',
        lines: 50,
      });
      setStreamContent((result?.events || []).map(e => e.data));
    } catch (err) {
      setStreamContent([`[Error: Failed to tail stream — ${err instanceof Error ? err.message : 'unknown error'}]`]);
    }
  }

  async function handleSendInput(sessionId: string) {
    if (!inputText.trim()) return;
    try {
      // stream.write is the ONLY stdin method — no process.stdin or stream.stdin
      await core.call('stream.write', {
        sessionId,
        data: inputText + '\n',
        streamType: 'stdin',
      });
      setInputText('');
      // Also show what was sent in the stream output
      setStreamContent(prev => [...prev, `> ${inputText}`]);
    } catch (err) {
      console.error('Failed to send input:', err);
    }
  }

  useEffect(() => {
    fetchSessions();
  }, [core]);

  if (pageState === 'loading') return <div className="flex-1"><PageLoading rows={5} /></div>;
  if (pageState === 'offline') return <div className="flex-1"><PageOffline /></div>;
  if (pageState === 'error') return <div className="flex-1"><PageError message={error || 'Unknown error'} onRetry={fetchSessions} /></div>;
  if (pageState === 'empty') return <div className="flex-1"><PageEmpty title="No active sessions" description="Sessions will appear here when created by plugins or the system." /></div>;

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <PageHeader
        title="Sessions"
        actions={
          <button
            onClick={fetchSessions}
            className="p-1.5 rounded hover:bg-[#1a1a1a] text-gray-400 hover:text-gray-200 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
        }
      />

      <div className="flex-1 flex">
        {/* Session list */}
        <div className="w-1/2 border-r border-gray-800 p-3 overflow-y-auto">
          <div className="space-y-1.5">
            {sessions.map(session => (
              <div
                key={session.sessionId}
                className={`p-2.5 rounded border cursor-pointer transition-colors ${
                  selectedSession?.sessionId === session.sessionId
                    ? 'border-purple-500/50 bg-purple-900/10'
                    : 'border-gray-800 bg-[#111] hover:bg-[#1a1a1a]'
                }`}
                onClick={() => {
                  setSelectedSession(session);
                  handleStreamTail(session.sessionId);
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${
                      session.status === 'running' ? 'bg-emerald-500' :
                      session.status === 'stopped' ? 'bg-gray-600' :
                      session.status === 'failed' ? 'bg-red-500' :
                      'bg-yellow-500'
                    }`} />
                    <span className="font-mono text-[10px] text-gray-300">{session.sessionId}</span>
                  </div>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                    session.status === 'running' ? 'bg-emerald-900/30 text-emerald-400' :
                    session.status === 'stopped' ? 'bg-[#1a1a1a] text-gray-500' :
                    'bg-yellow-900/30 text-yellow-400'
                  }`}>
                    {session.status}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1 text-[9px] text-gray-500">
                  <span>{session.kind}</span>
                  {session.pluginId && <span>{'·'} {session.pluginId}</span>}
                  {session.nodeId && <span>{'·'} {session.nodeId}</span>}
                  {session.uptime && <span>{'·'} {session.uptime}</span>}
                </div>

                {/* Actions */}
                <div className="flex gap-1.5 mt-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleStreamReplay(session.sessionId); }}
                    className="text-[9px] px-2 py-1 rounded bg-[#1a1a1a] hover:bg-[#222] text-gray-400 transition-colors"
                  >
                    Replay
                  </button>
                  {session.status === 'running' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleSessionStop(session.sessionId); }}
                      className="text-[9px] px-2 py-1 rounded bg-red-900/20 hover:bg-red-900/40 text-red-400 transition-colors"
                    >
                      Stop
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Stream view / detail */}
        <div className="flex-1 flex flex-col p-3 overflow-hidden">
          {selectedSession ? (
            <>
              {/* Stream output */}
              <div className="flex-1 bg-black rounded border border-gray-800 p-3 overflow-y-auto font-mono text-[11px] text-gray-300 mb-3">
                {streamContent.length === 0 ? (
                  <span className="text-gray-600">Stream output will appear here. Use Replay or tail to load.</span>
                ) : (
                  streamContent.map((line, i) => (
                    <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
                  ))
                )}
              </div>

              {/* Input bar — stream.write is the ONLY stdin interface */}
              {selectedSession.status === 'running' && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={inputText}
                    onChange={e => setInputText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendInput(selectedSession.sessionId);
                      }
                    }}
                    placeholder="Send input to session (stream.write)..."
                    className="flex-1 px-3 py-1.5 bg-[#1a1a1a] border border-gray-700 rounded text-[10px] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500"
                  />
                  <button
                    onClick={() => handleSendInput(selectedSession.sessionId)}
                    className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-[10px] rounded transition-colors"
                  >
                    Send
                  </button>
                </div>
              )}

              {selectedSession.status !== 'running' && (
                <div className="text-center text-gray-500 text-[9px] py-2">
                  Session is {selectedSession.status}. Use Replay to view history.
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-600 text-[10px] font-mono">
              Select a session to view its stream
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
