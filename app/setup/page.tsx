'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function SetupPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch('/api/auth/status')
      .then(r => r.json())
      .then(data => {
        if (data.configured) {
          router.replace('/login');
        } else {
          setChecking(false);
        }
      })
      .catch(() => setChecking(false));
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Setup failed');
        setLoading(false);
        return;
      }

      window.location.href = '/';
    } catch {
      setError('Network error');
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-[11px] text-gray-600 font-mono">Checking...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-[13px] font-mono tracking-wider uppercase text-gray-300 mb-2">
            App UI Setup
          </h1>
          <p className="text-[10px] text-gray-600">
            Create an initial password to secure this App UI.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-[9px] text-gray-500 block mb-1">Password (min 8 chars)</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-[#111] border border-gray-700 rounded px-3 py-2 text-[11px] text-gray-200 outline-none focus:border-purple-500 font-mono"
              autoFocus
              minLength={8}
            />
          </div>

          <div>
            <label className="text-[9px] text-gray-500 block mb-1">Confirm Password</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              className="w-full bg-[#111] border border-gray-700 rounded px-3 py-2 text-[11px] text-gray-200 outline-none focus:border-purple-500 font-mono"
              minLength={8}
            />
          </div>

          {error && (
            <div className="text-[10px] text-red-400 bg-red-900/20 border border-red-800/30 rounded px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-[10px] rounded border border-purple-600 transition-colors font-mono"
          >
            {loading ? 'Setting up...' : 'Set Password & Login'}
          </button>
        </form>
      </div>
    </div>
  );
}
