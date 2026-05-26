'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch('/api/auth/status')
      .then(r => r.json())
      .then(data => {
        if (!data.configured) {
          router.replace('/setup');
        } else if (data.authenticated) {
          router.replace('/');
        } else {
          setChecking(false);
        }
      })
      .catch(() => setChecking(false));
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Login failed');
        setLoading(false);
        return;
      }

      const redirect = searchParams.get('redirect') || '/';
      router.replace(redirect);
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
            App UI Login
          </h1>
          <p className="text-[10px] text-gray-600">
            Enter your App UI password to continue.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-[9px] text-gray-500 block mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-[#111] border border-gray-700 rounded px-3 py-2 text-[11px] text-gray-200 outline-none focus:border-purple-500 font-mono"
              autoFocus
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
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}
