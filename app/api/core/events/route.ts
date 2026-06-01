// ─── GET /api/core/events ─────────────────────────────────────
// Server-Sent Events endpoint: forwards Core WebSocket messages
// as SSE events to authenticated App UI clients.
//
// Why SSE instead of WebSocket:
//   Next.js App Router route handlers use the Web standard
//   Request/Response API and do not expose the raw Node.js
//   http.Server needed for ws upgrade. SSE works natively with
//   ReadableStream and HTTP/1.1 keepalive.
//
// Browser → Core calls still go through POST /api/core/call.
// This endpoint only pushes Core → Browser events.
//
// The Core token (SESSIONNODE_TOKEN) lives only on the server.
//
// Requires valid App UI session cookie (middleware checks
// presence; this handler does HMAC verification).

import { NextRequest } from 'next/server';
import { WebSocket as WsWebSocket } from 'ws';
import { verifySessionFromCookie } from '../../../../lib/auth/app-ui-auth';
import { getCoreWsUrl, getCoreToken } from '../../../../lib/core-target';

export const runtime = 'nodejs';

/** 15-second timeout for the initial WebSocket connection to Core. */
const CONNECT_TIMEOUT = 15_000;

// ─── GET ─────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // Dev bypass: skip session verification when SESSIONBRIDGE_AUTH_BYPASS=1
  if (process.env.SESSIONBRIDGE_AUTH_BYPASS !== '1') {
    const cookie = request.cookies.get('sessionbridge_view')?.value;
    const session = await verifySessionFromCookie(cookie);
    if (!session.ok) {
      return new Response('Authentication required', { status: 401 });
    }
  }

  // 2. Build Core WS URL — token is server-side only, never reaches the browser
  const wsUrl = getCoreWsUrl();
  const token = getCoreToken();
  const connectUrl = token
    ? wsUrl + (wsUrl.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token)
    : wsUrl;

  // 3. Create SSE stream with Core WebSocket bridge
  let coreWs: WsWebSocket | null = null;
  let cleanup = false;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Handle client disconnect — Next.js aborts the request signal
      // before the ReadableStream cancel() callback fires.
      request.signal.addEventListener('abort', () => {
        if (!cleanup) {
          cleanup = true;
          if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
          if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
          if (coreWs) {
            coreWs.close();
            coreWs = null;
          }
        }
      });

      coreWs = new WsWebSocket(connectUrl);

      // Connection timeout: if Core WS doesn't open, close the SSE stream
      connectTimer = setTimeout(() => {
        if (!cleanup) {
          cleanup = true;
          coreWs?.close();
          coreWs = null;
          controller.enqueue(new TextEncoder().encode(
            'event: error\ndata: {"type":"error","message":"Core connection timeout"}\n\n'
          ));
          try { controller.close(); } catch {}
        }
      }, CONNECT_TIMEOUT);

      // Heartbeat: send SSE comment every 25s to keep proxies alive.
      // Most proxies (nginx, Cloudflare) timeout idle connections at 60-120s.
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

      coreWs.on('open', () => {
        if (cleanup) return;
        if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }

        // Signal that the bridge is up — client event multiplexer
        // transitions to 'connected' on receiving this.
        controller.enqueue(new TextEncoder().encode(
          `event: core\ndata: ${JSON.stringify({ type: 'connected', pluginId: 'sessionnode-core' })}\n\n`
        ));

        // Start heartbeat (SSE comment lines are ignored by EventSource)
        heartbeatTimer = setInterval(() => {
          if (cleanup) return;
          try {
            controller.enqueue(new TextEncoder().encode(': heartbeat\n\n'));
          } catch { /* stream closed */ }
        }, 25_000);
      });

      coreWs.on('message', (raw: Buffer) => {
        if (cleanup) return;
        try {
          const text = raw.toString();
          controller.enqueue(new TextEncoder().encode(
            `event: core\ndata: ${text}\n\n`
          ));
        } catch {
          // Ignore encode errors (e.g. stream already closed)
        }
      });

      coreWs.on('error', (err: Error) => {
        if (cleanup) return;
        cleanup = true;
        if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
        try {
          controller.enqueue(new TextEncoder().encode(
            `event: error\ndata: {"type":"error","message":"${err.message.replace(/["\\]/g, '')}"}\n\n`
          ));
        } catch {}
        try { controller.close(); } catch {}
        coreWs?.close();
        coreWs = null;
      });

      coreWs.on('close', () => {
        if (cleanup) return;
        cleanup = true;
        if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
        try { controller.close(); } catch {}
        coreWs = null;
      });
    },
    cancel() {
      if (cleanup) return;
      cleanup = true;
      if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
      if (coreWs) {
        coreWs.close();
        coreWs = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
