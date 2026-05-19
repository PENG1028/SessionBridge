// ─── Subscription Manager ────────────────────────────────
// Pattern-based subscription matching.
//
// Patterns:
//   node:*/terminals        → matches state://node:inst_26/terminals
//   node:inst_26/**         → matches everything under node:inst_26
//   *                       → matches exactly one segment
//   **                      → matches zero or more segments
//   plugin:editor/*         → matches everything the editor plugin owns
//
// Match is path-segment–based: the key is split on '/' and
// each segment is matched against the pattern.

export interface Subscriber {
  id: string;       // unique handle for unsubscribe
  pattern: string;  // glob pattern
  callback: (change: any) => void;
  withCurrent: boolean;
}

export class SubscriptionManager {
  private subs = new Map<string, Subscriber[]>();
  private nextId = 0;

  /** Add a subscriber.  Returns an unsubscribe function. */
  subscribe(
    pattern: string,
    callback: (change: any) => void,
    withCurrent = false,
  ): () => void {
    const id = `sub_${++this.nextId}`;
    const sub: Subscriber = { id, pattern, callback, withCurrent };
    const list = this.subs.get(pattern) || [];
    list.push(sub);
    this.subs.set(pattern, list);
    return () => this.unsubscribe(id);
  }

  /** Remove a subscriber by id. */
  unsubscribe(id: string): void {
    for (const [pattern, list] of this.subs) {
      const idx = list.findIndex(s => s.id === id);
      if (idx >= 0) {
        list.splice(idx, 1);
        if (list.length === 0) this.subs.delete(pattern);
        return;
      }
    }
  }

  /** Check if a pattern matches a key directly (no subscriptions needed). */
  test(pattern: string, key: string): boolean {
    const keySegs = this.segment(key);
    return this.matchGlob(pattern, keySegs);
  }

  /** Find all callbacks that match a given key. */
  match(key: string): Subscriber[] {
    const keySegs = this.segment(key);
    const results: Subscriber[] = [];

    for (const [, list] of this.subs) {
      for (const sub of list) {
        if (this.matchGlob(sub.pattern, keySegs)) {
          results.push(sub);
        }
      }
    }
    return results;
  }

  /** Get all patterns currently subscribed. */
  patterns(): string[] {
    return [...this.subs.keys()];
  }

  /** Return all subscribers that have withCurrent=true for a given key. */
  matchingWithCurrent(key: string): Subscriber[] {
    return this.match(key).filter(s => s.withCurrent);
  }

  // ── internals ──

  private segment(path: string): string[] {
    return path.replace(/^state:\/\//, '').split('/').filter(Boolean);
  }

  private matchGlob(pattern: string, keySegs: string[]): boolean {
    const patSegs = pattern.split('/').filter(Boolean);
    return this.matchSegments(patSegs, 0, keySegs, 0);
  }

  private matchSegments(
    pat: string[], pi: number,
    key: string[], ki: number,
  ): boolean {
    // Both exhausted → match
    if (pi >= pat.length && ki >= key.length) return true;
    // Pattern exhausted but key has remaining segments
    if (pi >= pat.length) return false;
    // Key exhausted — only ** can match remaining pattern
    if (ki >= key.length) {
      return pat.slice(pi).every(s => s === '**');
    }

    const p = pat[pi];

    // ** matches zero or more segments
    if (p === '**') {
      // Try matching ** against 0, 1, 2, ... remaining segments
      for (let skip = 0; ki + skip <= key.length; skip++) {
        if (this.matchSegments(pat, pi + 1, key, ki + skip)) return true;
      }
      return false;
    }

    // * matches exactly one segment
    if (p === '*') {
      return this.matchSegments(pat, pi + 1, key, ki + 1);
    }

    // Literal match
    if (p === key[ki]) {
      return this.matchSegments(pat, pi + 1, key, ki + 1);
    }

    return false;
  }
}
