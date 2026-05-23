// ─── Relay Protocol v1 ──────────────────────────────────
// Message envelope helpers — local copy, formerly in extensions/protocol.ts.

export interface Envelope {
  v: 1;
  id?: string;
  ts: number;
  type: string;
  body: Record<string, unknown>;
  [key: string]: unknown;
}

/** Create an enveloped message. */
export function envelope(type: string, body: Record<string, unknown> = {}): Envelope {
  return { v: 1, ts: Date.now(), type, body };
}

/**
 * Parse an incoming raw WS message.
 * Accepts both v1 envelope format and legacy flat format.
 * Returns null on parse error.
 */
export function parseMsg(raw: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      if (parsed.v === 1 && parsed.body && typeof parsed.body === "object") {
        // v1 envelope: merge body up for backward-compat access
        return { type: parsed.type, ...parsed.body, _raw: parsed };
      }
      // Legacy flat message
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
