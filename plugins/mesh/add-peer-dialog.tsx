'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

export function AddPeerDialog({ onClose, core }: { onClose: () => void; core: { call: Function } }) {
  const [tab, setTab] = useState<'invite' | 'direct'>('invite');

  const [peerUrl, setPeerUrl] = useState('');
  const [code, setCode] = useState('');
  const [nameHint, setNameHint] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [acceptErr, setAcceptErr] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);

  const handleAccept = async () => {
    if (!peerUrl.trim() || !code.trim()) return;
    setAccepting(true);
    setAcceptErr(null);
    try {
      await core.call('node.invite.accept', { peerUrl: peerUrl.trim(), code: code.trim(), nameHint: nameHint.trim() || undefined });
      onClose();
    } catch (err) {
      setAcceptErr(err instanceof Error ? err.message : 'Failed to accept invite');
    } finally {
      setAccepting(false);
    }
  };

  const handleCreate = async () => {
    setCreating(true);
    setCreateErr(null);
    setCreatedCode(null);
    try {
      const result = await core.call('node.invite.create', { ttlSeconds: 300, nameHint: nameHint.trim() || undefined });
      setCreatedCode(result.code);
    } catch (err) {
      setCreateErr(err instanceof Error ? err.message : 'Failed to create invite');
    } finally {
      setCreating(false);
    }
  };

  function copyCode() {
    if (createdCode) {
      navigator.clipboard.writeText(createdCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-[#111] border border-gray-700 rounded-lg w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
          <span className="text-[11px] font-mono text-gray-200">Add Peer</span>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400 text-lg leading-none">&times;</button>
        </div>

        <div className="flex border-b border-gray-800">
          <button onClick={() => setTab('invite')}
            className={`flex-1 px-3 py-1.5 text-[10px] font-mono border-b-2 transition-colors ${
              tab === 'invite' ? 'border-purple-500 text-purple-400' : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}>Invite Code</button>
          <button onClick={() => setTab('direct')}
            className={`flex-1 px-3 py-1.5 text-[10px] font-mono border-b-2 transition-colors ${
              tab === 'direct' ? 'border-purple-500 text-purple-400' : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}>Direct Add</button>
        </div>

        <div className="p-4 space-y-3">
          {tab === 'invite' ? (
            <>
              <div>
                <h4 className="text-[9px] text-gray-500 mb-2">Generate invite code for another node to connect to this Core:</h4>
                <div className="flex gap-2">
                  <input type="text" value={nameHint} onChange={e => setNameHint(e.target.value)}
                    placeholder="name hint (optional)"
                    className="flex-1 px-2 py-1 bg-[#1a1a1a] border border-gray-700 rounded text-[10px] text-gray-200 focus:border-purple-500 outline-none placeholder:text-gray-600" />
                  <button onClick={handleCreate} disabled={creating}
                    className="px-3 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white text-[10px] transition-colors disabled:opacity-50">
                    {creating ? 'Creating...' : 'Generate'}
                  </button>
                </div>
                {createErr && <div className="text-[9px] text-red-400 mt-1">{createErr}</div>}
                {createdCode && (
                  <div className="mt-2 p-2 bg-black rounded border border-emerald-800/50">
                    <div className="text-[9px] text-emerald-400 mb-1">One-time code (copy now):</div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 font-mono text-[10px] text-gray-200 break-all">{createdCode}</code>
                      <button onClick={copyCode} className="p-1 rounded hover:bg-[#1a1a1a] text-gray-400 hover:text-gray-200">
                        {codeCopied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-gray-800 pt-3">
                <h4 className="text-[9px] text-gray-500 mb-2">Or accept an invite from another Core:</h4>
                <div className="space-y-2">
                  <input type="text" value={peerUrl} onChange={e => setPeerUrl(e.target.value)}
                    placeholder="ws://host:port/peer/ws"
                    className="w-full px-2 py-1 bg-[#1a1a1a] border border-gray-700 rounded text-[10px] text-gray-200 focus:border-purple-500 outline-none placeholder:text-gray-600" />
                  <div className="flex gap-2">
                    <input type="text" value={code} onChange={e => setCode(e.target.value)}
                      placeholder="invite code"
                      className="flex-1 px-2 py-1 bg-[#1a1a1a] border border-gray-700 rounded text-[10px] text-gray-200 font-mono focus:border-purple-500 outline-none placeholder:text-gray-600" />
                    <input type="text" value={nameHint} onChange={e => setNameHint(e.target.value)}
                      placeholder="name (optional)"
                      className="w-28 px-2 py-1 bg-[#1a1a1a] border border-gray-700 rounded text-[10px] text-gray-200 focus:border-purple-500 outline-none placeholder:text-gray-600" />
                  </div>
                  <button onClick={handleAccept} disabled={accepting || !peerUrl.trim() || !code.trim()}
                    className="px-3 py-1 rounded bg-emerald-900/20 text-emerald-400 hover:bg-emerald-900/40 text-[10px] transition-colors disabled:opacity-50">
                    {accepting ? 'Accepting...' : 'Accept Invite'}
                  </button>
                  {acceptErr && <div className="text-[9px] text-red-400 mt-1">{acceptErr}</div>}
                </div>
              </div>
            </>
          ) : (
            <div className="text-[10px] text-gray-500 space-y-3">
              <p className="font-mono">Connect directly to a peer Core by address.</p>
              <input type="text" disabled
                placeholder="remote address (ws://host:port/peer/ws)"
                className="w-full px-2 py-1 bg-[#1a1a1a] border border-gray-700 rounded text-[10px] text-gray-600 outline-none cursor-not-allowed" />
              <input type="text" disabled
                placeholder="node ID (optional)"
                className="w-full px-2 py-1 bg-[#1a1a1a] border border-gray-700 rounded text-[10px] text-gray-600 outline-none cursor-not-allowed" />
              <div className="text-[9px] text-yellow-600 bg-yellow-900/10 border border-yellow-800/30 rounded px-2 py-1">
                Direct peer add requires a <code className="text-yellow-400">node.peer.connect</code> Core API. Use invite code pairing instead.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
