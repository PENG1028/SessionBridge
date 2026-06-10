// ─── Input Diagnostic Ring Buffer ──────────────────────────────────
// Module-level singleton. Logs composition events and onData calls
// for debugging mobile keyboard input issues.
// Only wired on touch devices. Exposed as window.__inputDiag for
// console inspection.

export interface InputDiagEvent {
  ts: number;
  type: 'cS' | 'cU' | 'cE' | 'inp' | 'onD';
  data: string; // truncated to 40 chars
}

const RING = 60;
const _events: InputDiagEvent[] = [];

export function pushInputDiagEvent(type: InputDiagEvent['type'], data: string) {
  _events.push({ ts: Date.now(), type, data: data.slice(0, 40) });
  if (_events.length > RING) _events.splice(0, _events.length - RING);
  // Mirror to window for console inspection
  if (typeof window !== 'undefined') (window as any).__inputDiag = _events;
}

export function getInputDiagEvents(): ReadonlyArray<InputDiagEvent> {
  return _events;
}

export function clearInputDiagEvents() {
  _events.length = 0;
}
