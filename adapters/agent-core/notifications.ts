// ─── Notification Model ─────────────────────────────────────────
// Manages notification scenarios and per-scenario enable/disable
// state. Follows the same pattern as PermissionModel.
//
// System scenarios are always present. Adapter scenarios are
// contributed by each adapter's optional getNotificationScenarios().

import type { NotificationScenario } from '../types';

// ─── System-default scenarios ───────────────────────────────

const SYSTEM_SCENARIOS: NotificationScenario[] = [
  {
    id: 'agent.connected',
    label: 'Agent 已连接',
    description: 'Agent 成功注册到 relay 时',
    source: 'system',
  },
  {
    id: 'agent.disconnected',
    label: 'Agent 已断开',
    description: 'Agent 与 relay 断开连接时',
    source: 'system',
  },
  {
    id: 'update.available',
    label: '有可用更新',
    description: '检测到 agent 版本落后于 relay 时',
    source: 'system',
  },
];

// ─── NotificationModel ──────────────────────────────────────

export class NotificationModel {
  readonly scenarios: NotificationScenario[];
  private _settings: Record<string, boolean>;

  constructor(
    adapterScenarios: NotificationScenario[] = [],
    savedSettings?: Record<string, boolean>,
  ) {
    this.scenarios = [...SYSTEM_SCENARIOS, ...adapterScenarios];
    this._settings = {};
    // Default: all enabled, then override with saved settings
    for (const s of this.scenarios) {
      this._settings[s.id] = savedSettings?.[s.id] ?? true;
    }
  }

  /** Check if a notification scenario is enabled. */
  isEnabled(scenarioId: string): boolean {
    return this._settings[scenarioId] ?? false;
  }

  /** Toggle a scenario on/off at runtime. */
  set(scenarioId: string, value: boolean): void {
    if (scenarioId in this._settings) {
      this._settings[scenarioId] = value;
    }
  }

  /** Serialize for the dashboard API. */
  toJSON(): { scenarios: NotificationScenario[]; settings: Record<string, boolean> } {
    return {
      scenarios: this.scenarios,
      settings: { ...this._settings },
    };
  }

  /** Persistable settings blob (for saving to config file). */
  get settings(): Record<string, boolean> {
    return { ...this._settings };
  }
}
