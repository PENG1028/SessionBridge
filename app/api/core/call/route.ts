// ─── POST /api/core/call ─────────────────────────────────────
// Server-side Core capability proxy.
// Receives { method, params }, connects to Go Core via WebSocket,
// sends action.request, and returns the action.response.
//
// The Core token (SESSIONNODE_TOKEN) lives only on the server.
// The browser never sees it.
//
// This route requires a valid App UI session cookie (verified via
// verifySessionFromCookie). Middleware gates cookie presence;
// this handler does the actual HMAC verification.

import { NextRequest, NextResponse } from 'next/server';
import { WebSocket as WsWebSocket } from 'ws';
import { verifySessionFromCookie } from '../../../../lib/auth/app-ui-auth';
import { getCoreWsUrl, getCoreToken } from '../../../../lib/core-target';

export const runtime = 'nodejs';

const CALL_TIMEOUT = 10_000; // 10 seconds

// ─── POST ────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Dev bypass: skip session verification when SESSIONBRIDGE_AUTH_BYPASS=1
  if (process.env.SESSIONBRIDGE_AUTH_BYPASS !== '1') {
    const cookie = request.cookies.get('sessionbridge_view')?.value;
    const session = await verifySessionFromCookie(cookie);
    if (!session.ok) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
  }

  // 2. Parse request body
  let body: { method?: string; params?: Record<string, unknown>; pluginId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { method, params = {} } = body;
  if (!method || typeof method !== 'string') {
    return NextResponse.json({ error: 'method is required' }, { status: 400 });
  }

  // 3. Connect to Go Core and send action.request
  const wsUrl = getCoreWsUrl();
  const token = getCoreToken();

  const connectUrl = token
    ? wsUrl + (wsUrl.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token)
    : wsUrl;

  try {
    const result = await coreCall(connectUrl, method, params, body.pluginId || 'sessionnode-core', token);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Core call failed';
    console.error(`[core-call] wsUrl=${wsUrl} token=${token ? 'set' : 'NOT SET'} method=${method} error=${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

// ─── Core WebSocket call helper ─────────────────────────────

interface CoreCallResponse {
  ok?: boolean;
  error?: { code?: string; message?: string };
  payload?: unknown;
}

async function coreCall(
  connectUrl: string,
  method: string,
  params: Record<string, unknown>,
  actorPluginId: string,
  coreToken?: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WsWebSocket(connectUrl);

    const requestId = `proxy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // Extract targetNodeId from params (routing field)
    const { targetNodeId, ...payload } = params;

    const body = JSON.stringify({
      type: 'action.request',
      requestId,
      capability: method,
      payload,
      pluginId: actorPluginId,
      actorType: 'user',
      actorId: 'current-user',
      actorToken: coreToken || '',
      ...(targetNodeId ? { targetNodeId } : {}),
    });

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close();
        reject(new Error(`Core call timeout: ${method}`));
      }
    }, CALL_TIMEOUT);

    ws.on('open', () => {
      ws.send(body);
    });

    ws.on('message', (raw: Buffer) => {
      if (settled) return;
      try {
        const msg = JSON.parse(raw.toString());

        // Handle action.response
        if (msg.type === 'action.response' && msg.requestId === requestId) {
          settled = true;
          clearTimeout(timer);
          ws.close();

          if (msg.ok === false || msg.error != null) {
            const errMsg = msg.error
              ? (typeof msg.error === 'string' ? msg.error : (msg.error.message || JSON.stringify(msg.error)))
              : 'Core action failed';
            reject(new Error(errMsg));
          } else {
            resolve(msg.payload);
          }
          return;
        }

        // Handle welcome (ignore — just a handshake)
        if (msg.type === 'hello' || msg.type === 'welcome') {
          return;
        }
      } catch {
        // Ignore parse errors on individual messages
      }
    });

    ws.on('error', (err: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`WebSocket error: ${err.message}`));
      }
    });

    ws.on('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error('WebSocket closed before response'));
      }
    });
  });
}
