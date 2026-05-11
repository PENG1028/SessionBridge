// ─── Permission Model ──────────────────────────────────────────
// Gate for AgentCapabilityHost. All capability checks pass through
// here. Default policy: allow all (backward compat with current
// agent which has no restrictions).

import type { PermissionCategory, PermissionState } from '../extensions/types';

export interface PermissionConfig {
  grants: Partial<Record<PermissionCategory, boolean>>;
}

const ALL_GRANTED: Record<PermissionCategory, boolean> = {
  fileRead: true,
  fileWrite: true,
  network: true,
  processManagement: true,
  shellAccess: true,
  configurationWrite: true,
};

export class PermissionModel implements PermissionState {
  grants: Record<PermissionCategory, boolean>;

  constructor(config?: PermissionConfig) {
    this.grants = { ...ALL_GRANTED, ...(config?.grants ?? {}) };
  }

  check(category: PermissionCategory, _context?: Record<string, unknown>): { allowed: boolean; reason?: string } {
    const allowed = this.grants[category] ?? true;
    return allowed ? { allowed: true } : { allowed: false, reason: `Permission denied: ${category}` };
  }

  /** Update a grant at runtime. Returns false if category unknown. */
  set(category: PermissionCategory, value: boolean): void {
    this.grants[category] = value;
  }

  toJSON(): PermissionConfig {
    return { grants: { ...this.grants } };
  }
}
