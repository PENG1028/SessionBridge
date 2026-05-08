// ─── SessionBridge REST API Routes ─────────────────────────────
// Pluggable HTTP route handlers for the relay server.
// Called before the existing inline handlers; returns true when a
// route is handled so the caller can skip its own dispatch.
//
// Uses only Node.js built-in modules — no Express, no framework.

import type { IncomingMessage, ServerResponse } from "http";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { basename, isAbsolute, resolve, join } from "path";
import os from "os";

import type { InstanceManager, InstanceData } from "./instance-manager";
import type { ConfigManager } from "./config";
import type { RelayConfigManager } from "../adapters/agent-core/config-sync";
import { envelope } from "../adapters/protocol";
import { adapterRegistry, getDefaultAdapterId } from "../adapters/registry";
import type { PermissionCategory } from "../adapters/types";

// ─── Types ─────────────────────────────────────────────────────

/** Optional audit logger interface — matches the concrete AuditLogger in audit-log.ts. */
export interface AuditLogger {
  log(action: string, actor: string, detail?: Record<string, unknown>, instanceId?: string): void;
}

/** Context injected by the relay server when registering routes. */
export interface ApiContext {
  /** The single global InstanceManager instance. */
  instanceManager: InstanceManager;
  /** Optional audit logger for tracking state-changing operations. */
  auditLog?: AuditLogger;
  /** Relay's broadcast function — sends an envelope to every connected WebSocket client. */
  broadcast: (msg: Record<string, unknown>) => void;
  /**
   * Optional permission check. Return true if allowed, false (and
   * send a 403 response) if denied. When absent, all operations
   * are permitted (backward compat).
   */
  checkPermission?: (res: ServerResponse, category: PermissionCategory, context?: Record<string, unknown>) => boolean;
  /** Config manager for reading/writing server config */
  configManager?: ConfigManager;
  /** Relay config manager for pushing live config changes to agents */
  relayConfig?: RelayConfigManager;
}

// ─── Helpers ───────────────────────────────────────────────────

/** Server start time captured when this module is first loaded. */
const MODULE_START_TIME = Date.now();

/** Write a JSON response with the given status code. */
function json(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Read the full request body as a UTF-8 string. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

/** Split a URL pathname into non-empty segments. */
function segments(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

/**
 * Match a concrete pathname against a pattern that may contain `:param`
 * placeholders.  Returns the extracted parameters, or `null` when the
 * number of segments differs or a literal segment does not match.
 *
 * @example matchPath("/api/instances/abc123", "/api/instances/:id")  => { id: "abc123" }
 */
function matchPath(pathname: string, pattern: string): Record<string, string> | null {
  const actual = segments(pathname);
  const expected = segments(pattern);
  if (actual.length !== expected.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < expected.length; i++) {
    if (expected[i].startsWith(":")) {
      params[expected[i].slice(1)] = actual[i];
    } else if (expected[i] !== actual[i]) {
      return null;
    }
  }
  return params;
}

/** Serialise a single InstanceData to the same JSON shape as InstanceManager.toJSON(). */
function instanceToJSON(inst: InstanceData): Record<string, unknown> {
  return {
    id: inst.id,
    dir: inst.dir,
    label: inst.label,
    status: inst.status,
    source: inst.source,
    adapterId: inst.adapterId || getDefaultAdapterId(),
    model: inst.model,
    blockCount: inst.blockBuffer.length,
    outputSize: inst.outputSize,
    checkpointCount: inst.checkpointManager.totalCheckpoints(),
    agentVersion: inst.agentVersion ?? null,
    createdAt: inst.createdAt,
  };
}

// ─── Route Registration ────────────────────────────────────────

/**
 * Register REST API route handlers against the incoming HTTP request.
 *
 * Call this **before** the relay server's existing inline dispatch.
 * When the function returns `true` the request was fully handled and
 * the caller should **not** process it further.  When it returns
 * `false` no route matched — fall through to legacy handlers.
 */
export function registerApiRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
): boolean {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = (req.method ?? "GET").toUpperCase();
  const { instanceManager, broadcast } = ctx;

  // ──────────────── GET /api/instances ─────────────────────────
  // List every registered instance (same shape as toJSON()).
  if (method === "GET" && pathname === "/api/instances") {
    json(res, 200, {
      instances: instanceManager.toJSON(),
      activeId: instanceManager.activeId,
    });
    return true;
  }

  // ──────────────── GET /api/instances/:id ─────────────────────
  // Get a single instance by its identifier.
  {
    const p = matchPath(pathname, "/api/instances/:id");
    if (method === "GET" && p) {
      const inst = instanceManager.get(p.id);
      if (!inst) {
        json(res, 404, { error: `Instance not found: ${p.id}` });
        return true;
      }
      json(res, 200, { instance: instanceToJSON(inst) });
      return true;
    }
  }

  // ──────────────── GET /api/instances/:id/status ──────────────
  // Lightweight status-only endpoint.
  {
    const p = matchPath(pathname, "/api/instances/:id/status");
    if (method === "GET" && p) {
      const inst = instanceManager.get(p.id);
      if (!inst) {
        json(res, 404, { error: `Instance not found: ${p.id}` });
        return true;
      }
      json(res, 200, {
        instanceId: inst.id,
        status: inst.status,
        source: inst.source,
        adapterId: inst.adapterId || getDefaultAdapterId(),
        model: inst.model,
        isProcessing: inst.isProcessing,
        queueDepth: inst.pendingQueue.length,
      });
      return true;
    }
  }

  // ──────────────── POST /api/instances/:id/command ────────────
  // Send a control command to an instance.
  {
    const p = matchPath(pathname, "/api/instances/:id/command");
    if (method === "POST" && p) {
      if (ctx.checkPermission && !ctx.checkPermission(res, 'processManagement', { action: 'command', instanceId: p.id })) return true;
      const instanceId = p.id;

      readBody(req)
        .then((body) => {
          let parsed: { command?: unknown; args?: Record<string, unknown> };
          try {
            parsed = JSON.parse(body);
          } catch {
            json(res, 400, { error: "Invalid JSON body" });
            return;
          }

          const { command, args } = parsed;
          if (!command || typeof command !== "string") {
            json(res, 400, { error: "Missing or invalid 'command' field" });
            return;
          }

          const inst = instanceManager.get(instanceId);
          if (!inst) {
            json(res, 404, { error: `Instance not found: ${instanceId}` });
            return;
          }

          // ── Route the command based on instance source / transport ──

          if (inst.source === "remote") {
            // Remote agent: forward through its dedicated WebSocket.
            if (!inst.agentConnection || inst.agentConnection.readyState !== 1) {
              json(res, 503, { error: "Remote agent not connected" });
              return;
            }
            const payload = envelope("agent.stdin", {
              instanceId: inst.id,
              data:
                JSON.stringify({
                  type: "control_request",
                  request_id: `r${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                  request: { subtype: command, ...(args ?? {}) },
                }) + "\n",
            });
            inst.agentConnection.send(JSON.stringify(payload));
            broadcast(
              envelope("instance.control_sent", {
                subtype: command,
                instanceId: inst.id,
                ...(args ?? {}),
              }),
            );
          } else if (inst.handle) {
            // Local instance managed by an adapter handle.
            inst.handle.sendCommand(command, args ?? {}).catch(() => {});
            broadcast(
              envelope("instance.control_sent", {
                subtype: command,
                instanceId: inst.id,
                ...(args ?? {}),
              }),
            );
          } else if (inst.process?.stdin?.writable) {
            // Local instance with a raw child-process — write JSON control message to stdin.
            inst.process.stdin.write(
              JSON.stringify({
                type: "control_request",
                request_id: `r${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                request: { subtype: command, ...(args ?? {}) },
              }) + "\n",
            );
            broadcast(
              envelope("instance.control_sent", {
                subtype: command,
                instanceId: inst.id,
                ...(args ?? {}),
              }),
            );
          } else {
            json(res, 503, { error: "Instance has no writable transport (not started or remote agent offline)" });
            return;
          }

          json(res, 200, { success: true, instanceId: inst.id, command });

          // Audit log
          ctx.auditLog?.log("instance.command", "api", { command, args: args ?? {} }, inst.id);
        })
        .catch(() => {
          json(res, 500, { error: "Failed to read request body" });
        });

      return true;
    }
  }

  // ──────────────── POST /api/instances ────────────────────────
  // Create a new instance in the manager.  Does NOT spawn a process —
  // the relay server's spawn logic (or a subsequent API call) handles
  // that separately.
  if (method === "POST" && pathname === "/api/instances") {
    if (ctx.checkPermission && !ctx.checkPermission(res, 'processManagement', { action: 'create_instance' })) return true;
    readBody(req)
      .then((body) => {
        let parsed: { dir?: string; label?: string; adapterId?: string };
        try {
          parsed = JSON.parse(body);
        } catch {
          json(res, 400, { error: "Invalid JSON body" });
          return;
        }

        const { dir, label, adapterId } = parsed;
        const targetDir = dir
          ? isAbsolute(dir)
            ? resolve(dir)
            : resolve(process.cwd(), dir)
          : process.cwd();

        if (!existsSync(targetDir)) {
          json(res, 400, { error: `Directory not found: ${targetDir}` });
          return;
        }

        const newInst = instanceManager.create(
          targetDir,
          label || basename(targetDir),
          "local",
          adapterId || getDefaultAdapterId(),
        );

        // Audit
        ctx.auditLog?.log("instance.created", "api", { dir: newInst.dir, label: newInst.label, adapterId: newInst.adapterId }, newInst.id);

        // Notify all connected clients
        broadcast(
          envelope("instance.added", {
            instance: {
              id: newInst.id,
              dir: newInst.dir,
              label: newInst.label,
              status: newInst.status,
            },
          }),
        );

        json(res, 201, {
          success: true,
          instance: {
            id: newInst.id,
            dir: newInst.dir,
            label: newInst.label,
            status: newInst.status,
            adapterId: newInst.adapterId,
          },
        });
      })
      .catch(() => {
        json(res, 500, { error: "Failed to read request body" });
      });

    return true;
  }

  // ──────────────── DELETE /api/instances/:id ──────────────────
  // Stop and remove an instance.
  {
    const p = matchPath(pathname, "/api/instances/:id");
    if (method === "DELETE" && p) {
      if (ctx.checkPermission && !ctx.checkPermission(res, 'processManagement', { action: 'delete_instance', instanceId: p.id })) return true;
      const instanceId = p.id;
      const inst = instanceManager.get(instanceId);
      if (!inst) {
        json(res, 404, { error: `Instance not found: ${instanceId}` });
        return true;
      }

      // Stop the adapter handle first (clean exit).
      if (inst.handle) {
        inst.handle.stop().catch(() => {});
        inst.handle = undefined;
      }

      // Kill the raw child process if it still exists.
      if (inst.process) {
        inst.process.kill();
        inst.process = null;
      }

      inst.status = "stopped";
      inst.pendingQueue = [];
      inst.queueLock = null;
      inst.isProcessing = false;

      const wasActive = instanceManager.activeId === inst.id;
      instanceManager.kill(instanceId);

      // If the deleted instance was the active one (or no active remains),
      // pick the first remaining instance, or null if none.
      if (wasActive || !instanceManager.getActive()) {
        const remaining = instanceManager.list();
        instanceManager.setActive(remaining.length > 0 ? remaining[0].id : null);
      }

      // Audit
      ctx.auditLog?.log("instance.deleted", "api", {}, instanceId);

      broadcast(envelope("instance.removed", { instanceId }));

      json(res, 200, { success: true });
      return true;
    }
  }

  // ──────────────── GET /api/sessions ──────────────────────────
  // List recent session metadata from the Claude history file.
  if (method === "GET" && pathname === "/api/sessions") {
    try {
      const sessions: Array<Record<string, unknown>> = [];
      const historyPath = adapterRegistry.list().map(a => a.getSessionPaths?.()).find(Boolean)?.historyPath;
      const historyFile = historyPath || '';

      if (historyFile && existsSync(historyFile)) {
        const content = readFileSync(historyFile, "utf8");
        const lines = content
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            try {
              return JSON.parse(l);
            } catch {
              return null;
            }
          })
          .filter(Boolean);

        const seen = new Set<string>();
        for (const entry of lines) {
          const sid = entry.sessionId;
          if (!sid || seen.has(sid)) continue;
          seen.add(sid);
          sessions.push({
            sessionId: sid,
            display: (entry.display || "").slice(0, 200),
            project: entry.project || "",
            timestamp: entry.timestamp || 0,
          });
          if (sessions.length >= 100) break;
        }

        // Newest first
        sessions.sort(
          (a, b) => (b.timestamp as number) - (a.timestamp as number),
        );
      }

      json(res, 200, { sessions });
    } catch (err) {
      json(res, 500, { error: String(err) });
    }
    return true;
  }

  // ──────────────── GET /api/health ────────────────────────────
  // Enhanced health check — includes uptime, instance counts, relay
  // token status, memory pressure, and OS-level metrics.
  if (method === "GET" && pathname === "/api/health") {
    const mem = process.memoryUsage();
    const instanceList = instanceManager.toJSON();
    const localCount = instanceList.filter((i) => i.source === "local").length;
    const remoteCount = instanceList.filter((i) => i.source === "remote").length;
    const runningCount = instanceList.filter(
      (i) => i.status === "running",
    ).length;

    json(res, 200, {
      status: "ok",
      uptime: Date.now() - MODULE_START_TIME,
      uptimeMs: Date.now() - MODULE_START_TIME,
      instanceCount: instanceManager.count,
      localInstances: localCount,
      remoteInstances: remoteCount,
      runningInstances: runningCount,
      activeInstanceId: instanceManager.activeId,
      relayTokenSet: !!process.env.BRIDGE_TOKEN,
      relayTokenStatus: process.env.BRIDGE_TOKEN
        ? "configured"
        : "unset",
      memory: {
        rss: mem.rss,
        heapTotal: mem.heapTotal,
        heapUsed: mem.heapUsed,
        rssMB: Math.round(mem.rss / 1024 / 1024),
        heapMB: Math.round(mem.heapUsed / 1024 / 1024),
      },
      system: {
        platform: process.platform,
        hostname: os.hostname(),
        freemem: os.freemem(),
        totalmem: os.totalmem(),
        loadavg: os.loadavg(),
        nodeVersion: process.version,
        uptime: process.uptime(),
        arch: process.arch,
      },
      instances: instanceList,
    });
    return true;
  }

  // ──────────────── Config API ────────────────────────────
  // GET /api/config — return full config
  if (method === "GET" && pathname === "/api/config") {
    if (!ctx.configManager) { json(res, 501, { error: "Config manager not available" }); return true; }
    json(res, 200, ctx.configManager.getAll() as unknown as Record<string, unknown>);
    return true;
  }

  // POST /api/config — merge partial config update
  if (method === "POST" && pathname === "/api/config") {
    if (!ctx.configManager) { json(res, 501, { error: "Config manager not available" }); return true; }
    readBody(req).then((raw) => {
      try {
        const body = JSON.parse(raw);
        ctx.configManager!.set(body);
        ctx.auditLog?.log('config.update', 'api', { keys: Object.keys(body) });
        // If ntfyTopic changed, push live to connected agents via config sync
        const ntfyTopic = body.notifications?.ntfyTopic;
        if (ntfyTopic !== undefined && ctx.relayConfig) {
          ctx.relayConfig.set('ntfyTopic', ntfyTopic, 'relay');
        }
        json(res, 200, { success: true, config: ctx.configManager!.getAll() as unknown as Record<string, unknown> });
      } catch (err) {
        json(res, 400, { error: `Invalid config: ${(err as Error).message}` });
      }
    }).catch(() => json(res, 400, { error: "Failed to read request body" }));
    return true;
  }

  // POST /api/config/connections — upsert a remote relay
  if (method === "POST" && pathname === "/api/config/connections") {
    if (!ctx.configManager) { json(res, 501, { error: "Config manager not available" }); return true; }
    readBody(req).then((raw) => {
      try {
        const body = JSON.parse(raw);
        const connections = ctx.configManager!.upsertConnection(body);
        ctx.auditLog?.log('config.connection.upsert', 'api', { id: body.id, url: body.url });
        json(res, 200, { success: true, connections });
      } catch (err) {
        json(res, 400, { error: (err as Error).message });
      }
    }).catch(() => json(res, 400, { error: "Failed to read request body" }));
    return true;
  }

  // DELETE /api/config/connections/:id — remove a remote relay
  {
    const p = matchPath(pathname, "/api/config/connections/:id");
    if (method === "DELETE" && p) {
      if (!ctx.configManager) { json(res, 501, { error: "Config manager not available" }); return true; }
      ctx.configManager.removeConnection(p.id);
      ctx.auditLog?.log('config.connection.remove', 'api', { id: p.id });
      json(res, 200, { success: true });
      return true;
    }
  }

  // No route matched — let the existing handler process the request.
  return false;
}
