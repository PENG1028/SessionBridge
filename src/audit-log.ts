// ─── Audit Logger (structured JSONL audit trail) ────────────────

import {
  appendFileSync,
  mkdirSync,
  statSync,
  readdirSync,
  unlinkSync,
  existsSync,
  readFileSync,
} from "fs";
import { join } from "path";

const AUDIT_DIR = ".sessionbridge/audit";
const MAX_FILE_BYTES = 1_073_741_824;

export interface AuditEntry {
  timestamp: string;
  action: string;
  actor: string;
  instanceId?: string;
  detail: Record<string, unknown>;
}

export class AuditLogger {
  private auditDir: string;
  private currentDateStr: string;
  private currentFilePath: string;

  constructor(workDir: string) {
    this.auditDir = join(workDir, AUDIT_DIR);
    this.currentDateStr = this.dateStr(new Date());
    this.currentFilePath = join(this.auditDir, `audit-${this.currentDateStr}.jsonl`);
  }

  get currentFile(): string {
    return this.currentFilePath;
  }

  log(action: string, actor: string, detail?: Record<string, unknown>, instanceId?: string): void {
    this.ensureDir();
    this.rotateIfNeeded();

    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      action,
      actor,
      detail: detail ?? {},
    };
    if (instanceId !== undefined) {
      entry.instanceId = instanceId;
    }

    appendFileSync(this.currentFilePath, JSON.stringify(entry) + "\n", "utf8");
    this.warnIfOversized();
  }

  query(options?: {
    start?: string;
    end?: string;
    action?: string;
    instanceId?: string;
    limit?: number;
  }): AuditEntry[] {
    const limit = options?.limit ?? 100;
    const startDate = options?.start ? new Date(options.start) : null;
    const endDate = options?.end ? new Date(options.end) : null;

    const entries: AuditEntry[] = [];
    const files = this.listAuditFiles(startDate, endDate);

    for (const file of files) {
      const filePath = join(this.auditDir, file);
      let content: string;
      try {
        content = readFileSync(filePath, "utf8");
      } catch {
        continue;
      }

      const lines = content.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        if (entries.length >= limit * 3) break;

        try {
          const entry: AuditEntry = JSON.parse(line);
          if (options?.action && entry.action !== options.action) continue;
          if (options?.instanceId && entry.instanceId !== options.instanceId) continue;
          if (startDate) {
            if (new Date(entry.timestamp) < startDate) continue;
          }
          if (endDate) {
            const endOfDay = new Date(endDate);
            endOfDay.setHours(23, 59, 59, 999);
            if (new Date(entry.timestamp) > endOfDay) continue;
          }
          entries.push(entry);
        } catch {
          // skip malformed lines
        }
      }

      if (entries.length >= limit * 3) break;
    }

    entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return entries.slice(0, limit);
  }

  purgeBefore(date: string): number {
    const cutoff = new Date(date);
    let deleted = 0;

    if (!existsSync(this.auditDir)) return 0;

    const prefix = "audit-";
    const suffix = ".jsonl";

    for (const file of readdirSync(this.auditDir)) {
      if (!file.startsWith(prefix) || !file.endsWith(suffix)) continue;
      const datePart = file.slice(prefix.length, -suffix.length);
      const fileDate = new Date(datePart);
      if (isNaN(fileDate.getTime())) continue;
      if (fileDate < cutoff) {
        unlinkSync(join(this.auditDir, file));
        deleted++;
      }
    }

    return deleted;
  }

  // ─── Private helpers ──────────────────────────────────────────

  private ensureDir(): void {
    if (!existsSync(this.auditDir)) {
      mkdirSync(this.auditDir, { recursive: true });
    }
  }

  private dateStr(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  private rotateIfNeeded(): void {
    const today = this.dateStr(new Date());
    if (today !== this.currentDateStr) {
      this.currentDateStr = today;
      this.currentFilePath = join(this.auditDir, `audit-${this.currentDateStr}.jsonl`);
    }
  }

  private warnIfOversized(): void {
    try {
      const stat = statSync(this.currentFilePath);
      if (stat.size > MAX_FILE_BYTES) {
        console.warn(
          `[AuditLogger] File ${this.currentFilePath} exceeds 1 GB (` +
            `${(stat.size / 1_073_741_824).toFixed(2)} GB). Consider archiving.`
        );
      }
    } catch {
      // file may not exist yet — ignore
    }
  }

  private listAuditFiles(startDate: Date | null, endDate: Date | null): string[] {
    if (!existsSync(this.auditDir)) return [];

    const prefix = "audit-";
    const suffix = ".jsonl";

    return readdirSync(this.auditDir)
      .filter((f) => f.startsWith(prefix) && f.endsWith(suffix))
      .filter((f) => {
        const datePart = f.slice(prefix.length, -suffix.length);
        const fileDate = new Date(datePart);
        if (isNaN(fileDate.getTime())) return false;
        if (startDate) {
          const fd = new Date(datePart);
          const sd = new Date(startDate.toISOString().slice(0, 10));
          if (fd < sd) return false;
        }
        if (endDate) {
          const fd = new Date(datePart);
          const ed = new Date(endDate.toISOString().slice(0, 10));
          if (fd > ed) return false;
        }
        return true;
      })
      .sort();
  }
}
