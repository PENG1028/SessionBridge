// ─── Host Configuration Schema ──────────────────────────────────
// Registers core NodeConfig settings into the ConfigurationRegistry
// so they appear alongside extension settings in the unified UI.

import { configRegistry } from './registry';
import type { ConfigurationPropertySchema } from './types';

const restart = { requiresRestart: true };
const secret = { secret: true };

export function registerHostConfig(): void {
  // ── Dashboard ────────────────────────────────────────────────
  configRegistry.registerHost('host', 'SessionBridge', {
    // Identity
    'label': {
      type: 'string', default: '', scope: 'workspace',
      description: 'Human-readable node name (default: hostname)',
    },
    'role': {
      type: 'string', default: 'auto', scope: 'workspace',
      enum: ['auto', 'relay', 'leaf'],
      description: 'Node role — auto-detect or force relay/leaf',
      ...restart,
    },

    // Relay
    'relayPort': {
      type: 'integer', default: 8080, scope: 'workspace',
      minimum: 1, maximum: 65535,
      description: 'Relay WebSocket server port',
      ...restart,
    },
    'relayBind': {
      type: 'string', default: '0.0.0.0', scope: 'workspace',
      description: 'Relay bind address',
      ...restart,
    },
    'relayToken': {
      type: 'string', default: '', scope: 'workspace',
      description: 'Relay authentication token (empty = no auth)',
      ...secret,
    },
    'upstreamRelay': {
      type: 'string', default: '', scope: 'workspace',
      description: 'Upstream relay WebSocket URL (leaf mode)',
    },

    // Dashboard (deprecated — admin routes are now served through the relay)
    'dashboardPort': {
      type: 'integer', default: 9843, scope: 'workspace',
      minimum: 1, maximum: 65535,
      description: '@deprecated Dashboard is now served through relay port',
      ...restart,
    },
    'dashboardBind': {
      type: 'string', default: '127.0.0.1', scope: 'workspace',
      description: '@deprecated Dashboard is now served through relay port',
      ...restart,
    },
    'dashboard.authEnabled': {
      type: 'boolean', default: true, scope: 'workspace',
      description: 'Require password to access the dashboard',
    },
    'dashboardToken': {
      type: 'string', default: '', scope: 'workspace',
      description: 'Dashboard access password (empty = prompt on first access)',
      ...secret,
    },
    'dashboardSessionTtl': {
      type: 'integer', default: 1209600, scope: 'workspace',
      minimum: 3600, maximum: 31536000,
      description: 'Dashboard session duration in seconds (default: 14 days)',
    },

    // Notifications
    'ntfyTopic': {
      type: 'string', default: '', scope: 'user',
      description: 'ntfy.sh topic for push notifications',
    },

    // Crypto
    'crypto.enabled': {
      type: 'boolean', default: true, scope: 'workspace',
      description: 'Enable ECDH+AES-GCM encryption for WebSocket transport',
      ...restart,
    },

    // Dev
    'devMode': {
      type: 'boolean', default: false, scope: 'workspace',
      description: 'Development mode (extension hot-reload, debugging)',
      ...restart,
    },
  });
}
