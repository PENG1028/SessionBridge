import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// ─── Types ────────────────────────────────────────

export interface RemoteRelay {
  id: string;
  name: string;
  url: string;
  token?: string;
}

export interface AppConfig {
  /** Local server port */
  port: number;
  /** Relay authentication token */
  token: string;
  /** SSL key path (optional) */
  sslKey: string;
  /** SSL cert path (optional) */
  sslCert: string;
  /** Saved remote relay connections */
  connections: RemoteRelay[];
  /** Notification settings */
  notifications: {
    ntfyTopic: string;
    enabled: boolean;
  };
  /** Theme preference */
  theme: "dark" | "light";
  /** Default working directory for new instances */
  defaultDir: string;
}

// ─── Defaults ─────────────────────────────────────

const DEFAULT_CONFIG: AppConfig = {
  port: 8080,
  token: "",
  sslKey: "",
  sslCert: "",
  connections: [],
  notifications: {
    ntfyTopic: "",
    enabled: true,
  },
  theme: "dark",
  defaultDir: process.cwd(),
};

// ─── Config Manager ───────────────────────────────

export class ConfigManager {
  private configPath: string;
  private config: AppConfig;
  private _dirty = false;

  constructor(configDir?: string) {
    const dir = configDir || join(homedir(), ".sessionbridge");
    this.configPath = join(dir, "config.json");
    this.config = { ...DEFAULT_CONFIG };
    this.load();
    // Auto-save on process exit
    process.on("beforeExit", () => this.flush());
  }

  /** Full config snapshot */
  getAll(): AppConfig {
    return { ...this.config };
  }

  /** Get a specific key */
  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.config[key];
  }

  /** Merge partial update and save */
  set(partial: Partial<AppConfig>): AppConfig {
    // Only allow safe keys
    const allowedKeys: (keyof AppConfig)[] = [
      "port", "token", "sslKey", "sslCert", "connections",
      "notifications", "theme", "defaultDir",
    ];
    for (const key of allowedKeys) {
      if (key in partial) {
        (this.config as any)[key] = (partial as any)[key];
        this._dirty = true;
      }
    }
    this.save();
    return this.getAll();
  }

  /** Add or update a remote relay */
  upsertConnection(relay: RemoteRelay): RemoteRelay[] {
    const idx = this.config.connections.findIndex((c) => c.id === relay.id);
    if (idx >= 0) {
      this.config.connections[idx] = relay;
    } else {
      this.config.connections.push(relay);
    }
    this._dirty = true;
    this.save();
    return this.config.connections;
  }

  /** Remove a remote relay */
  removeConnection(id: string): RemoteRelay[] {
    this.config.connections = this.config.connections.filter((c) => c.id !== id);
    this._dirty = true;
    this.save();
    return this.config.connections;
  }

  /** Force flush to disk */
  flush(): void {
    if (this._dirty) {
      this.save();
    }
  }

  private load(): void {
    try {
      if (!existsSync(this.configPath)) return;
      const raw = readFileSync(this.configPath, "utf-8");
      const parsed = JSON.parse(raw);
      // Merge with defaults (new fields get defaults)
      this.config = { ...DEFAULT_CONFIG, ...parsed };
      // Ensure nested objects exist
      if (!this.config.notifications) {
        this.config.notifications = { ...DEFAULT_CONFIG.notifications };
      }
      if (!this.config.connections) {
        this.config.connections = [];
      }
    } catch {
      // Corrupted config → start fresh
      this.config = { ...DEFAULT_CONFIG };
    }
  }

  private save(): void {
    try {
      const dir = join(this.configPath, "..");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), "utf-8");
      this._dirty = false;
    } catch (err) {
      console.error(`[config] Failed to save: ${err}`);
    }
  }
}

// ─── Singleton ───────────────────────────────────
export const appConfig = new ConfigManager();
