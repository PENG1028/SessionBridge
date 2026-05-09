// ─── Lightweight action event bus ────────────────────────────
// Allows DockPanelFrame header action buttons (resolved from
// panel registry at render time, stable regardless of collapse)
// to communicate with their child panel components.
//
// Usage:
//   getActions: () => <button onClick={() => emitPanelAction('my-action')} />
//   In panel: useEffect(() => onPanelAction('my-action', handler), [])

const listeners = new Map<string, Set<() => void>>();

export function emitPanelAction(id: string): void {
  listeners.get(id)?.forEach(fn => fn());
}

export function onPanelAction(id: string, fn: () => void): () => void {
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id)!.add(fn);
  return () => { listeners.get(id)?.delete(fn); };
}
