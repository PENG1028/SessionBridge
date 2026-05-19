// ─── SessionBridge REST API Routes ─────────────────────────────
// Pluggable HTTP route handlers for the relay server.
// Called before the existing inline handlers; returns true when a
// route is handled so the caller can skip its own dispatch.
//
// Uses only Node.js built-in modules — no Express, no framework.

import type { IncomingMessage, ServerResponse } from "http";
import { existsSync, writeFileSync, readFileSync, mkdirSync } from "fs";
import { basename, isAbsolute, resolve, join, dirname } from "path";
import os from "os";

import type { InstanceManager, InstanceData } from "./instance-manager";
import type { ConfigManager } from "./config";
import type { RelayConfigManager } from "../agent-core/config-sync";
import { envelope } from "../extensions/protocol";
import { adapterRegistry, getDefaultAdapterId } from "../extensions/registry";
import type { PermissionCategory } from "../extensions/types";
import { getStateBus } from "./state-bridge";

// ─── Types ─────────────────────────────────────────────────────

/** Optional audit logger interface — matches the concrete AuditLogger in audit-log.ts. */
export interface AuditLogger {
  log(action: string, actor: string, detail?: Record<string, unknown>, instanceId?: string): void;
}

/** Simple key-value alias store for device display-name overrides. */
export interface AliasStore {
  get(key: string): string | undefined;
  set(key: string, alias: string): void;
  remove(key: string): void;
  all(): Record<string, string>;
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
  /** Phase 4M: Configuration registry for schema queries */
  configRegistry?: import('./configuration/registry').ConfigurationRegistry;
  /** Phase 4M: Configuration store for layered settings */
  configStore?: import('./configuration/store').ConfigurationStore;
  /** Phase 4M: Secret store for encrypted/separate secret storage */
  secretStore?: import('./configuration/secret-store').SecretStore;
  /** Server working directory (for alias persistence) */
  workDir?: string;
  /** In-memory alias store (backed by JSON file) */
  aliases?: AliasStore;
  /** Surface manager — for atomically creating surfaces alongside instances. */
  surfaceManager?: {
    create(nodeId: string, opts: Record<string, unknown>): any;
    toJSON(surface: any): Record<string, unknown>;
    toWorkbenchTab(surface: any): any;
    setKeep(surfaceId: string, keep: boolean): void;
    broadcastToNodeSubscribers(nodeId: string, sendFn: (ws: any, msg: any) => void, msg: any): void;
  };
  /** Workbench store — for projecting API-created surfaces into workbench.tabs sync. */
  workbenchStore?: {
    get(nodeId: string): any[] | undefined;
    set(nodeId: string, tabs: any[]): void;
    delete(nodeId: string): void;
    broadcast(nodeId: string, tabs: any[], sender?: any): void;
    hasSubscribers(nodeId: string): boolean;
  };
  /** Cross-relay surface forwarding hook for surfaces created through REST APIs. */
  forwardSurfacePublish?: (nodeId: string, surface: Record<string, unknown>) => void;
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
    // Backward-compat: legacy instances stored without adapterId fall back.
    adapterId: inst.adapterId || getDefaultAdapterId(),
    model: inst.model,
    blockCount: inst.blockBuffer.length,
    outputSize: inst.outputSize,
    checkpointCount: inst.checkpointManager.totalCheckpoints(),
    agentVersion: inst.agentVersion ?? null,
    createdAt: inst.createdAt,
    instanceRole: inst.instanceRole,
    runtimeKind: inst.runtimeKind,
    pluginId: inst.pluginId,
    adapterState: inst.adapterState,
    parentNodeId: typeof inst.adapterState.parentNodeId === 'string' ? inst.adapterState.parentNodeId : undefined,
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
  const pathname = url.pathname.replace(/\/$/, '') || '/';
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
        adapterId: inst.adapterId || getDefaultAdapterId(), // backward-compat
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
        let parsed: { dir?: string; label?: string; adapterId?: string; targetNodeId?: string; keep?: boolean };
        try {
          parsed = JSON.parse(body);
        } catch {
          json(res, 400, { error: "Invalid JSON body" });
          return;
        }

        const { dir, label, adapterId, targetNodeId } = parsed;

        // Phase 4F: adapterId is required — no silent fallback to default.
        if (!adapterId) {
          json(res, 400, { error: "adapterId is required. Use an explicit adapter (e.g. 'claude-code', 'shell')." });
          return;
        }

        const targetNode = targetNodeId ? instanceManager.get(String(targetNodeId)) : undefined;
        if (targetNode?.source === 'remote') {
          if (!targetNode.agentConnection || targetNode.agentConnection.readyState !== 1) {
            json(res, 503, { success: false, error: `Target node ${targetNodeId} is disconnected` });
            return;
          }
          const remoteDir = dir && dir !== '.' ? dir : targetNode.dir;
          const newInst = instanceManager.create(
            remoteDir,
            label || 'Terminal',
            'remote',
            adapterId,
          );
          newInst.agentConnection = targetNode.agentConnection;
          newInst.status = 'stopped';
          newInst.instanceRole = 'runtime';
          newInst.runtimeKind = 'terminal';
          newInst.adapterState.parentNodeId = String(targetNodeId);

          const identityKey = `${newInst.source}:${newInst.dir}`;
          const alias = ctx.aliases?.get(identityKey);
          if (alias) newInst.label = alias;

          // Atomic surface creation (Phase 4)
          // surface.nodeId = targetNodeId (device/owner node)
          // surface.runtimeRef.instanceId = newInst.id (specific terminal process)
          let createdSurface: Record<string, unknown> | undefined;
          if (ctx.surfaceManager) {
            const keep = parsed.keep !== false;
            const surface = ctx.surfaceManager.create(String(targetNodeId), {
              title: newInst.label || 'Terminal',
              viewType: 'terminal',
              scope: 'node',
              shared: true,
              runtimeRef: { kind: 'terminal', instanceId: newInst.id },
              replayPolicy: { mode: 'tail', lines: 5000, bytes: 500_000 },
            });
            if (!keep) ctx.surfaceManager.setKeep(surface.surfaceId, false);
            createdSurface = ctx.surfaceManager.toJSON(surface);

            // Force immediate persistence so surfaces survive relay restart
            getStateBus().flush();

            // Cross-browser sync: project into workbench tabs + broadcast
            if (targetNodeId && ctx.workbenchStore) {
              const tab = ctx.surfaceManager.toWorkbenchTab(surface);
              const nodeIdStr = String(targetNodeId);
              const nodeTabs = ctx.workbenchStore.get(nodeIdStr) || [];
              const ti = nodeTabs.findIndex((t: any) => t.id === tab.id);
              if (ti >= 0) nodeTabs[ti] = tab;
              else nodeTabs.push(tab);
              ctx.workbenchStore.set(nodeIdStr, nodeTabs);
              ctx.workbenchStore.broadcast(nodeIdStr, nodeTabs);
              // Push surface.published to node subscribers for live discovery
              ctx.surfaceManager.broadcastToNodeSubscribers(
                nodeIdStr,
                (ws: any, msg: any) => { try { ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch {} },
                envelope("surface.published", {
                  surfaceId: surface.surfaceId,
                  surface: createdSurface,
                }),
              );
              ctx.forwardSurfacePublish?.(nodeIdStr, createdSurface);
            }
          }

          ctx.auditLog?.log("instance.created", "api", {
            dir: newInst.dir,
            label: newInst.label,
            adapterId: newInst.adapterId,
            targetNodeId,
          }, newInst.id);

          broadcast(
            envelope("instance.added", {
              instance: {
                id: newInst.id,
                dir: newInst.dir,
                label: newInst.label,
                status: newInst.status,
                adapterId: newInst.adapterId,
                source: newInst.source,
                parentNodeId: newInst.adapterState.parentNodeId,
                runtimeKind: newInst.runtimeKind,
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
            parentNodeId: newInst.adapterState.parentNodeId,
            runtimeKind: newInst.runtimeKind,
          },
          ...(createdSurface ? { surface: createdSurface } : {}),
        });
          return;
        }

        const targetDir = dir && dir !== '.'
          ? isAbsolute(dir)
            ? resolve(dir)
            : resolve(process.cwd(), dir)
          : os.homedir();

        if (!existsSync(targetDir)) {
          json(res, 400, { error: `Directory not found: ${targetDir}` });
          return;
        }

        const newInst = instanceManager.create(
          targetDir,
          label || os.hostname(),
          "local",
          adapterId,
        );
        if (targetNodeId) {
          newInst.instanceRole = 'runtime';
          newInst.runtimeKind = 'terminal';
          newInst.adapterState.parentNodeId = String(targetNodeId);
        } else {
          newInst.instanceRole = 'node';
        }

        // Apply alias from the alias store (if one exists for this source:dir)
        {
          const identityKey = `${newInst.source}:${newInst.dir}`;
          const alias = ctx.aliases?.get(identityKey);
          if (alias) newInst.label = alias;
        }

        // Atomic surface creation (Phase 4)
        // surface.nodeId = targetNodeId or newInst.id (device/owner node)
        // surface.runtimeRef.instanceId = newInst.id (specific terminal process)
        let createdSurface: Record<string, unknown> | undefined;
        if (ctx.surfaceManager) {
          const keep = parsed.keep !== false;
          const ownerNodeId = targetNodeId || newInst.id;
          const surface = ctx.surfaceManager.create(ownerNodeId, {
            title: newInst.label || 'Terminal',
            viewType: 'terminal',
            scope: 'node',
            shared: true,
            runtimeRef: { kind: 'terminal', instanceId: newInst.id },
            replayPolicy: { mode: 'tail', lines: 5000, bytes: 500_000 },
          });
          if (!keep) ctx.surfaceManager.setKeep(surface.surfaceId, false);
          createdSurface = ctx.surfaceManager.toJSON(surface);

          // Force immediate persistence so surfaces survive relay restart
          getStateBus().flush();

          // Cross-browser sync: project into workbench tabs + broadcast
          if (ctx.workbenchStore) {
            const tab = ctx.surfaceManager.toWorkbenchTab(surface);
            const nodeIdStr = String(ownerNodeId);
            const nodeTabs = ctx.workbenchStore.get(nodeIdStr) || [];
            const ti = nodeTabs.findIndex((t: any) => t.id === tab.id);
            if (ti >= 0) nodeTabs[ti] = tab;
            else nodeTabs.push(tab);
            ctx.workbenchStore.set(nodeIdStr, nodeTabs);
            ctx.workbenchStore.broadcast(nodeIdStr, nodeTabs);
            // Push surface.published to node subscribers for live discovery
            ctx.surfaceManager.broadcastToNodeSubscribers(
              nodeIdStr,
              (ws: any, msg: any) => { try { ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch {} },
              envelope("surface.published", {
                surfaceId: surface.surfaceId,
                surface: createdSurface,
              }),
            );
            ctx.forwardSurfacePublish?.(nodeIdStr, createdSurface);
          }
        }

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
              adapterId: newInst.adapterId,
              source: newInst.source,
              parentNodeId: newInst.adapterState.parentNodeId,
              runtimeKind: newInst.runtimeKind,
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
            parentNodeId: newInst.adapterState.parentNodeId,
            runtimeKind: newInst.runtimeKind,
          },
          ...(createdSurface ? { surface: createdSurface } : {}),
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

  // ──────────────── GET /api/aliases ──────────────────────────
  // Return all aliases (device-name overrides).
  if (method === "GET" && pathname === "/api/aliases") {
    json(res, 200, { aliases: ctx.aliases?.all() ?? {} });
    return true;
  }

  // ──────────────── POST /api/aliases ─────────────────────────
  // Set/update an alias for a device.  Updates the matching instance's
  // label in real-time and broadcasts to all clients.
  if (method === "POST" && pathname === "/api/aliases") {
    readBody(req).then((raw) => {
      try {
        const { instanceId, alias } = JSON.parse(raw) as { instanceId?: string; alias?: string };
        if (!instanceId || typeof instanceId !== 'string') { json(res, 400, { error: "Missing 'instanceId'" }); return; }
        if (alias === undefined || alias === null) { json(res, 400, { error: "Missing 'alias'" }); return; }

        const inst = instanceManager.get(instanceId);
        if (!inst) { json(res, 404, { error: `Instance not found: ${instanceId}` }); return; }

        const aliasStr = String(alias);
        const oldLabel = inst.label;

        // Persist alias keyed by source:dir (stable across restarts)
        const identityKey = `${inst.source}:${inst.dir}`;
        ctx.aliases?.set(identityKey, aliasStr);

        // Update ALL instances with the same source:dir and broadcast
        for (const other of instanceManager.list()) {
          if (`${other.source}:${other.dir}` === identityKey) {
            other.label = aliasStr;
            broadcast(envelope("instance.updated", {
              instance: {
                id: other.id,
                dir: other.dir,
                label: other.label,
                status: other.status,
                source: other.source,
                adapterId: other.adapterId,
              },
            }));
          }
        }

        ctx.auditLog?.log('instance.renamed', 'api', { instanceId, oldLabel, newLabel: aliasStr, identityKey });
        json(res, 200, { success: true, instance: { id: inst.id, label: inst.label } });
      } catch (err) {
        json(res, 400, { error: `Invalid request: ${(err as Error).message}` });
      }
    }).catch(() => json(res, 400, { error: "Failed to read request body" }));
    return true;
  }

  // ──────────────── DELETE /api/aliases/:identity ─────────────
  // Remove an alias, restoring the original label.
  {
    const p = matchPath(pathname, "/api/aliases/:identity");
    if (method === "DELETE" && p) {
      ctx.aliases?.remove(p.identity);
      json(res, 200, { success: true });
      return true;
    }
  }

  // ──────────────── GET /api/sessions ──────────────────────────
  // List recent sessions via the first available SessionProvider.
  if (method === "GET" && pathname === "/api/sessions") {
    try {
      const provider = adapterRegistry.list().map(a => a.getSessionProvider?.()).find(Boolean);
      if (!provider) {
        json(res, 200, { sessions: [] });
        return true;
      }
      const results = provider.searchSessions();
      const sessions = results.slice(0, 100).map(r => ({
        sessionId: r.sessionId,
        display: (r.display || '').slice(0, 200),
        project: r.project || '',
        timestamp: r.timestamp || 0,
      }));
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

  // ──────────────── Configuration API (Phase 4M) ─────────────────
  // These routes require configRegistry and configStore in the context.

  // GET /api/configuration/schema — all contributions + properties
  if (method === "GET" && pathname === "/api/configuration/schema") {
    if (!ctx.configRegistry) { json(res, 501, { error: "Configuration registry not available" }); return true; }
    json(res, 200, {
      contributions: ctx.configRegistry.getAllContributions(),
      properties: ctx.configRegistry.getAllProperties(),
    });
    return true;
  }

  // GET /api/configuration/values?scope=user|workspace — raw values at scope
  if (method === "GET" && pathname === "/api/configuration/values") {
    if (!ctx.configStore) { json(res, 501, { error: "Configuration store not available" }); return true; }
    const scope = (url.searchParams.get("scope") || "user") as 'user' | 'workspace';
    if (scope !== 'user' && scope !== 'workspace') {
      json(res, 400, { error: "scope must be 'user' or 'workspace'" });
      return true;
    }
    const raw = ctx.configStore.getAllRaw(scope);
    // Mask secret values using the registry schema
    if (ctx.configRegistry) {
      for (const key of Object.keys(raw)) {
        const schema = ctx.configRegistry.getSchema(key);
        if (schema?.secret) {
          raw[key] = '[REDACTED]';
        }
      }
    }
    json(res, 200, { scope, values: raw });
    return true;
  }

  // GET /api/configuration/inspect?key=... — layered inspect result
  if (method === "GET" && pathname === "/api/configuration/inspect") {
    if (!ctx.configRegistry || !ctx.configStore) { json(res, 501, { error: "Configuration system not available" }); return true; }
    const key = url.searchParams.get("key");
    if (!key) { json(res, 400, { error: "Missing 'key' query parameter" }); return true; }
    const schema = ctx.configRegistry.getSchema(key);
    if (!schema) { json(res, 404, { error: `Unknown configuration key: ${key}` }); return true; }
    const inspect = ctx.configStore.inspect(key, schema);
    // Mask secret values in the response
    if (schema.secret && inspect.effectiveValue !== undefined) {
      inspect.effectiveValue = '[REDACTED]';
    }
    json(res, 200, { ...inspect });
    return true;
  }

  // PATCH /api/configuration/values — update a configuration value
  if (method === "PATCH" && pathname === "/api/configuration/values") {
    if (!ctx.configStore || !ctx.configRegistry) { json(res, 501, { error: "Configuration system not available" }); return true; }
    if (ctx.checkPermission && !ctx.checkPermission(res, 'configurationWrite', { action: 'set' })) return true;
    readBody(req).then((raw) => {
      try {
        const body = JSON.parse(raw);
        const { scope, key, value } = body as { scope?: string; key?: string; value: unknown };
        if (!scope || !key) { json(res, 400, { error: "Missing 'scope' or 'key'" }); return; }
        if (scope !== 'user' && scope !== 'workspace') { json(res, 400, { error: "scope must be 'user' or 'workspace'" }); return; }
        const schema = ctx.configRegistry!.getSchema(key);
        if (!schema) { json(res, 400, { error: `Unknown configuration key: ${key}` }); return; }
        // Secret keys route to SecretStore instead of ConfigStore
        if (schema.secret) {
          if (!ctx.secretStore) { json(res, 501, { error: "Secret store not available" }); return; }
          ctx.secretStore.set(key, String(value));
          ctx.auditLog?.log('configuration.write', 'api', { scope, key }); // value NOT logged
          json(res, 200, { success: true, key, secret: true, configured: true });
          return;
        }
        const errors = ctx.configStore!.validateValue(schema, value);
        if (errors.length > 0) { json(res, 400, { error: `Validation failed for "${key}"`, details: errors }); return; }
        ctx.configStore!.set(scope as 'user' | 'workspace', key, value);
        ctx.auditLog?.log('configuration.write', 'api', { scope, key, value });
        const result = ctx.configStore!.inspect(key, schema);
        json(res, 200, { success: true, ...result });
      } catch (err) {
        json(res, 400, { error: `Invalid request: ${(err as Error).message}` });
      }
    }).catch(() => json(res, 400, { error: "Failed to read request body" }));
    return true;
  }

  // DELETE /api/configuration/values?scope=...&key=... — reset a value
  if (method === "DELETE" && pathname === "/api/configuration/values") {
    if (!ctx.configStore || !ctx.configRegistry) { json(res, 501, { error: "Configuration system not available" }); return true; }
    if (ctx.checkPermission && !ctx.checkPermission(res, 'configurationWrite', { action: 'remove' })) return true;
    const scope = url.searchParams.get("scope") as 'user' | 'workspace' | null;
    const key = url.searchParams.get("key");
    if (!scope || !key) { json(res, 400, { error: "Missing 'scope' or 'key' query parameter" }); return true; }
    if (scope !== 'user' && scope !== 'workspace') { json(res, 400, { error: "scope must be 'user' or 'workspace'" }); return true; }
    const schema = ctx.configRegistry.getSchema(key);
    if (!schema) { json(res, 404, { error: `Unknown configuration key: ${key}` }); return true; }
    // Secret keys route to SecretStore instead of ConfigStore
    if (schema.secret) {
      if (!ctx.secretStore) { json(res, 501, { error: "Secret store not available" }); return true; }
      ctx.secretStore.delete(key);
      ctx.auditLog?.log('configuration.remove', 'api', { scope, key });
      json(res, 200, { success: true, key, secret: true, configured: false });
      return true;
    }
    ctx.configStore.remove(scope, key);
    ctx.auditLog?.log('configuration.remove', 'api', { scope, key });
    const result = ctx.configStore.inspect(key, schema);
    json(res, 200, { success: true, ...result });
    return true;
  }

  // ──────────────── Secret Store API (Phase 4M) ─────────────────
  // Secrets are NEVER returned in responses — only existence checks.

  // GET /api/secrets?key=... — check if a secret exists
  if (method === "GET" && pathname === "/api/secrets") {
    if (!ctx.secretStore) { json(res, 501, { error: "Secret store not available" }); return true; }
    const key = url.searchParams.get("key");
    if (!key) { json(res, 400, { error: "Missing 'key' query parameter" }); return true; }
    json(res, 200, { key, exists: ctx.secretStore.has(key), configured: ctx.secretStore.has(key) });
    return true;
  }

  // PUT /api/secrets — set a secret value
  if (method === "PUT" && pathname === "/api/secrets") {
    if (!ctx.secretStore) { json(res, 501, { error: "Secret store not available" }); return true; }
    if (ctx.checkPermission && !ctx.checkPermission(res, 'configurationWrite', { action: 'secret_set' })) return true;
    readBody(req).then((raw) => {
      try {
        const body = JSON.parse(raw);
        const { key, value } = body as { key?: string; value?: string };
        if (!key || typeof key !== 'string') { json(res, 400, { error: "Missing or invalid 'key'" }); return; }
        if (value === undefined || value === null) { json(res, 400, { error: "Missing 'value'" }); return; }
        ctx.secretStore!.set(key, String(value));
        // Deliberately NOT logging the value in audit
        ctx.auditLog?.log('secrets.set', 'api', { key });
        json(res, 200, { success: true, key, configured: true });
      } catch (err) {
        json(res, 400, { error: `Invalid request: ${(err as Error).message}` });
      }
    }).catch(() => json(res, 400, { error: "Failed to read request body" }));
    return true;
  }

  // DELETE /api/secrets?key=... — remove a secret
  if (method === "DELETE" && pathname === "/api/secrets") {
    if (!ctx.secretStore) { json(res, 501, { error: "Secret store not available" }); return true; }
    if (ctx.checkPermission && !ctx.checkPermission(res, 'configurationWrite', { action: 'secret_remove' })) return true;
    const key = url.searchParams.get("key");
    if (!key) { json(res, 400, { error: "Missing 'key' query parameter" }); return true; }
    ctx.secretStore.delete(key);
    ctx.auditLog?.log('secrets.delete', 'api', { key });
    json(res, 200, { success: true, key, configured: false });
    return true;
  }

  // ──────────────── Connections API (project-level) ────────────
  // Stored in <workDir>/.sessionbridge/connections.json

  const CONNECTIONS_FILE = () => {
    const dir = join(ctx.workDir || process.cwd(), '.sessionbridge');
    return { dir, path: join(dir, 'connections.json') };
  };

  function loadConnections(): Record<string, unknown>[] {
    try {
      const { path } = CONNECTIONS_FILE();
      if (!existsSync(path)) return [];
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch { return []; }
  }

  function saveConnections(list: Record<string, unknown>[]): void {
    const { dir, path } = CONNECTIONS_FILE();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(list, null, 2), 'utf-8');
  }

  // GET /api/connections — list all saved connections
  if (method === "GET" && pathname === "/api/connections") {
    let list = loadConnections();
    // Seed default "local" connection if not present
    if (!list.some((c: any) => c.id === 'local')) {
      const localEntry = {
        id: 'local',
        name: 'local',
        url: 'ws://127.0.0.1:8080',
        networkType: 'loopback',
        isDefault: true,
        lastSeen: Date.now(),
      };
      list = [localEntry, ...list];
      saveConnections(list);
    }
    json(res, 200, { connections: list });
    return true;
  }

  // POST /api/connections — add or update a connection
  if (method === "POST" && pathname === "/api/connections") {
    readBody(req).then((raw) => {
      try {
        const body = JSON.parse(raw);
        if (!body.id || !body.url) { json(res, 400, { error: "Missing required fields: id, url" }); return; }
        const list = loadConnections();
        const idx = list.findIndex((c: any) => c.id === body.id);
        const entry = { ...body, lastSeen: Date.now() };
        if (idx >= 0) list[idx] = entry;
        else list.push(entry);
        saveConnections(list);
        json(res, 200, { success: true, connections: list });
      } catch (err) {
        json(res, 400, { error: `Invalid request: ${(err as Error).message}` });
      }
    }).catch(() => json(res, 400, { error: "Failed to read request body" }));
    return true;
  }

  // DELETE /api/connections/:id — remove a connection
  {
    const p = matchPath(pathname, "/api/connections/:id");
    if (method === "DELETE" && p) {
      const list = loadConnections().filter((c: any) => c.id !== p!.id);
      saveConnections(list);
      json(res, 200, { success: true, connections: list });
      return true;
    }
  }

  // No route matched — let the existing handler process the request.
  return false;
}
