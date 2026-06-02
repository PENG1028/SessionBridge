'use client';

// ─── Core call error categories ───────────────────────────
// Every core.call() failure maps to one of these.
// UI components use the category to decide what to show.

export type CoreErrorCategory =
  | 'connection'        // Core WS/SSE not connected at all
  | 'mesh-unreachable'  // targetNodeId peer is offline
  | 'timeout'           // request exceeded deadline
  | 'forbidden'         // auth/permission denied
  | 'bad-request'       // invalid method or params
  | 'not-found'         // resource not found
  | 'unknown';          // everything else

export class CoreError extends Error {
  readonly category: CoreErrorCategory;

  constructor(message: string, category: CoreErrorCategory = 'unknown') {
    super(message);
    this.name = 'CoreError';
    this.category = category;
  }
}

// ─── Error code table ─────────────────────────────────────
// Canonical source: go-core/pkg/protocol/errors.go
// Add new codes there first, then mirror here.
// Keep sorted — adding a code here is adding one line only.

const CODE_TO_CATEGORY: Record<string, CoreErrorCategory> = {
  // ── Connection / Auth ──
  'UNAUTHENTICATED':          'connection',
  'ACTOR_TYPE_NODE_BLOCKED':  'forbidden',

  // ── Permission ──
  'PERMISSION_DENIED':        'forbidden',
  'CAPABILITY_NOT_DECLARED':  'forbidden',
  'CAPABILITY_UNSUPPORTED_ON_PLATFORM': 'bad-request',
  'NOT_GRANTED':              'forbidden',
  'NEED_APPROVAL':            'forbidden',
  'PATH_NOT_ALLOWED':         'forbidden',
  'NODE_NOT_ALLOWED':         'forbidden',

  // ── Mesh ──
  'NODE_UNREACHABLE':         'mesh-unreachable',
  'FORWARD_ERROR':            'mesh-unreachable',

  // ── Execution ──
  'EXECUTION_ERROR':          'bad-request',
  'INVALID_REQUEST':          'bad-request',
  'INTERNAL_ERROR':           'unknown',

  // ── Plugin ──
  'PLUGIN_NOT_FOUND':         'not-found',
  'PLUGIN_DISABLED':          'not-found',

  // ── Plan / Approval ──
  'PLAN_REQUIRED':            'forbidden',
  'PLAN_FAILED':              'bad-request',
  'APPROVAL_REQUIRED':        'forbidden',
  'APPROVAL_DENIED':          'forbidden',

  // ── Peer handshake ──
  'PEER_HANDSHAKE_FAILED':    'bad-request',
  'PEER_UNKNOWN':             'not-found',
  'PEER_EXPIRED':             'bad-request',
  'PEER_REVOKED':             'forbidden',
  'PEER_KEY_MISMATCH':        'forbidden',
  'INVITE_INVALID':           'bad-request',
  'INVITE_EXPIRED':           'bad-request',
};

/** Classify a Core error code string to a category.
 *  Returns 'unknown' for unrecognised codes — the table above
 *  is the single source of truth for every code the Core emits. */
export function classifyCode(code: string | undefined): CoreErrorCategory {
  if (!code) return 'unknown';
  return CODE_TO_CATEGORY[code] || 'unknown';
}

/** Best-effort classification of a raw thrown value.
 *  Checks for a CoreError first, then error code string,
 *  and finally falls back to message substring matching
 *  for uncooperative errors (HTTP-level, network, etc.). */
export function classifyCoreError(err: unknown): CoreError {
  if (err instanceof CoreError) return err;

  // Try to extract a code from a structured throwable.
  if (err && typeof err === 'object') {
    const code = (err as Record<string, unknown>).code;
    if (typeof code === 'string') {
      return new CoreError(String((err as Record<string, unknown>).message || ''), classifyCode(code));
    }
  }

  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();

  // Fallback: guess from message text.
  if (msg.includes('websocket') || msg.includes('econnect') || msg.includes('sse') ||
      msg.includes('authentication required') || msg.includes('session expired') ||
      msg.includes('not connected')) {
    return new CoreError(String(err), 'connection');
  }
  if (msg.includes('timeout')) {
    return new CoreError(String(err), 'timeout');
  }
  if (msg.includes('forbidden') || msg.includes('permission') || msg.includes('401') || msg.includes('403')) {
    return new CoreError(String(err), 'forbidden');
  }
  if (msg.includes('no such file') || msg.includes('not found') || msg.includes('404')) {
    return new CoreError(String(err), 'not-found');
  }
  if (msg.includes('bad request') || msg.includes('invalid') || msg.includes('400') || msg.includes('spawn failed') || msg.includes('fork/exec')) {
    return new CoreError(String(err), 'bad-request');
  }

  return new CoreError(String(err), 'unknown');
}

/** Human-readable label for each category. */
export function categoryLabel(cat: CoreErrorCategory): string {
  switch (cat) {
    case 'connection':        return 'Core 未连接';
    case 'mesh-unreachable':  return '远端节点离线';
    case 'timeout':           return '请求超时';
    case 'forbidden':         return '权限不足';
    case 'bad-request':       return '请求参数错误';
    case 'not-found':         return '资源不存在';
    case 'unknown':           return '未知错误';
  }
}
