'use client';

// ─── PluginErrorBoundary ─────────────────────────────────────────
// Catches errors in plugin components so a single plugin crash
// doesn't take down the entire UI.

import React from 'react';

interface Props { children: React.ReactNode; pluginId: string; }
interface State { error: Error | null; }

export class PluginErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex-1 flex items-center justify-center bg-[#0a0a0a]">
          <div className="text-[11px] font-mono text-center max-w-sm px-4">
            <div className="text-red-400 font-bold mb-2">
              Plugin "{this.props.pluginId}" crashed
            </div>
            <div className="text-[10px] text-red-500/70 mb-3 break-all">
              {this.state.error.message}
            </div>
            <button
              onClick={() => this.setState({ error: null })}
              className="text-[10px] px-3 py-1 rounded bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-700 transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
