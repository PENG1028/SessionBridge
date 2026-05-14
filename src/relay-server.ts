import { createServer as createHttpServer, IncomingMessage, ServerResponse } from "http";
import { createServer as createHttpsServer } from "https";
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, unlinkSync, mkdirSync } from "fs";
import { join, extname, basename, resolve, isAbsolute, relative, dirname } from "path";
import { WebSocketServer, WebSocket } from "ws";
import { spawn, execSync } from "child_process";
import { createInterface } from "readline";
import { memoryUsage } from "process";
import os from "os";

import { checkRateLimit } from "./rate-limiter";
import { CheckpointManager } from "./checkpoint-manager";
import { InstanceManager } from "./instance-manager";
import { envelope, parseMsg } from "../extensions/protocol";
import { adapterRegistry, getDefaultAdapterId, getTerminalAdapterId, resolveAdapter, resolveAdapterByCapability } from "../extensions/registry";
import { extensionPoints, evaluateWhen } from "../agent-core/extension-points";
import type { WhenContext, StreamParserDeps } from "../extensions/types";
import { RelayEventBus } from "../agent-core/event-bus";
import { AuditLogger } from "./audit-log";
import { appConfig } from "./config";
import { ensureCert } from "./cert";
import { SessionPersistence } from "./session-persistence";
import { registerApiRoutes, type AliasStore } from "./api-routes";
import { registerAdminRoutes, type AdminRouteContext, type ShellRunInstance } from "./admin-routes";
import { RelayConfigManager } from "../agent-core/config-sync";
import { PermissionModel } from "../agent-core/permissions";
import { RelayConnection } from "../agent-core/relay-connection";
import { CryptoStream } from "./crypto-stream";
import { tryDecrypt } from "./crypto-layer";
import { loadOrCreateIdentity } from "./identity-manager";
import { detectNetwork } from "./network-detect";
import { configRegistry } from "./configuration/registry";
import { configStore } from "./configuration/store";
import { secretStore } from "./configuration/secret-store";

// ─── Session provider helper — first adapter that provides SessionProvider ──
function sessionProvider() {
  for (const adapter of adapterRegistry.list()) {
    const provider = adapter.getSessionProvider?.();
    if (provider) return provider;
  }
  return undefined;
}

// ─── Start Time ────────────────────────────────────────────────────
const START_TIME = Date.now();

import { VERSION as SERVER_VERSION } from "../version";
import { mismatchSeverity } from "../extensions/semver";

// ─── Config ──────────────────────────────────────────────────────
const PORT = appConfig.get("port");
let relayToken = appConfig.get("token") || process.env.BRIDGE_TOKEN || "";
const sslKey = appConfig.get("sslKey") || process.env.BRIDGE_SSL_KEY || "";
const sslCert = appConfig.get("sslCert") || process.env.BRIDGE_SSL_CERT || "";

/** Allow runtime to set the relay token (overrides env var). */
export function setRelayToken(token: string): void {
  relayToken = token;
}

/** Allow runtime to set the node identity (injected by NodeRuntime). */
export function setNodeId(id: string): void {
  eventBus.setNodeId(id);
}

/** Get the current nodeId (empty string if not set yet). */
export function getNodeId(): string {
  return eventBus.nodeId;
}

type LocalNodeInfo = {
  id: string;
  name: string;
  role: 'relay' | 'leaf';
  ip: string;
  port: number;
  networkType: 'loopback' | 'lan' | 'wan';
};

let localNodeInfo: LocalNodeInfo = {
  id: '__local__',
  name: os.hostname(),
  role: 'leaf',
  ip: '127.0.0.1',
  port: PORT,
  networkType: 'loopback',
};
let runtimeRelayConnection: RelayConnection | null = null;

/** Allow runtime to publish the actual local node represented by this server. */
export function setLocalNodeInfo(info: Partial<LocalNodeInfo>): void {
  localNodeInfo = { ...localNodeInfo, ...info, id: '__local__' };
}

/** Allow NodeRuntime to expose its live upstream/loopback connection to admin routes. */
export function setRelayConnection(connection: RelayConnection): void {
  runtimeRelayConnection = connection;
}

// ─── Upstream Relay Forwarding ──────────────────────────────────
// Allows forwarding workbench.* messages to an upstream relay
// via the NodeRuntime's RelayConnection.
let _sendUpstream: ((type: string, body: any) => void) | null = null;

export function setRelayUpstream(fn: (type: string, body: any) => void): void {
  _sendUpstream = fn;
}

/**
 * Broadcast tabs to subscribers, optionally excluding a sender.
 * Shared helper for onUpstreamMessage and the workbench.tabs handler.
 */
function broadcastTabs(nodeId: string, tabs: any[], sender?: WebSocket): void {
  const subs = workbenchSubscribers.get(nodeId);
  if (!subs) return;
  for (const client of subs) {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      send(client, envelope("workbench.tabs", { nodeId, tabs }));
    }
  }
}

/**
 * After storing tabs for a nodeId, also sync to any other instances
 * that share the same label (hostname). This bridges cross-relay sync
 * where the same physical node has different instance IDs on each relay.
 */
function syncTabsByLabel(nodeId: string, tabs: any[], sourceLabel?: string, sender?: WebSocket): void {
  const label = sourceLabel || instanceManager.get(nodeId)?.label;
  if (!label) return;
  for (const inst of instanceManager.list()) {
    if (inst.label === label && inst.id !== nodeId) {
      workbenchTabStore.set(inst.id, tabs);
      broadcastTabs(inst.id, tabs, sender);
    }
  }
}

/**
 * Handle a workbench message forwarded from the upstream relay.
 * Called by NodeRuntime when the upstream RelayConnection emits 'relayMessage'.
 */
export function onUpstreamMessage(msg: any): void {
  if (!msg || !msg.type) return;
  if (msg.type === "workbench.tabs") {
    const nodeId = String(msg.nodeId || '');
    const tabs = Array.isArray(msg.tabs) ? msg.tabs : [];
    if (!nodeId) return;
    // Only update store and broadcast if tabs have actual content.
    // Empty tabs (from subscribe responses) must not overwrite existing
    // local store or confuse subscribers with stale empty state.
    if (tabs.length > 0) {
      // Only broadcast if tabs actually changed — prevents echoing
      // a node's own tabs back to its subscribers when the upstream
      // relay broadcasts to this node's agent connection.
      const existing = workbenchTabStore.get(nodeId);
      const changed = !existing || JSON.stringify(existing) !== JSON.stringify(tabs);
      if (changed) {
        workbenchTabStore.set(nodeId, tabs);
        broadcastTabs(nodeId, tabs);
      }
    }
    // Cross-relay label normalization: tabs from upstream use a different
    // instance ID. Find local instances with the same label and sync there.
    syncTabsByLabel(nodeId, tabs, msg._label);
  }
}

// ─── Core Services ────────────────────────────────────────────────
const eventBus = new RelayEventBus();
const instanceManager = new InstanceManager(eventBus);
const auditLog = new AuditLogger(process.cwd());

// ─── Pending External Access Requests ───────────────────────────────
// Map requestId → WebSocket of the browser that initiated the request
const pendingExternalRequests = new Map<string, WebSocket>();
const PENDING_TIMEOUT_MS = 30_000;
const sessionPersistence = new SessionPersistence(process.cwd(), eventBus);
const permissions = new PermissionModel();

// ─── Workbench tab sync ────────────────────────────────────
// Server-side workbench tab store + subscriber tracking for cross-device sync.
const workbenchTabStore = new Map<string, any[]>();
const workbenchSubscribers = new Map<string, Set<WebSocket>>();

function cleanupWorkbenchSubs(ws: WebSocket): void {
  for (const [nodeId, subs] of workbenchSubscribers) {
    subs.delete(ws);
    if (subs.size === 0) workbenchSubscribers.delete(nodeId);
  }
}

// ─── Admin routes state (merged from old dashboard server) ────
const adminLogs: string[] = [];
const adminShellInstances = new Map<string, ShellRunInstance>();
const adminRelayToShellId = new Map<string, string>();

function addAdminLog(msg: string): void {
  adminLogs.push(`[${new Date().toISOString()}] ${msg}`);
  if (adminLogs.length > 200) adminLogs.shift();
}

/** Write stdin data to an ad-hoc shell instance, looked up by relay instance ID. */
export function writeToShellByRelayId(relayInstanceId: string, data: string): boolean {
  const shellId = adminRelayToShellId.get(relayInstanceId);
  if (!shellId) return false;
  const entry = adminShellInstances.get(shellId);
  if (!entry || !entry.proc.stdin?.writable) return false;
  entry.proc.stdin.write(data);
  return true;
}

/** Get the admin logs (for node-runtime to pass to AdminRouteContext). */
export function getAdminLogs(): string[] {
  return adminLogs;
}

/** Append to admin logs from outside. */
export function appendAdminLog(msg: string): void {
  addAdminLog(msg);
}
const relayConfigManager = new RelayConfigManager(eventBus);

// ─── Notification Bus ────────────────────────────────────────────
let ntfCounter = 0;
function notifyBus(params: {
  scenarioId: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  title: string;
  detail?: string;
  duration?: number;
}): string {
  const id = `ntf_${++ntfCounter}_${Date.now().toString(36)}`;
  broadcast(envelope("system.notification", { id, ...params, timestamp: Date.now() }));
  return id;
}
function dismissNotify(id: string): void {
  broadcast(envelope("system.notification_dismiss", { id }));
}

const defaultAdapterId = getDefaultAdapterId();
const defaultInstance = instanceManager.create(process.cwd(), os.hostname());
defaultInstance.status = "running";
defaultInstance.adapterId = defaultAdapterId;
instanceManager.setActive(defaultInstance.id);

// ── Alias store (device naming, persisted to .sessionbridge/aliases.json) ──
const aliasStore: AliasStore = (() => {
  const filePath = join(process.cwd(), '.sessionbridge', 'aliases.json');
  let aliases: Record<string, string> = {};
  try { if (existsSync(filePath)) aliases = JSON.parse(readFileSync(filePath, 'utf-8')); } catch {}
  const save = () => {
    try { mkdirSync(dirname(filePath), { recursive: true }); writeFileSync(filePath, JSON.stringify(aliases, null, 2)); } catch {}
  };
  return {
    get(key: string) { return aliases[key]; },
    set(key: string, alias: string) { aliases[key] = alias; save(); },
    remove(key: string) { delete aliases[key]; save(); },
    all() { return { ...aliases }; },
  };
})();

/** Apply alias from the alias store to an instance (if one exists). */
function applyAlias(inst: import("./instance-manager").InstanceData): void {
  const key = `${inst.source}:${inst.dir}`;
  const alias = aliasStore.get(key);
  if (alias) inst.label = alias;
}
// Apply alias to the default instance too
applyAlias(defaultInstance);

/** Get the currently active instance */
function inst(): import("./instance-manager").InstanceData {
  return instanceManager.getActive() || defaultInstance;
}

/** Check an HTTP request against the permission model. Returns true if allowed. */
function checkHttpPermission(
  res: import("http").ServerResponse,
  category: import("../extensions/types").PermissionCategory,
  context?: Record<string, unknown>,
): boolean {
  const result = permissions.check(category, context);
  if (!result.allowed) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: result.reason || "Permission denied" }));
    return false;
  }
  return true;
}

// ─── MIME ────────────────────────────────────────────────────────
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
};

// ─── Instance-based shorthand accessors ───────────────────────

let blockSeq = 0;
const nextId = () => `blk_${++blockSeq}`;

const MAX_BLOCKS = 500;

function bufferBlock(block: Record<string, unknown>) {
  const i = inst();
  i.blockBuffer.push(block);
  if (i.blockBuffer.length > MAX_BLOCKS) i.blockBuffer.shift();
}

function flushBuffer(ws: WebSocket) {
  const i = inst();
  for (const block of i.blockBuffer) send(ws, block);
  for (const data of i.outputBuffer) send(ws, envelope("instance.output", { data }));
}

// ─── WS Clients ──────────────────────────────────────────────────
const clients = new Set<WebSocket>();
const authenticatedSockets = new Set<WebSocket>();
const shellWsMap = new Map<WebSocket, Set<string>>();
const agentVersionMap = new Map<WebSocket, string>();
// Shell write-lock: instanceId → owning browser WebSocket
const shellLockMap = new Map<string, WebSocket>();
/** Shell output subscribers: instanceId → set of browser WebSockets receiving shell.output */
const shellSubscribers = new Map<string, Set<WebSocket>>();
/** Guard: instanceId → in-flight spawn promise, prevents double-spawn from shell.input handler */
const pendingShellSpawns = new Map<string, Promise<unknown>>();

function subscribeShellOutput(instanceId: string, ws: WebSocket): void {
  if (!shellSubscribers.has(instanceId)) shellSubscribers.set(instanceId, new Set());
  shellSubscribers.get(instanceId)!.add(ws);
  // Clean subscriber ref when the WS disconnects
  ws.addEventListener('close', () => {
    const subs = shellSubscribers.get(instanceId);
    if (subs) { subs.delete(ws); if (subs.size === 0) shellSubscribers.delete(instanceId); }
  }, { once: true });
}

function broadcastShellOutput(instanceId: string, data: string, stream: string = 'stdout'): void {
  const subs = shellSubscribers.get(instanceId);
  if (!subs || subs.size === 0) return;
  const msg = envelope("shell.output", { data, stream });
  for (const ws of subs) {
    if (ws.readyState === WebSocket.OPEN) send(ws, msg);
    else subs.delete(ws);
  }
}

// Session persistence: clientToken → session data for reconnect recovery
interface ClientSession { ws: WebSocket; shellIds: Set<string>; label: string; disconnectTime?: number }
const clientSessionMap = new Map<string, ClientSession>();
const wsToClientToken = new Map<WebSocket, string>();
const SESSION_RECONNECT_GRACE_MS = 60000; // 60s grace period before cleanup

// ─── Chunk reassembly ─────────────────────────────────────────────
interface ChunkedBuffer { total: number; parts: string[]; ts: number }
const chunkBuffers = new Map<string, ChunkedBuffer>();

function reassembleChunk(msg: Record<string, any>): string | null {
  const chunk = msg.chunk as { msgId?: string; seq?: number; total?: number } | undefined;
  if (!chunk?.msgId) return msg.line || msg.data || null;
  let buf = chunkBuffers.get(chunk.msgId);
  if (!buf) {
    buf = { total: chunk.total ?? 0, parts: [], ts: Date.now() };
    chunkBuffers.set(chunk.msgId, buf);
  }
  buf.parts[chunk.seq ?? 0] = msg.line || msg.data || '';
  if (buf.parts.filter(() => true).length < buf.total) return null; // incomplete
  chunkBuffers.delete(chunk.msgId);
  return buf.parts.join('');
}

// Clean up stale chunk buffers every 30s
setInterval(() => {
  const now = Date.now();
  for (const [key, buf] of chunkBuffers) {
    if (now - buf.ts > 30000) chunkBuffers.delete(key);
  }
}, 30000);

function send(ws: WebSocket, msg: unknown) {
  if (ws.readyState !== WebSocket.OPEN) return;
  const cs = cryptoStreams.get(ws);
  if (cs?.isEstablished) {
    cs.send(JSON.stringify(msg));
  } else {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(msg: unknown) {
  for (const ws of clients) send(ws, msg);
}

// ─── Peer Discovery ──────────────────────────────────────────
// Tracks connected browsers/agents and broadcasts peer list changes.

function classifyPeerIP(ip: string): 'loopback' | 'lan' | 'wan' {
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return 'loopback';
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return 'lan';
  if (ip.startsWith('172.')) {
    const second = parseInt(ip.split('.')[1], 10);
    if (second >= 16 && second <= 31) return 'lan';
  }
  return 'wan';
}

function getPeerInfo(ws: WebSocket): Record<string, unknown> | null {
  const label = (ws as any)._agentLabel || (ws as any)._browserLabel;
  if (!label) return null; // not fully identified yet
  const rawIP = (ws as any)._socket?.remoteAddress || '127.0.0.1';
  const ip = rawIP.replace(/^::ffff:/, '');
  const networkType = classifyPeerIP(ip);
  const isAgent = !!(ws as any)._isAgent;
  const info: Record<string, unknown> = {
    id: (ws as any)._agentInstanceId || (ws as any)._browserId || `peer_${Date.now()}`,
    name: label,
    ip,
    type: isAgent ? 'agent' : 'browser',
    networkType,
    hasPublicAccess: networkType === 'wan',
    connectedAt: (ws as any)._connectedAt || Date.now(),
  };
  if (isAgent) {
    info.role = (ws as any)._agentRole || 'leaf';
  }
  const latency = (ws as any)._latency;
  if (latency !== undefined) info.latency = latency;
  return info;
}

/** Normalize WebSocket remote address for IP-based grouping. */
function normalizePeerIP(ws: WebSocket): string {
  if (!(ws as any)._socket) return '127.0.0.1';
  const raw = (ws as any)._socket.remoteAddress || '127.0.0.1';
  let ip = raw.replace(/^::ffff:/, '');
  if (ip === '::1') ip = '127.0.0.1';
  return ip;
}

function collectPeers(): { peers: Record<string, unknown>[]; links: { source: string; target: string; type: string }[] } {
  const peers: Record<string, unknown>[] = [{
    ...localNodeInfo,
    type: 'agent',
    hasPublicAccess: localNodeInfo.role === 'relay' || localNodeInfo.networkType === 'wan',
    connectedAt: START_TIME,
    isLocal: true,
  }];
  // Group browser connections by IP — same device = one VIEW node regardless of tab count
  const browserByIP = new Map<string, { count: number; connectedAt: number; label: string }>();
  for (const ws of clients) {
    if (!(ws as any)._isAgent) {
      const label = (ws as any)._browserLabel;
      if (!label) continue;
      const ip = normalizePeerIP(ws);
      const group = browserByIP.get(ip);
      if (group) {
        group.count++;
        const ca = (ws as any)._connectedAt || Date.now();
        if (ca < group.connectedAt) group.connectedAt = ca;
      } else {
        browserByIP.set(ip, {
          count: 1,
          connectedAt: (ws as any)._connectedAt || Date.now(),
          label,
        });
      }
      continue;
    }
    const info = getPeerInfo(ws);
    if (info) peers.push(info);
  }
  // Add one aggregated VIEW node per unique IP
  for (const [ip, group] of browserByIP) {
    const networkType = classifyPeerIP(ip);
    peers.push({
      id: `view_${ip}`,
      name: group.label,
      ip,
      type: 'browser',
      networkType,
      hasPublicAccess: networkType === 'wan',
      connectedAt: group.connectedAt,
      tabCount: group.count,
    });
  }
  // Also collect agents (agents are removed from clients set but have _isAgent)
  for (const inst of instanceManager.list()) {
    if (inst.agentConnection && !clients.has(inst.agentConnection)) {
      const ws2 = inst.agentConnection;
      const rawIP = (ws2 as any)._socket?.remoteAddress || '127.0.0.1';
      const ip = rawIP.replace(/^::ffff:/, '');
      const networkType = classifyPeerIP(ip);
      const viaRelayId: string | undefined = (ws2 as any)._viaRelayId;
      peers.push({
        id: inst.id,
        name: inst.label,
        ip,
        type: 'agent',
        role: (ws2 as any)._agentRole || 'leaf',
        networkType,
        hasPublicAccess: networkType === 'wan',
        connectedAt: inst.createdAt,
        connectedToRelayId: viaRelayId || null,
        latency: (ws2 as any)._latency,
      });
    }
  }

  // Build topology links from peer list
  const links: { source: string; target: string; type: string }[] = [];
  const relayPeers = peers.filter(p => p.id !== '__local__' && p.type === 'agent' && (p.role === 'relay' || p.hasPublicAccess));
  const leafPeers = peers.filter(p => p.id !== '__local__' && p.type === 'agent' && p.role !== 'relay' && !p.hasPublicAccess);

  for (const leaf of leafPeers) {
    const explicitRelayId = leaf.connectedToRelayId as string | undefined;
    if (explicitRelayId && peers.some(p => p.id === explicitRelayId)) {
      links.push({ source: explicitRelayId, target: leaf.id as string, type: 'agent' });
    } else if (relayPeers.length === 1) {
      // Single relay — all leaves are behind it
      links.push({ source: relayPeers[0].id as string, target: leaf.id as string, type: 'agent' });
    } else {
      // Unknown topology — leaf connects to local node directly
      links.push({ source: '__local__', target: leaf.id as string, type: 'agent' });
    }
  }
  // If relays exist, link them to local.
  for (const rp of relayPeers) {
    links.push({ source: '__local__', target: rp.id as string, type: 'relay' });
  }

  return { peers, links };
}

function broadcastPeers(): void {
  const { peers, links } = collectPeers();
  for (const ws of clients) {
    if ((ws as any)._isAgent) {
      send(ws, envelope("peer.list", { peers, links }));
    } else {
      const ip = normalizePeerIP(ws);
      send(ws, envelope("peer.list", {
        peers: peers.filter(p => p.type !== 'browser' || p.ip !== ip),
        links,
      }));
    }
  }
}

function sendPeers(ws: WebSocket): void {
  const { peers, links } = collectPeers();
  if ((ws as any)._isAgent) {
    send(ws, envelope("peer.list", { peers, links }));
  } else {
    const ip = normalizePeerIP(ws);
    send(ws, envelope("peer.list", {
      peers: peers.filter(p => p.type !== 'browser' || p.ip !== ip),
      links,
    }));
  }
}

function sendBlock(block: Record<string, unknown>) {
  const msg = envelope("instance.block", { ...block, ts: Date.now() });
  broadcast(msg);
  if (block.blockType !== 'user') {
    bufferBlock(msg);
  }
}

function resetStreamState() {
  const i = inst();
  i.thinkingId = null;
  i.thinkingText = "";
  i.toolUseId = null;
  i.toolResult = "";
  i.textBuffer = "";
}

// ─── Spawn / Kill Instance ──────────────────────────────────────
async function spawnInstance(instanceId?: string) {
  const i = instanceId ? (instanceManager.get(instanceId) || inst()) : inst();
  instanceManager.setActive(i.id);

  // Permission check
  const permResult = permissions.check('processManagement', { action: 'spawn', instanceId: i.id, adapterId: i.adapterId });
  if (!permResult.allowed) {
    broadcast(envelope("instance.block", { blockType: "error", text: `Spawn denied: ${permResult.reason}` }));
    return;
  }

  // Kill existing process via handle
  if (i.handle) {
    i.handle.stop().catch(() => {});
    i.handle = undefined;
  }
  if (i.process) {
    i.process.kill();
    i.process = null;
  }

  // Clear stale blocks (but preserve outputBuffer — it's needed for shell replay on reconnect)
  i.blockBuffer.length = 0;

  const adapter = resolveAdapter(i.adapterId) || adapterRegistry.get(getDefaultAdapterId())!;
  const adapterName = adapter.displayName;

  broadcast(envelope("instance.block", { blockType: "status", text: `Spawning ${adapterName} instance...` }));

  // Delegate to adapter.start() — adapter owns process lifecycle
  i.handle = await adapter.start({
    workspaceId: i.id,
    directory: i.dir,
    label: i.label,
    adapterId: i.adapterId || getDefaultAdapterId(),
    config: { model: i.model },
    onBlock: (block: Record<string, unknown>) => {
      const msg = envelope("instance.block", { ...block, ts: Date.now() });
      broadcast(msg);
      if (block.blockType !== 'user') {
        i.blockBuffer.push(msg);
        if (i.blockBuffer.length > 2000) i.blockBuffer.shift();
      }
    },
    onOutput: (data: string) => {
      if (!adapter.getCapabilities().structuredEvents) {
        broadcastShellOutput(i.id, data, "stdout");
      } else {
        broadcast(envelope("instance.output", { data }));
      }
      i.outputBuffer.push(data);
      if (i.outputBuffer.length > 2000) i.outputBuffer.shift();
      i.outputSize += data.length;
    },
    onExit: (code: number | null) => {
      if (code !== null && code !== 0) {
        sendBlock({ blockType: "status", text: `Process exited (${code})` });
      }
      i.handle = undefined;
      i.process = null;
      i.status = 'stopped';
    },
  });

  i.status = 'running';
}

function killInstance(instanceId?: string) {
  const i = instanceId ? instanceManager.get(instanceId) : inst();
  if (!i) return;
  if (i.handle) {
    i.handle.stop().catch(() => {});
    i.handle = undefined;
  }
  if (i.process) {
    i.process.kill();
    i.process = null;
  }
  i.status = 'stopped';
  releaseQueueForInstance(i);
}

async function spawnShellForWs(ws: WebSocket, instanceId?: string): Promise<import("./instance-manager").InstanceData> {
  // Permission check
  const permResult = permissions.check('shellAccess', { action: 'spawn_shell' });
  if (!permResult.allowed) {
    send(ws, envelope("error", { code: "ACCESS_DENIED", message: permResult.reason || "Shell access denied" }));
    throw new Error(permResult.reason || 'Shell access denied');
  }

  let i: import("./instance-manager").InstanceData;
  let terminalAdapter: import("../extensions/types").AgentAdapter | undefined;

  if (instanceId) {
    const existing = instanceManager.get(instanceId);
    if (existing) {
      // Use the instance's own adapter — NOT resolveAdapterByCapability('terminal', true).
      // resolveAdapterByCapability returns the FIRST registered adapter with terminal:true,
      // which may be claude-code (also terminal-capable) rather than shell. Using the
      // instance's own adapter guarantees we spawn with the correct adapter type.
      terminalAdapter = existing.adapterId ? adapterRegistry.get(existing.adapterId) : undefined;
      if (!terminalAdapter) {
        // Adapter not found (e.g., 'unknown') — fall back to shell adapter
        terminalAdapter = adapterRegistry.get('shell') || resolveAdapterByCapability('terminal', true);
      }
      if (!terminalAdapter) {
        send(ws, envelope("error", { code: "INVALID_ADAPTER", message: `Instance ${instanceId} has unknown adapter: ${existing.adapterId} and no shell fallback` }));
        throw new Error(`Instance ${instanceId} has unknown adapter: ${existing.adapterId} and no shell fallback`);
      }
      if (!terminalAdapter.getCapabilities().terminal) {
        send(ws, envelope("error", { code: "NOT_TERMINAL", message: "Instance is not terminal-capable — cannot attach shell" }));
        throw new Error(`Instance ${instanceId} is not terminal-capable`);
      }
      i = existing;
    } else {
      // Instance not found — create new one with shell adapter specifically.
      terminalAdapter = adapterRegistry.get('shell') || resolveAdapterByCapability('terminal', true);
      if (!terminalAdapter) {
        send(ws, envelope("error", { code: "NO_TERMINAL_ADAPTER", message: "No terminal-capable adapter available" }));
        throw new Error('No terminal-capable adapter available for shell.spawn');
      }
      i = instanceManager.create(process.cwd(), os.hostname(), "local", terminalAdapter.id);
    }
  } else {
    // No instanceId — create new instance with shell adapter specifically.
    terminalAdapter = adapterRegistry.get('shell') || resolveAdapterByCapability('terminal', true);
    if (!terminalAdapter) {
      send(ws, envelope("error", { code: "NO_TERMINAL_ADAPTER", message: "No terminal-capable adapter available" }));
      throw new Error('No terminal-capable adapter available for shell.spawn');
    }
    i = instanceManager.create(process.cwd(), os.hostname(), "local", terminalAdapter.id);
  }

  // Apply alias from the alias store (if one exists for this instance)
  applyAlias(i);

  // Track ownership
  if (!shellWsMap.has(ws)) shellWsMap.set(ws, new Set());
  shellWsMap.get(ws)!.add(i.id);

  // Remote instances: shell already runs on the agent, don't spawn locally
  if (i.source === 'remote') {
    i.status = 'running';
    send(ws, envelope("shell.output", { data: `\x1b[36mConnected to remote shell on ${i.label || i.id}\x1b[0m\r\n`, stream: "stdout" }));
    sendStdin(i, '\n');
    return i;
  }

  // ── Reconnect to existing shell ──────────────────────
  if (i.handle && i.status === 'running') {
    subscribeShellOutput(i.id, ws);
    // Replay output buffer to the newly connected WS
    for (const chunk of i.outputBuffer) {
      send(ws, envelope("shell.output", { data: chunk, stream: "stdout" }));
    }
    send(ws, envelope("shell.output", { data: `\x1b[33m[Reconnected — output history above]\x1b[0m\r\n`, stream: "stdout" }));
    return i;
  }

  // ── Fresh spawn ──────────────────────────────────
  subscribeShellOutput(i.id, ws);
  i.handle = await terminalAdapter.start({
    workspaceId: i.id,
    directory: i.dir,
    label: i.label || terminalAdapter.displayName,
    adapterId: terminalAdapter.id,
    config: {},
    onOutput: (data: string) => {
      broadcastShellOutput(i.id, data, "stdout");
      i.outputBuffer.push(data);
      i.outputSize += data.length;
      while (i.outputSize > 512 * 1024 && i.outputBuffer.length > 0) {
        i.outputSize -= i.outputBuffer.shift()?.length ?? 0;
      }
    },
    onExit: (code: number | null) => {
      // Notify all subscribers
      const subs = shellSubscribers.get(i.id);
      if (subs) {
        const msg = envelope("shell.exit", { code });
        for (const s of subs) {
          if (s.readyState === WebSocket.OPEN) send(s, msg);
        }
      }
      i.handle = undefined;
      i.status = "stopped";
    },
  });

  i.status = "running";
  return i;
}

function interruptInstance(instanceId?: string) {
  const i = instanceId ? instanceManager.get(instanceId) : inst();
  if (!i) return false;
  if (i.source === 'remote') {
    sendBlock({ blockType: "status", text: "Cannot interrupt remote instance" });
    return false;
  }
  if (!i.process?.pid) return false;

  sendBlock({ blockType: "status", text: "Interrupting and rewinding changes..." });
  const rewindResult = i.checkpointManager.rewindCurrentTurn();
  if (rewindResult.restored > 0) {
    sendBlock({ blockType: "status", text: `↩ Rewound ${rewindResult.restored} change(s) (${rewindResult.skipped} skipped)` });
  }

  try {
    if (process.platform === "win32") {
      execSync(`taskkill //PID ${i.process.pid} //T`, { timeout: 3000 });
    } else {
      process.kill(i.process.pid, "SIGINT");
    }
    setTimeout(() => {
      if (i.process) {
        i.process.kill();
        i.process = null;
        spawnInstance(i.id);
      }
    }, 5000);
    return true;
  } catch {
    return false;
  }
}

// ─── Mode / Effort State ──────────────────────────────────────────
let currentPermissionMode: string = "default";
let currentEffortLevel: string = "medium";

// ─── Control Request Protocol (stdin JSON commands to Claude) ────
function sendControlRequest(subtype: string, data: Record<string, unknown>, instanceId?: string): boolean {
  const i = instanceId ? (instanceManager.get(instanceId) || inst()) : inst();
  if (i.source === 'remote') {
    if (!i.agentConnection || i.agentConnection.readyState !== WebSocket.OPEN) return false;
    const requestId = `r${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const msg = JSON.stringify({
      type: "control_request",
      request_id: requestId,
      request: { subtype, ...data },
    }) + "\n";
    send(i.agentConnection, envelope("agent.stdin", { instanceId: i.id, data: msg }));
    broadcast(envelope("instance.control_sent", { subtype, ...data, requestId }));
    return true;
  }
  // Prefer adapter handle for local instances
  if (i.handle) {
    i.handle.sendCommand(subtype, data).catch(() => {});
    broadcast(envelope("instance.control_sent", { subtype, ...data }));
    return true;
  }
  if (!i.process?.stdin?.writable) return false;
  const requestId = `r${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const msg = JSON.stringify({
    type: "control_request",
    request_id: requestId,
    request: { subtype, ...data },
  }) + "\n";
  i.process.stdin.write(msg);
  broadcast(envelope("instance.control_sent", { subtype, ...data, requestId }));
  return true;
}

function setPermissionMode(mode: "default" | "acceptEdits" | "plan") {
  currentPermissionMode = mode;
  sendControlRequest("set_permission_mode", { mode });
  broadcast(envelope("system.mode_changed", { mode, effort: currentEffortLevel }));
}

function setThinkingLevel(level: "low" | "medium" | "high") {
  currentEffortLevel = level;
  const tokens = level === "low" ? 0 : 31999;
  sendControlRequest("set_max_thinking_tokens", { maxThinkingTokens: tokens });
  broadcast(envelope("system.mode_changed", { mode: currentPermissionMode, effort: level }));
}

// ─── Message Queue (sequential processing, source-locked) ──────────

/** Write data to an instance's stdin (local process or remote agent). */
function sendStdin(i: import("./instance-manager").InstanceData, data: string): boolean {
  if (i.source === 'remote') {
    if (!i.agentConnection || i.agentConnection.readyState !== WebSocket.OPEN) return false;
    send(i.agentConnection, envelope("agent.stdin", { instanceId: i.id, data }));
    return true;
  }
  // Prefer adapter handle for local instances
  if (i.handle) {
    i.handle.send(data).catch(() => {});
    return true;
  }
  if (!i.process?.stdin?.writable) return false;
  i.process.stdin.write(data);
  return true;
}

function processQueueForInstance(i: import("./instance-manager").InstanceData) {
  const canProcess = i.source === 'remote'
    ? (i.agentConnection && i.agentConnection.readyState === WebSocket.OPEN)
    : !!i.process?.stdin?.writable;
  if (i.isProcessing || i.pendingQueue.length === 0 || !canProcess) {
    if (i.pendingQueue.length === 0) i.queueLock = null;
    return;
  }
  i.isProcessing = true;
  const entry = i.pendingQueue.shift()!;
  const pipeIdx = entry.indexOf("|");
  const source = pipeIdx > 0 ? entry.slice(0, pipeIdx) : "terminal";
  const text = pipeIdx > 0 ? entry.slice(pipeIdx + 1) : entry;

  broadcast(envelope("queue.status", {
    processing: true,
    source,
    queueDepth: i.pendingQueue.length,
  }));

  // Strict lookup — this instance's queue must use its own adapter's capabilities.
  const queueAdapter = i.adapterId ? adapterRegistry.get(i.adapterId) : undefined;
  const cap = queueAdapter?.getCapabilities();
  if (cap?.structuredEvents) {
    // Structured adapter: JSONL-encoded user message
    resetStreamState();
    if (i.source !== 'remote') i.checkpointManager.startNewTurn();
    sendStdin(i, JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
    }) + "\n");
  } else {
    // Terminal adapter: send raw text to stdin
    sendStdin(i, text + "\n");
    i.isProcessing = false;
    processQueueForInstance(i);
  }
}

function processQueue() {
  const i = inst();
  processQueueForInstance(i);
}

function enqueueInput(text: string, source: string = "terminal") {
  const i = inst();
  if (i.isProcessing && i.queueLock && i.queueLock !== source && !text.startsWith("/")) {
    broadcast(envelope("system.queue_blocked", {
      message: `Cannot send — ${i.queueLock} is currently processing. Wait or interrupt first.`,
      blockedSource: source,
      activeSource: i.queueLock,
    }));
    return;
  }

  if (!i.queueLock) i.queueLock = source;
  i.pendingQueue.push(`${source}|${text}`);

  broadcast(envelope("queue.status", {
    processing: i.isProcessing,
    source: i.queueLock,
    queueDepth: i.pendingQueue.length,
  }));

  processQueueForInstance(i);
}

function releaseQueueForInstance(i: import("./instance-manager").InstanceData) {
  i.pendingQueue.length = 0;
  i.queueLock = null;
  i.isProcessing = false;
  broadcast(envelope("queue.status", {
    processing: false,
    source: null,
    queueDepth: 0,
  }));
}

function releaseQueue() {
  const i = inst();
  releaseQueueForInstance(i);
}

/**
 * Create parser deps for any instance (local or remote).
 * Used by both spawnInstance() and agent message handlers.
 */
function parserDepsFor(i: import("./instance-manager").InstanceData): StreamParserDeps {
  return {
    sendBlock: (block: Record<string, unknown>) => {
      const msg = envelope("instance.block", { ...block, ts: Date.now() });
      broadcast(msg);
      if (block.blockType !== 'user') {
        i.blockBuffer.push(msg);
        if (i.blockBuffer.length > MAX_BLOCKS) i.blockBuffer.shift();
      }
    },
    broadcast: (msg: unknown) => broadcast(msg),
    bufferOutput: (data: string) => {
      bufferOutputFor(i, data);
    },
    nextId,
    setActive: (id: string | null) => instanceManager.setActive(id),
    getActiveId: () => instanceManager.activeId,
    processQueueForInstance: (inst: any) => {
      processQueueForInstance(inst);
    },
    sendControlRequest,
    getEffortLevel: () => currentEffortLevel,
  };
}

function bufferOutputFor(i: import("./instance-manager").InstanceData, data: string) {
  i.outputBuffer.push(data);
  i.outputSize += data.length;
  while (i.outputSize > 512 * 1024 && i.outputBuffer.length > 0) {
    i.outputSize -= i.outputBuffer.shift()?.length ?? 0;
  }
}

// ─── HTTP Server ──────────────────────────────────────────────────
const OUT_DIR = join(process.cwd(), "out");
let ROOT_DIR = inst().dir;

const serverRequestHandler = async (req: import("http").IncomingMessage, res: import("http").ServerResponse) => {
  // CORS headers: allow any origin so the Next.js dev server (port 3000)
  // can call the relay API (port 8080) during development.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Delegate to structured API routes first
  if (registerApiRoutes(req, res, { instanceManager, broadcast, auditLog, checkPermission: checkHttpPermission, configManager: appConfig, relayConfig: relayConfigManager, configRegistry, configStore, secretStore, workDir: process.cwd(), aliases: aliasStore })) return;

  // Delegate to admin routes (migrated from dashboard server)
  if (await registerAdminRoutes(req, res, {
    nodeLabel: os.hostname(),
    nodeStartTime: START_TIME,
    adapters: [],
    permissions,
    relayConnection: runtimeRelayConnection,
    relayPort: PORT,
    upstreamRelay: undefined,
    relayToken: relayToken || undefined,
    role: localNodeInfo.role,
    shellInstances: adminShellInstances,
    relayToShellId: adminRelayToShellId,
    extensionHost: null,
    logs: adminLogs,
    addLog: addAdminLog,
  })) return;

  const url = new URL(req.url!, `http://${req.headers.host}`);
  const path = url.pathname.replace(/\/$/, '') || '/';
  const clientIp = req.socket.remoteAddress || "unknown";

  // API-level rate limiting (skip for static and health)
  const isApiRoute = path.startsWith("/api/") && path !== "/api/health" && path !== "/api/info";
  if (isApiRoute && req.method === "POST" && !checkRateLimit(clientIp)) {
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Too many requests. Please slow down." }));
    return;
  }

  // ── API: List directory ──────────────────────────────────
  // Supports `?dir=` and `?showAll=1` — when showAll is set, all files
  // including dotfiles and common noise directories are shown.
  if (path === "/api/list" && req.method === "GET") {
    if (!checkHttpPermission(res, 'fileRead', { path: url.searchParams.get("dir") || "." })) return;
    const dirParam = url.searchParams.get("dir") || ".";
    const showAll = url.searchParams.get("showAll") === "1";
    const targetDir = isAbsolute(dirParam) ? dirParam : resolve(ROOT_DIR, dirParam);
    if (!existsSync(targetDir)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Directory not found" }));
      return;
    }

    // Default ignore list — common noise directories and files,
    // matching the convention used by VS Code / GitHub's file explorer.
    const IGNORE_DIRS = new Set([
      'node_modules', '.git', '.next', 'dist', 'build', 'out',
      'target', '.cache', '__pycache__', '.venv', 'venv', 'env',
      'coverage', '.nyc_output', '.parcel-cache', '.svn', '.hg',
      '.sass-cache', '.eslintcache', '.pytest_cache', 'bower_components',
      'jspm_packages', '.lsp', '.tmp', 'tmp',
    ]);
    const IGNORE_FILES = new Set([
      '.DS_Store', 'Thumbs.db', 'desktop.ini',
    ]);

    try {
      const entries = readdirSync(targetDir, { withFileTypes: true });
      let items = entries.map(e => {
        const full = join(targetDir, e.name);
        const rel = full.startsWith(ROOT_DIR)
          ? relative(ROOT_DIR, full).replace(/\\/g, "/")
          : full.replace(/\\/g, "/");
        return {
          name: e.name,
          path: rel,
          type: e.isDirectory() ? "dir" : "file",
          size: e.isFile() ? statSync(full).size : 0,
        };
      });

      if (!showAll) {
        items = items.filter(e =>
          !((e.type === 'dir' && IGNORE_DIRS.has(e.name)) ||
            (e.type === 'file' && IGNORE_FILES.has(e.name)) ||
            e.name.startsWith('.'))
        );
      }

      items.sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ items, cwd: targetDir.replace(/\\/g, "/"), showAll }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── API: Read file ──────────────────────────────────────
  if (path === "/api/read-file" && req.method === "GET") {
    if (!checkHttpPermission(res, 'fileRead', { path: url.searchParams.get("path") || "" })) return;
    const fileParam = url.searchParams.get("path") || "";
    const targetFile = isAbsolute(fileParam) ? fileParam : resolve(ROOT_DIR, fileParam);

    if (!targetFile.startsWith(ROOT_DIR)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Outside workspace" }));
      return;
    }

    if (!existsSync(targetFile) || statSync(targetFile).isDirectory()) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "File not found" }));
      return;
    }

    try {
      const content = readFileSync(targetFile, "utf8");
      const rel = relative(ROOT_DIR, targetFile).replace(/\\/g, "/");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: rel, content }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── API: Project info ───────────────────────────────────
  if (path === "/api/info") {
    let projectName = basename(ROOT_DIR);
    try {
      const pkg = readFileSync(join(ROOT_DIR, "package.json"), "utf8");
      const p = JSON.parse(pkg);
      if (p.name) projectName = p.name;
    } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ cwd: ROOT_DIR, projectName, projectDir: ROOT_DIR }));
    return;
  }

  // ── API: Check for updates ──────────────────────────────
  if (path === "/api/check-update") {
    const { execSync } = require("child_process");
    const scriptPath = join(process.cwd(), "scripts", "check-update.js");
    try {
      const result = execSync(`node "${scriptPath}"`, {
        encoding: "utf-8", timeout: 70000, stdio: ['pipe', 'pipe', 'pipe'],
      });
      // stderr from git fetch may have been mixed in — extract last JSON line
      const lines = result.trim().split('\n').filter(Boolean);
      const lastJson = lines.filter((l: string) => l.startsWith('{')).pop() || '{}';
      let data;
      try { data = JSON.parse(lastJson); } catch { data = { error: 'parse failed' }; }
      data.currentVersion = SERVER_VERSION;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ currentVersion: SERVER_VERSION, hasUpdate: false, error: "check failed" }));
    }
    return;
  }

  // ── API: Trigger update (SSE stream) ────────────────────
  if (path === "/api/do-update" && req.method === "POST") {
    const scriptPath = join(process.cwd(), "scripts", "update.js");
    const { spawn } = require("child_process");

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    // Helper to send SSE events
    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send("status", { message: "Starting update..." });

    const proc = spawn(process.execPath, [scriptPath, "--force"], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) send("log", { message: text });
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) send("log", { message: text });
    });

    proc.on("close", (code: number | null) => {
      if (code === 0) {
        send("complete", { message: "Update complete. Restart server to apply changes." });
      } else {
        send("error", { message: `Update failed (exit code ${code})` });
      }
      res.end();
    });

    proc.on("error", (err: Error) => {
      send("error", { message: err.message });
      res.end();
    });
    return;
  }

  // ── API: Restart server ─────────────────────────────────
  if (path === "/api/restart" && req.method === "POST") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, message: "Restarting..." }));
    // Spawn a child that waits 500ms then kills us — the process manager restarts us
    const { spawn } = require("child_process");
    const killer = spawn(process.execPath, ["-e", `
      setTimeout(() => { process.kill(${process.pid}, 'SIGTERM'); }, 500);
    `], { detached: true, stdio: 'ignore' });
    killer.unref();
    return;
  }

  // ── API: Current version ────────────────────────────────
  if (path === "/api/version") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ version: SERVER_VERSION }));
    return;
  }

  // ── API: Write file (for revert) ────────────────────────
  if (path === "/api/write" && req.method === "POST") {
    if (!checkHttpPermission(res, 'fileWrite')) return;
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      try {
        const { filePath: fp, content } = JSON.parse(body);
        const target = isAbsolute(fp) ? fp : resolve(ROOT_DIR, fp);
        if (!target.startsWith(ROOT_DIR)) {
          res.writeHead(403); res.end(JSON.stringify({ error: "Outside workspace" }));
          return;
        }
        writeFileSync(target, content, "utf8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500); res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // ── API: Download file ──────────────────────────────────
  if (path === "/api/download" && req.method === "GET") {
    if (!checkHttpPermission(res, 'fileRead', { path: url.searchParams.get("path") || "" })) return;
    const fileParam = url.searchParams.get("path") || "";
    const target = isAbsolute(fileParam) ? fileParam : resolve(ROOT_DIR, fileParam);
    if (!target.startsWith(ROOT_DIR)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Outside workspace" }));
      return;
    }
    if (!existsSync(target) || statSync(target).isDirectory()) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "File not found" }));
      return;
    }
    try {
      const content = readFileSync(target);
      const name = basename(target);
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Content-Length": String(content.length),
      });
      res.end(content);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── API: Upload file ────────────────────────────────────
  if (path === "/api/upload" && req.method === "POST") {
    if (!checkHttpPermission(res, 'fileWrite')) return;
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      try {
        const { path: uploadPath, data, encoding } = JSON.parse(body);
        const target = isAbsolute(uploadPath) ? uploadPath : resolve(ROOT_DIR, uploadPath);
        if (!target.startsWith(ROOT_DIR)) {
          res.writeHead(403); res.end(JSON.stringify({ error: "Outside workspace" }));
          return;
        }
        const dir = dirname(target);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const buf = encoding === "base64" ? Buffer.from(data, "base64") : Buffer.from(data, "utf8");
        writeFileSync(target, buf);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, path: relative(ROOT_DIR, target).replace(/\\/g, "/") }));
      } catch (err) {
        res.writeHead(500); res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // ── API: Search Sessions (via SessionProvider) ─────────────
  if (path === "/api/sessions/search" && req.method === "GET") {
    const provider = sessionProvider();
    if (!provider) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ results: [], error: null }));
      return;
    }
    const query = url.searchParams.get("q") || "";
    try {
      const results = provider.searchSessions(query);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ results }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── API: Session detail (via SessionProvider) ─────────────
  if (path === "/api/sessions/detail" && req.method === "GET") {
    const sessionId = url.searchParams.get("id") || "";
    if (!sessionId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing sessionId" }));
      return;
    }
    const provider = sessionProvider();
    if (!provider) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No session provider available" }));
      return;
    }
    const project = url.searchParams.get("project") || "";
    try {
      const result = provider.getSessionDetail(sessionId, project);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── API: Current session detail (via SessionProvider) ─────
  if (path === "/api/sessions/current") {
    const provider = sessionProvider();
    if (!provider) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessionId: "", messages: [], found: false }));
      return;
    }
    try {
      const result = provider.getCurrentSession(ROOT_DIR);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── API: Interrupt ──────────────────────────────────────
  if (path === "/api/interrupt" && req.method === "POST") {
    interruptInstance();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, message: "Interrupt sent" }));
    return;
  }

  // ── API: Rewind ──────────────────────────────────────────
  if (path === "/api/rewind" && req.method === "POST") {
    const { success, checkpoint } = inst().checkpointManager.rewindLastCheckpoint();
    if (success) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, filePath: checkpoint?.filePath }));
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, message: "No checkpoints to rewind" }));
    }
    return;
  }

  // ── API: List checkpoints ──────────────────────────────
  if (path === "/api/checkpoints") {
    const cm = inst().checkpointManager;
    const currentTurnCps = cm.getCurrentTurnCheckpoints();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      total: cm.totalCheckpoints(),
      currentTurn: currentTurnCps.length,
      turnStartIndex: cm.getTurnStartIndex(),
      checkpoints: currentTurnCps.map(c => ({
        id: c.id,
        toolName: c.toolName,
        filePath: c.filePath,
        timestamp: c.timestamp,
        hasExpectedText: !!c.expectedText,
      })),
    }));
    return;
  }

  // ── API: Rewind all (current turn) ────────────────────
  if (path === "/api/rewind-all" && req.method === "POST") {
    const result = inst().checkpointManager.rewindCurrentTurn();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
    return;
  }

  // ── API: Queue status ──────────────────────────────────
  if (path === "/api/queue") {
    const qi = inst();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      isProcessing: qi.isProcessing,
      queueDepth: qi.pendingQueue.length,
      queue: qi.pendingQueue.slice(0, 10).map((t, i) => ({ pos: i + 1, text: t.slice(0, 100) })),
    }));
    return;
  }

  // ── API: Mode / Effort state ──────────────────────────
  if (path === "/api/mode") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      mode: currentPermissionMode,
      effort: currentEffortLevel,
    }));
    return;
  }

  // ── API: Switch session directory ─────────────────────
  if (path === "/api/session/switch" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      try {
        const { directory } = JSON.parse(body);
        const targetDir = join(process.cwd(), directory);
        if (!existsSync(targetDir)) {
          res.writeHead(400); res.end(JSON.stringify({ error: "Directory not found" }));
          return;
        }
        const newInst = instanceManager.create(targetDir, basename(targetDir));
        applyAlias(newInst);
        instanceManager.setActive(newInst.id);
        ROOT_DIR = targetDir;
        spawnInstance(newInst.id);
        broadcast(envelope("instance.added", { instance: { id: newInst.id, dir: newInst.dir, label: newInst.label, status: newInst.status, adapterId: newInst.adapterId, source: newInst.source } }));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, cwd: targetDir, instanceId: newInst.id }));
      } catch (err) {
        res.writeHead(500); res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // ── API: List instances ──────────────────────────────
  if (path === "/api/instances" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      instances: instanceManager.toJSON(),
      activeId: instanceManager.activeId,
    }));
    return;
  }

  // ── API: Create instance ─────────────────────────────
  if (path === "/api/instances" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      try {
        const { dir, label, adapterId } = JSON.parse(body);
        const targetDir = resolve(process.cwd(), dir);
        if (!existsSync(targetDir)) {
          res.writeHead(400); res.end(JSON.stringify({ error: "Directory not found" }));
          return;
        }
        const newInst = instanceManager.create(targetDir, label, undefined, adapterId);
        applyAlias(newInst);
        // Raw terminal adapters (terminal:true, structuredEvents:false) are
        // spawned by ShellTerminal via shell.spawn — pre-spawning here causes
        // a race where two PTYs compete for the same handle, silently dropping
        // or misrouting user input.
        const _instAdapter = adapterId ? adapterRegistry.get(adapterId) : undefined;
        const _instCaps = _instAdapter?.getCapabilities();
        const _isRawTerminal = _instCaps && _instCaps.terminal && !_instCaps.structuredEvents;
        if (!_isRawTerminal) {
          spawnInstance(newInst.id);
        }
        broadcast(envelope("instance.added", { instance: { id: newInst.id, dir: newInst.dir, label: newInst.label, status: newInst.status, adapterId: newInst.adapterId, source: newInst.source } }));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, instance: { id: newInst.id, dir: newInst.dir, label: newInst.label } }));
      } catch (err) {
        res.writeHead(500); res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // ── API: Delete (kill) instance ──────────────────────
  if (path.startsWith("/api/instances/") && req.method === "DELETE") {
    const instId = path.replace("/api/instances/", "");
    const target = instanceManager.get(instId);
    if (!target) {
      res.writeHead(404); res.end(JSON.stringify({ error: "Instance not found" }));
      return;
    }
    killInstance(instId);
    instanceManager.kill(instId);
    broadcast(envelope("instance.removed", { instanceId: instId }));
    if (instanceManager.activeId === instId || !instanceManager.getActive()) {
      const remaining = instanceManager.list();
      if (remaining.length > 0) {
        instanceManager.setActive(remaining[0].id);
        ROOT_DIR = remaining[0].dir;
      } else {
        instanceManager.setActive(null);
      }
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // ── API: Activate (switch to) instance ───────────────
  if (path.startsWith("/api/instances/") && req.method === "POST" && path.endsWith("/activate")) {
    const instId = path.replace("/api/instances/", "").replace("/activate", "");
    const target = instanceManager.get(instId);
    if (!target) {
      res.writeHead(404); res.end(JSON.stringify({ error: "Instance not found" }));
      return;
    }
    instanceManager.setActive(instId);
    ROOT_DIR = target.dir;
    broadcast(envelope("instance.switched", { instanceId: instId }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, instanceId: instId }));
    return;
  }

  // ── API: Health check ──────────────────────────────────
  if (path === "/api/health") {
    const mem = memoryUsage();
    const heartbeatAlive = heartbeatTimer !== undefined;
    res.writeHead(200, { "Content-Type": "application/json" });
    const hi = inst();
    res.end(JSON.stringify({
      status: hi.process ? "ok" : "degraded",
      uptime: Date.now() - START_TIME,
      claude: {
        alive: hi.process !== null,
        pid: hi.process?.pid || null,
        model: hi.model,
      },
      queue: {
        depth: hi.pendingQueue.length,
        processing: hi.isProcessing,
      },
      connections: wss?.clients.size ?? 0,
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
      },
      mode: currentPermissionMode,
      effort: currentEffortLevel,
      activeInstanceId: instanceManager.activeId,
      instances: instanceManager.toJSON(),
    }));
    return;
  }

  // ── Static files (dashboard proxy removed — all routes handled directly) ── (dashboard proxy removed — all routes handled directly) ──
  const cleanPath = path.replace(/^\//, '');
  const filePath = cleanPath || 'index.html';
  const diskPath = join(OUT_DIR, filePath);
  try {
    const content = readFileSync(diskPath);
    const ext = extname(diskPath);
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
    res.end(content);
  } catch {
    try {
      const content = readFileSync(join(OUT_DIR, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(content);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
  }
};

// ─── HTTP/HTTPS Server ──────────────────────────────────────────
let httpServer: ReturnType<typeof createHttpServer> | null = null;
let wss: WebSocketServer | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
const HEARTBEAT_INTERVAL = 30000;
const heartbeatMap = new WeakMap<WebSocket, boolean>();

// ─── Crypto Layer ──────────────────────────────────────────────
const serverIdentity = loadOrCreateIdentity();
const cryptoStreams = new WeakMap<WebSocket, CryptoStream>();

function ensureServer(): void {
  if (httpServer) return;

  // Only auto-generate self-signed cert if SSL was explicitly configured
  const hasExplicitSSL = !!appConfig.get("sslKey") || !!process.env.BRIDGE_SSL_KEY;
  let keyPath = sslKey;
  let certPath = sslCert;
  if (hasExplicitSSL && (!keyPath || !certPath)) {
    const autoPaths = ensureCert();
    if (autoPaths) {
      keyPath = autoPaths.key;
      certPath = autoPaths.cert;
    }
  }

  if (keyPath && certPath) {
    httpServer = createHttpsServer({
      key: readFileSync(keyPath, "utf8"),
      cert: readFileSync(certPath, "utf8"),
    }, serverRequestHandler);
  } else {
    httpServer = createHttpServer(serverRequestHandler);
  }
  wss = new WebSocketServer({ server: httpServer });
  heartbeatTimer = setInterval(heartbeatPing, HEARTBEAT_INTERVAL);
  wss.on("close", () => { if (heartbeatTimer) clearInterval(heartbeatTimer); });
  setupWssHandlers();
}

function heartbeatPing() {
  if (!wss) return;
  for (const ws of wss.clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (heartbeatMap.get(ws) === false) {
      ws.terminate();
      continue;
    }
    heartbeatMap.set(ws, false);
    (ws as any)._lastPingTime = Date.now();
    send(ws, envelope("ping"));
  }
}

/** Register WebSocket connection handlers. Called from ensureServer(). */
function setupWssHandlers(): void {
  wss!.on("connection", (ws: WebSocket) => {
  heartbeatMap.set(ws, true);
  clients.add(ws);

  ws.on("pong", () => {
    heartbeatMap.set(ws, true);
  });

  // Don't start Claude until we know the client's intent

  ws.on("message", (raw: Buffer) => {
    // ── Crypto: decrypt before processing ────────────────────
    const cs = cryptoStreams.get(ws);
    const rawStr = cs?.isEstablished ? tryDecrypt(cs.sessionKey, raw.toString()) : raw.toString();

    const msg = parseMsg(rawStr);
    if (!msg) return;

    // ── Lifecycle: hello/welcome handshake ────────────────
    if (msg.type === "hello") {
      const token = msg.token || "";
      const role = msg.role || "browser";
      const clientToken = msg.clientToken || "";

      // Authentication check
      if (relayToken && token !== relayToken) {
        send(ws, envelope("error", { code: "UNAUTHORIZED", message: "Invalid or missing token" }));
        setTimeout(() => ws.close(4001, "Unauthorized"), 100);
        return;
      }
      authenticatedSockets.add(ws);

      // ── Crypto handshake (v0.7+) ─────────────────────────
      const clientFeatures: string[] = Array.isArray(msg.features) ? msg.features : [];
      const clientWantsCrypto = clientFeatures.includes("crypto_v1");
      let cryptoSession: CryptoStream | null = null;
      if (clientWantsCrypto) {
        cryptoSession = new CryptoStream(ws, serverIdentity);
        cryptoStreams.set(ws, cryptoSession);
      }

      // Session recovery: if browser reconnects with same clientToken, restore session
      let restoredInstances: Record<string, unknown>[] = [];
      if (role === "browser" && clientToken) {
        const prevSession = clientSessionMap.get(clientToken);
        if (prevSession && prevSession.disconnectTime) {
          // Reconnect: reuse shell instances
          const allInstances = instanceManager.toJSON();
          for (const shellId of prevSession.shellIds) {
            const match = allInstances.find(ji => ji.id === shellId);
            if (match) restoredInstances.push(match);
          }
          prevSession.ws = ws;
          prevSession.disconnectTime = undefined;
        } else {
          clientSessionMap.set(clientToken, { ws, shellIds: new Set(), label: msg.label || '' });
        }
        wsToClientToken.set(ws, clientToken);
      }

      // Start Claude on first browser connection (skip in test mode)
      if (role === "browser" && !process.env.BRIDGE_TEST_MODE) {
        const activeInst = inst();
        if (!activeInst.process && activeInst.adapterId && adapterRegistry.get(activeInst.adapterId)?.getCapabilities().structuredEvents) spawnInstance();
      }

      // Track agent version for update notification
      if (role === "agent" && msg.version) {
        agentVersionMap.set(ws, msg.version);
      }

      // Flush history
      flushBuffer(ws);

      // Build server features list
      const serverFeatures = [
        "crypto_v1",
        "agent_registration", "shell", "multi_instance",
        "structured_chat", "queue", "update_notification", "session_recovery",
      ];

      // Respond with welcome (include crypto keys if handshaking)
      const welcomeBody: Record<string, unknown> = {
        version: SERVER_VERSION,
        features: serverFeatures,
        sessionId: inst().id,
        serverTime: Date.now(),
        instances: instanceManager.toJSON(),
        extensionPoints: extensionPoints.toJSON(),
        ...(restoredInstances.length > 0 ? { restoredInstances } : {}),
      };
      if (cryptoSession) {
        welcomeBody.staticKey = cryptoSession.staticKey;
        welcomeBody.ephemeralKey = cryptoSession.ephemeralKey;
      }
      send(ws, envelope("welcome", welcomeBody));

      // Tag peer info and broadcast to all connected clients
      if (role === "browser") {
        (ws as any)._browserLabel = msg.label || `Browser-${Date.now().toString(36).slice(-4)}`;
        (ws as any)._browserId = msg.clientToken || `browser_${Date.now()}`;
        (ws as any)._connectedAt = Date.now();
        sendPeers(ws);          // send peer list to the new connection
        broadcastPeers();       // notify other clients (VIEW card appears)
      }

      // Complete crypto handshake if client provided ephemeral key
      if (cryptoSession && msg.ephemeralKey) {
        cryptoSession.handshake(
          String(msg.ephemeralKey),
          msg.staticKey ? String(msg.staticKey) : undefined,
        );
      }
      return;
    }

    // Backward compat: legacy auth / direct (no hello handshake)
    if (msg.type === "auth" || msg.type === "direct") {
      const token = msg.token || "";
      if (relayToken && token !== relayToken) {
        send(ws, envelope("error", { code: "UNAUTHORIZED", message: "Invalid or missing token" }));
        setTimeout(() => ws.close(4001, "Unauthorized"), 100);
        return;
      }
      authenticatedSockets.add(ws);

      if (!process.env.BRIDGE_TEST_MODE) {
        const activeInst = inst();
        if (!activeInst.process && activeInst.adapterId && adapterRegistry.get(activeInst.adapterId)?.getCapabilities().structuredEvents) spawnInstance();
      }
      flushBuffer(ws);
      send(ws, { type: "auth_result", success: true, sessionId: inst().id, instances: instanceManager.toJSON() });
      send(ws, { type: "workspace_connected" });

      if (msg.type === "auth") return;
      // For "direct", fall through to the instance routing below
    }

    // ── Ping/Pong ─────────────────────────────────────────
    if (msg.type === "ping") {
      send(ws, envelope("pong"));
      return;
    }
    if (msg.type === "pong") {
      heartbeatMap.set(ws, true);
      if ((ws as any)._lastPingTime) {
        (ws as any)._latency = Date.now() - (ws as any)._lastPingTime;
        (ws as any)._lastPingTime = undefined;
      }
      return;
    }

    // ── Auth guard for all subsequent handlers ──
    if (relayToken && !authenticatedSockets.has(ws)) {
      send(ws, envelope("error", { code: "UNAUTHORIZED", message: "Authentication required — send hello first" }));
      setTimeout(() => ws.close(4001, "Unauthorized"), 100);
      return;
    }

    // ── Agent registration ────────────────────────────────
    if (msg.type === "agent.register" || msg.type === "agent_register") {
      const dir = msg.dir || process.cwd();
      const label = msg.label || `remote-${Date.now().toString(36)}`;
      const agentVersion = agentVersionMap.get(ws) || "unknown";
      // TODO: protocol should carry adapterId/capability — the agent must declare what type it is.
      const agentAdapterId = msg.adapterId || 'unknown';
      const remoteInst = instanceManager.create(dir, label, 'remote', agentAdapterId);
      applyAlias(remoteInst);
      remoteInst.agentConnection = ws;
      remoteInst.agentVersion = agentVersion;
      remoteInst.status = 'running';
      (ws as any)._isAgent = true;
      (ws as any)._agentInstanceId = remoteInst.id;
      (ws as any)._agentLabel = label;
      (ws as any)._agentRole = msg.role || 'leaf';
      (ws as any)._viaRelayId = msg.viaRelayId || undefined;
      (ws as any)._connectedAt = Date.now();
      clients.delete(ws);
      send(ws, envelope("agent.registered", { instanceId: remoteInst.id, sessionId: remoteInst.id }));
      const entry = instanceManager.toJSON().find(i => i.id === remoteInst.id);
      broadcast(envelope("instance.added", { instance: entry }));
      broadcastPeers(); // notify browsers about agent peer
      notifyBus({ scenarioId: 'agent.connected', severity: 'success', title: `Agent connected: ${label}` });
      auditLog.log('agent.registered', label, { version: agentVersion }, remoteInst.id);
      instanceManager.startOperation(remoteInst.id, 'spawn', 'agent_register');
      instanceManager.transitionOperation(remoteInst.id, instanceManager.getCurrentOperation(remoteInst.id)?.id || '', 'succeeded', { resultText: `Agent ${label} registered` });

      // Version mismatch notification — semver-aware, notify both browsers and agent
      const mismatch = mismatchSeverity(agentVersion, SERVER_VERSION);
      if (mismatch) {
        const severity = mismatch.diff === 'major' ? 'error' : 'warning';
        notifyBus({ scenarioId: 'update.available', severity, title: `Agent "${label}" version mismatch`, detail: mismatch.message });
        // Also notify the agent directly
        send(ws, envelope("system.notification", { type: severity, title: `Agent "${label}" version mismatch`, detail: mismatch.message, scenarioId: 'update.available' }));
      }
      return;
    }

    if (msg.type === "agent.unregister" || msg.type === "agent_unregister") {
      const agentInst = msg.instanceId ? instanceManager.get(msg.instanceId) : null;
      if (agentInst) {
        agentInst.agentConnection = null;
        agentInst.status = 'stopped';
        instanceManager.kill(agentInst.id);
        broadcast(envelope("instance.removed", { instanceId: agentInst.id }));
        notifyBus({ scenarioId: 'agent.disconnected', severity: 'warning', title: `Agent disconnected: ${agentInst.label}` });
        auditLog.log('agent.unregistered', agentInst.label, {}, agentInst.id);
      }
      return;
    }

    if (msg.type === "agent.stdout" || msg.type === "agent_stdout") {
      // Reassemble chunked messages
      const line = reassembleChunk(msg);
      if (line === null) return; // chunk incomplete, wait for more

      const remoteInst = instanceManager.get(msg.instanceId);
      if (!remoteInst) {
        send(ws, envelope("error", { code: "NOT_FOUND", message: `Instance ${msg.instanceId} not found`, replyTo: msg._raw?.id }));
        return;
      }
      remoteInst.status = 'running';

      // Strict adapter lookup — resolveAdapter() would fallback on 'unknown',
      // causing the wrong adapter to parse this instance's output.
      const instAdapter = remoteInst.adapterId ? adapterRegistry.get(remoteInst.adapterId) : undefined;
      if (!instAdapter) {
        // Unknown adapter: broadcast as raw output, no parseLine
        broadcast(envelope("shell.output", { data: line.slice(0, 65536), stream: "stdout" }));
        remoteInst.outputBuffer.push(line);
        remoteInst.outputSize += line.length;
        while (remoteInst.outputSize > 512 * 1024 && remoteInst.outputBuffer.length > 0) {
          remoteInst.outputSize -= remoteInst.outputBuffer.shift()?.length ?? 0;
        }
        return;
      }
      const caps = instAdapter.getCapabilities();
      if (!caps.structuredEvents) {
        // Raw shell output → terminal view (cap line size for broadcast)
        broadcast(envelope("shell.output", { data: line.slice(0, 65536), stream: "stdout" }));
        remoteInst.outputBuffer.push(line);
        remoteInst.outputSize += line.length;
        while (remoteInst.outputSize > 512 * 1024 && remoteInst.outputBuffer.length > 0) {
          remoteInst.outputSize -= remoteInst.outputBuffer.shift()?.length ?? 0;
        }
      } else {
        instAdapter.parseLine?.(line, remoteInst, parserDepsFor(remoteInst));
      }
      return;
    }

    if (msg.type === "agent.stderr" || msg.type === "agent_stderr") {
      // Reassemble chunked messages
      const data = reassembleChunk(msg);
      if (data === null) return; // chunk incomplete, wait for more

      const remoteInst = instanceManager.get(msg.instanceId);
      if (!remoteInst) {
        send(ws, envelope("error", { code: "NOT_FOUND", message: `Instance ${msg.instanceId} not found` }));
        return;
      }
      const stderrAdapter = remoteInst.adapterId ? adapterRegistry.get(remoteInst.adapterId) : undefined;
      const stderrCaps = stderrAdapter?.getCapabilities();
      if (stderrCaps && !stderrCaps.structuredEvents) {
        // Raw shell stderr → terminal view
        broadcast(envelope("shell.output", { data: data.slice(0, 65536), stream: "stderr" }));
      } else {
        broadcast(envelope("instance.output", { data: data.slice(0, 65536) }));
      }
      remoteInst.outputBuffer.push(data);
      remoteInst.outputSize += data.length;
      while (remoteInst.outputSize > 512 * 1024 && remoteInst.outputBuffer.length > 0) {
        remoteInst.outputSize -= remoteInst.outputBuffer.shift()?.length ?? 0;
      }
      return;
    }

    // ── Agent notification → forward to browsers ──────────
    if (msg.type === "agent.notification" || msg.type === "agent_notification") {
      const title = msg.title || 'Notification';
      const detail = msg.detail || '';
      notifyBus({ scenarioId: msg.scenarioId || 'agent.notification', severity: msg.severity || 'info', title, detail });
      return;
    }

    // ── Config push → relay config manager receives ack ────
    if (msg.type === "config.ack") {
      relayConfigManager.ack((ws as any)._agentInstanceId || '', msg.applied || []);
      auditLog.log('config.ack', (ws as any)._agentLabel || 'agent', { applied: msg.applied, rejected: msg.rejected });
      return;
    }

    // ── Agent spawns a sub-instance (bridge run) ─────────
    if (msg.type === "agent.instance.spawn") {
      const dir = msg.dir || process.cwd();
      const label = msg.label || 'Shell';
      // TODO: protocol should carry adapterId — agent.instance.spawn declares what type.
      const agentAdapterId = msg.adapterId || 'unknown';
      const remoteInst = instanceManager.create(dir, label, 'remote', agentAdapterId);
      applyAlias(remoteInst);
      remoteInst.agentConnection = ws;
      remoteInst.status = 'running';
      send(ws, envelope("agent.instance.spawned", {
        requestId: msg.requestId,
        instanceId: remoteInst.id,
      }));
      const entry = instanceManager.toJSON().find(i => i.id === remoteInst.id);
      broadcast(envelope("instance.added", { instance: entry }));
      auditLog.log('instance.spawned', label, { dir, requestId: msg.requestId }, remoteInst.id);
      return;
    }

    // ── Agent kills a sub-instance ───────────────────────
    if (msg.type === "agent.instance.exit") {
      const remoteInst = msg.instanceId ? instanceManager.get(msg.instanceId) : null;
      if (remoteInst && remoteInst.source === 'remote') {
        remoteInst.status = 'stopped';
        instanceManager.kill(remoteInst.id);
        broadcast(envelope("instance.removed", { instanceId: remoteInst.id }));
        auditLog.log('instance.exited', remoteInst.label, { exitCode: msg.exitCode }, remoteInst.id);
      }
      return;
    }

    // ── Config push ───────────────────────────────────────
    if (msg.type === "config.push" || msg.type === "config_push") {
      const entries = msg.entries || (msg.config ? Object.entries(msg.config).map(([k, v]) => ({ key: k, value: v })) : []);
      if (!Array.isArray(entries) || entries.length === 0) {
        send(ws, envelope("error", { code: "INVALID_CONFIG", message: "No entries in config.push" }));
        return;
      }
      relayConfigManager.setBatch(entries.map((e) => ({ key: e.key, value: e.value })), 'relay');
      const pending = relayConfigManager.getPending();
      for (const client of wss?.clients || []) {
        if ((client as any)._isAgent && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(envelope("config.push", { entries: pending.entries, requestId: pending.requestId })));
        }
      }
      auditLog.log('config.pushed', 'admin', { entries: pending.entries }, '');
      notifyBus({ scenarioId: 'config.synced', severity: 'info', title: 'Config pushed', detail: `${pending.entries.length} key(s) sent` });
      return;
    }

    // ── Node External Access ─────────────────────────────────
    if (msg.type === "node.external.inspect") {
      const targetId = msg.instanceId || '';
      const targetInst = targetId ? instanceManager.get(targetId) : null;

      if (targetInst?.source === 'remote' && targetInst.agentConnection) {
        // Forward to remote agent with request tracking
        const requestId = `ext_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        pendingExternalRequests.set(requestId, ws);
        setTimeout(() => pendingExternalRequests.delete(requestId), PENDING_TIMEOUT_MS);
        send(targetInst.agentConnection, envelope("node.external.inspect", { requestId }));
      } else {
        // Self-service: detect locally and respond directly
        const hasToken = !!relayToken;
        const result = detectNetwork(PORT, hasToken);
        send(ws, envelope("node.external.inspected", { result }));
      }
      return;
    }

    if (msg.type === "node.external.inspected" && msg.requestId) {
      // Route response from agent back to original requester
      const requester = pendingExternalRequests.get(msg.requestId);
      if (requester && requester.readyState === WebSocket.OPEN) {
        send(requester, envelope("node.external.inspected", { result: msg.result }));
      }
      pendingExternalRequests.delete(msg.requestId);
      return;
    }

    if (msg.type === "node.external.set") {
      // Toggle external access on/off on the target node
      const targetId = msg.instanceId || '';
      const enable = msg.enable === true;
      const targetInst = targetId ? instanceManager.get(targetId) : null;

      if (targetInst?.source === 'remote' && targetInst.agentConnection) {
        // Forward set command to remote agent
        const requestId = `ext_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        pendingExternalRequests.set(requestId, ws);
        setTimeout(() => pendingExternalRequests.delete(requestId), PENDING_TIMEOUT_MS);
        send(targetInst.agentConnection, envelope("node.external.set", { requestId, enable }));
      } else {
        // Self-service: just report that this requires runtime support
        send(ws, envelope("node.external.status", {
          enabled: false,
          url: '',
          message: 'self-service toggle not yet implemented',
        }));
      }
      return;
    }

    if (msg.type === "node.external.status" && msg.requestId) {
      const requester = pendingExternalRequests.get(msg.requestId);
      if (requester && requester.readyState === WebSocket.OPEN) {
        send(requester, envelope("node.external.status", { enabled: msg.enabled, url: msg.url || '', message: msg.message || '', error: msg.error || '' }));
      }
      pendingExternalRequests.delete(msg.requestId);
      return;
    }

    // ── Shell terminal ────────────────────────────────────
    if (msg.type === "shell.spawn" || msg.type === "shell_spawn") {
      spawnShellForWs(ws, msg.instanceId).then((shellInst) => {
        // Track shell in client session for reconnect recovery
        const clientToken = wsToClientToken.get(ws);
        if (clientToken) {
          const session = clientSessionMap.get(clientToken);
          if (session) session.shellIds.add(shellInst.id);
        }
      }).catch((err) => {
        send(ws, envelope("error", { code: "INTERNAL_ERROR", message: `Shell spawn failed: ${err}` }));
      });
      return;
    }
    if (msg.type === "shell.input" || msg.type === "shell_input") {
      const instId = msg.instanceId;
      const target = instId ? instanceManager.get(instId) : null;
      const i = target || (() => {
        const owned = shellWsMap.get(ws);
        if (owned && owned.size > 0) {
          const firstId = [...owned][0];
          return instanceManager.get(firstId);
        }
        return null;
      })();
      if (!i) return;

      // No shell lock — ptty handles interleaved input naturally.
      // shell.lock / shell.unlock are still available for clients that want
      // explicit coordination, but are not enforced on the input path.

      if (i.source === 'remote') {
        sendStdin(i, msg.data);
      } else if (i.handle) {
        i.handle.send(msg.data).catch(() => {});
      } else if (i.status !== 'stopped') {
        // No handle yet (PTY not spawned or race). Self-heal by spawning.
        // Guard: prevent concurrent spawnShellForWs calls for the same instance.
        const _buffered = msg.data;
        if (!pendingShellSpawns.has(i.id)) {
          pendingShellSpawns.set(
            i.id,
            spawnShellForWs(ws, i.id).finally(() => pendingShellSpawns.delete(i.id))
          );
        }
        pendingShellSpawns.get(i.id)!.then(() => {
          if (i.handle) i.handle.send(_buffered).catch(() => {});
        }).catch(() => {});
      }
      return;
    }
    if (msg.type === "shell.lock") {
      const instId = msg.instanceId || inst().id;
      const owner = shellLockMap.get(instId);
      if (owner && owner !== ws) {
        send(ws, envelope("shell.lock_status", { instanceId: instId, locked: true, owner: "another-browser" }));
      } else {
        shellLockMap.set(instId, ws);
        broadcast(envelope("shell.lock_status", { instanceId: instId, locked: true }));
      }
      return;
    }
    if (msg.type === "shell.unlock") {
      const instId = msg.instanceId || inst().id;
      if (shellLockMap.get(instId) === ws) {
        shellLockMap.delete(instId);
        broadcast(envelope("shell.lock_status", { instanceId: instId, locked: false }));
      }
      return;
    }
    if (msg.type === "shell.resize" || msg.type === "shell_resize") {
      // Resize PTY for the shell instance associated with this WS
      const cols = typeof msg.cols === 'number' ? Math.max(10, Math.round(msg.cols)) : undefined;
      const rows = typeof msg.rows === 'number' ? Math.max(2, Math.round(msg.rows)) : undefined;
      if (cols && rows) {
        const owned = shellWsMap.get(ws);
        if (owned && owned.size > 0) {
          const instId = [...owned][0];
          const inst = instanceManager.get(instId);
          if (inst?.handle?.resize) inst.handle.resize(cols, rows);
        }
      }
      return;
    }

    // ── Workbench tab sync ─────────────────────────────
    if (msg.type === "workbench.subscribe") {
      const nodeId = String(msg.nodeId || '');
      if (!nodeId) return;
      if (!workbenchSubscribers.has(nodeId)) workbenchSubscribers.set(nodeId, new Set());
      workbenchSubscribers.get(nodeId)!.add(ws);
      // Send current tab state immediately
      const tabs = workbenchTabStore.get(nodeId) || [];
      send(ws, envelope("workbench.tabs", { nodeId, tabs }));
      // Notify upstream relay so it also subscribes this node's agent WS
      _sendUpstream?.("workbench.subscribe", { nodeId });
      return;
    }

    if (msg.type === "workbench.unsubscribe") {
      const nodeId = String(msg.nodeId || '');
      if (!nodeId) return;
      const subs = workbenchSubscribers.get(nodeId);
      if (subs) {
        subs.delete(ws);
        if (subs.size === 0) {
          workbenchSubscribers.delete(nodeId);
          // Last local subscriber left — unsubscribe upstream
          _sendUpstream?.("workbench.unsubscribe", { nodeId });
        }
      }
      return;
    }

    if (msg.type === "workbench.tabs") {
      const nodeId = String(msg.nodeId || '');
      const tabs = Array.isArray(msg.tabs) ? msg.tabs : [];
      if (!nodeId) return;
      workbenchTabStore.set(nodeId, tabs);
      // Broadcast to all OTHER subscribers
      broadcastTabs(nodeId, tabs, ws);
      const nodeInst = instanceManager.get(nodeId);
      // Include label so the receiving relay can map to its own instance IDs.
      const label = nodeInst?.label;
      // Forward to remote agent's WebSocket if this node belongs to
      // an agent connection (VPS—leaf cross-relay sync direction).
      if (nodeInst?.source === 'remote' && nodeInst.agentConnection && nodeInst.agentConnection !== ws) {
        send(nodeInst.agentConnection, envelope("workbench.tabs", { nodeId, tabs, _label: label }));
      }
      // Forward to upstream relay for cross-relay sync
      _sendUpstream?.("workbench.tabs", { nodeId, tabs, _label: label });
      // Cross-relay label normalization: if the incoming message uses
      // a different instance ID than what local subscribers expect,
      // find instances with the same label and sync there.
      syncTabsByLabel(nodeId, tabs, msg._label, ws);
      return;
    }

    // ── Claude chat commands ────────────────────────────────
    const targetInst = msg.instanceId ? (instanceManager.get(msg.instanceId) || inst()) : inst();
    const prevActive = instanceManager.activeId;
    instanceManager.setActive(targetInst.id);

    switch (msg.type) {
      case "instance.command":
      case "command": {
        const name = msg.name;
        if (name === "clear" || name === "restart") {
          if (msg.args?.model) targetInst.model = msg.args.model;
          targetInst.checkpointManager.clear();
          spawnInstance(targetInst.id);
          sendBlock({
            blockType: "status",
            text: name === "restart" && msg.args?.model
              ? `Model switched to ${msg.args.model}`
              : "Session cleared — starting fresh...",
          });
          instanceManager.startOperation(targetInst.id, 'command', name);
          instanceManager.transitionOperation(targetInst.id, instanceManager.getCurrentOperation(targetInst.id)?.id || '', 'succeeded', { resultText: name });
        } else if (name === "interrupt") {
          interruptInstance(targetInst.id);
        } else if (name === "rewind") {
          const { success, checkpoint } = targetInst.checkpointManager.rewindLastCheckpoint();
          if (success) {
            sendBlock({ blockType: "status", text: `Rewound: ${checkpoint?.filePath ?? "unknown"}` });
          } else {
            sendBlock({ blockType: "status", text: "Nothing to rewind" });
          }
        } else if (name === "rewind-all") {
          const result = targetInst.checkpointManager.rewindCurrentTurn();
          sendBlock({ blockType: "status", text: `Rewound ${result.restored} change(s) (${result.skipped} skipped, ${result.failed} failed)` });
        } else if (name === "setMode") {
          const mode = msg.args?.mode;
          if (["default", "acceptEdits", "plan"].includes(mode)) {
            setPermissionMode(mode);
            sendBlock({ blockType: "status", text: `Permission mode: ${mode}` });
          }
        } else if (name === "setEffort") {
          const level = msg.args?.level;
          if (["low", "medium", "high"].includes(level)) {
            setThinkingLevel(level);
            sendBlock({ blockType: "status", text: `Thinking effort: ${level}` });
          }
        } else if (name === "switch-instance") {
          const target = msg.args?.instanceId;
          if (target && instanceManager.get(target)) {
            instanceManager.setActive(target);
            sendBlock({ blockType: "status", text: `Switched to instance: ${target}` });
            send(ws, envelope("instance.switched", { instanceId: target }));
          }
        } else if (name === "list-instances") {
          send(ws, envelope("instance.list", { instances: instanceManager.toJSON(), activeId: instanceManager.activeId }));
        } else if (name === "bridge-update") {
          // Trigger update in the background
          const { execFile } = require("child_process");
          execFile("node", [join(__dirname, "../scripts/update.js"), "--force"], {
            timeout: 120000, windowsHide: true,
          }, (updateErr: Error | null, stdout: string, stderr: string) => {
            if (updateErr) {
              sendBlock({ blockType: "error", text: `Update failed: ${updateErr.message}` });
            } else {
              sendBlock({ blockType: "status", text: `Update installed. Restart the server to apply.` });
              broadcast(envelope("system.notification", {
                severity: "success", title: "Update ready",
                detail: "Restart the server to apply the update.",
                scenarioId: "update", duration: 0,
              }));
            }
          });
        } else {
          // Extension-contributed commands
          const cmd = extensionPoints.findCommand(name);
          if (cmd) {
            const ctx: WhenContext = {
              view: targetInst?.adapterId || getDefaultAdapterId(),
              instanceStatus: targetInst?.status || 'stopped',
              activeAdapterId: targetInst?.adapterId || getDefaultAdapterId(),
              isRunning: targetInst?.status === 'running',
            };
            if (!cmd.when || evaluateWhen(cmd.when, ctx)) {
              if (targetInst?.handle?.sendCommand) {
                targetInst.handle.sendCommand(cmd.id, msg.args || {}).then(() => {
                  send(ws, envelope("instance.command_result", { name: cmd.id, ok: true }));
                }).catch((err: Error) => {
                  send(ws, envelope("instance.command_result", { name: cmd.id, ok: false, error: err.message }));
                });
              }
            }
          }
        }
        break;
      }

      case "session.list_req":
      case "list_sessions":
        // Sessions list — no-op (placeholder)
        break;
    }

    // Restore previous active instance if routing was temporary
    if (msg.instanceId && prevActive) {
      instanceManager.setActive(prevActive);
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    authenticatedSockets.delete(ws);
    agentVersionMap.delete(ws);
    cryptoStreams.delete(ws);
    broadcastPeers(); // notify remaining clients about peer change
    // Release shell write-locks held by this WS
    for (const [instId, owner] of shellLockMap) {
      if (owner === ws) {
        shellLockMap.delete(instId);
        broadcast(envelope("shell.lock_status", { instanceId: instId, locked: false }));
      }
    }
    // Session persistence: disconnect doesn't kill shells.
    // Processes stay alive until explicitly killed (× button on instance bar)
    // or the server/agent restarts. Close page = keep running, reopen = reconnect.
    const clientToken = wsToClientToken.get(ws);
    wsToClientToken.delete(ws);
    if (clientToken) {
      const session = clientSessionMap.get(clientToken);
      if (session && session.ws === ws) {
        session.disconnectTime = Date.now();
        // No auto-kill — shells persist until explicitly killed.
        return;
      }
    }
    // Clean up shell ownership tracking without killing processes
    const ownedShells = shellWsMap.get(ws);
    if (ownedShells) {
      shellWsMap.delete(ws);
    }
    // Auto-unregister agent connections
    if ((ws as any)._isAgent) {
      for (const inst of instanceManager.list()) {
        if (inst.agentConnection === ws) {
          inst.agentConnection = null;
          inst.status = 'stopped';
          instanceManager.kill(inst.id);
          broadcast(envelope("instance.removed", { instanceId: inst.id }));
          broadcastPeers(); // agent peer removed
          auditLog.log('agent.auto_unregistered', inst.label, {}, inst.id);
          instanceManager.cancelOperation(inst.id);
          break;
        }
      }
    }
    // Cleanup workbench subscribers
    cleanupWorkbenchSubs(ws);

    // Persist session state
    sessionPersistence.save(instanceManager);
  });
  });
}

// ─── Graceful Shutdown ───────────────────────────────────────────
function shutdown(signal: string) {
  console.log(`\n  [${signal}] Shutting down gracefully...`);

  // Notify clients
  broadcast(envelope("system.shutdown", { message: "Server is shutting down..." }));

  // Persist session before stopping
  sessionPersistence.flush(instanceManager);
  auditLog.log('server.shutdown', 'system', { signal, instanceCount: instanceManager.count });

  // Stop all adapter handles (shell + claude)
  for (const inst of instanceManager.list()) {
    if (inst.handle) { inst.handle.stop().catch(() => {}); }
    if (inst.process) {
      inst.process.kill();
      inst.process = null;
    }
  }
  instanceManager.stopAll();

  // Clear timers
  if (heartbeatTimer) clearInterval(heartbeatTimer);

  // Close all WebSocket connections
  if (wss) {
    for (const ws of wss.clients) {
      ws.close(1001, "Server shutting down");
    }
  }

  // Close HTTP server
  if (httpServer) {
    httpServer.close(() => {
      console.log(`  [${signal}] Server stopped.`);
      process.exit(0);
    });
  } else {
    process.exit(0);
  }

  // Force exit after 5s
  setTimeout(() => {
    console.error(`  [${signal}] Forced exit after timeout.`);
    process.exit(1);
  }, 5000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ─── Start ────────────────────────────────────────────────────────
export async function startRelayServer(port?: number): Promise<{ close: () => void; port: number }> {
  ensureServer();
  const p = port ?? PORT;

  // ── Initialize configuration system ────────────────────
  configStore.load();
  secretStore.load();
  configStore.setWorkspaceDir(process.cwd());

  // ── Register adapters via extension loader ──────────────
  // Must complete before server starts so the adapter registry is populated.
  try {
    const { scanAndActivate } = await import("../agent-core/extension-loader");
    const result = await scanAndActivate({ log: (msg: string) => console.log(`[ext] ${msg}`) });
    console.log(`  ✓ Extensions activated: ${result.activated.map(a => a.manifest.id).join(', ')}`);
    if (result.diagnostics.some(d => d.status === 'failed' || d.status === 'invalid')) {
      const bad = result.diagnostics.filter(d => d.status === 'failed' || d.status === 'invalid');
      for (const d of bad) console.warn(`  ⚠ Extension "${d.id}": ${d.message}`);
    }
  } catch (err) {
    console.warn(`  ⚠ Adapter loading failed: ${(err as Error).message}`);
  }

  // ── Background update check (non-blocking) ────────────
  setTimeout(() => {
    const { execFile } = require("child_process");
    execFile("node", [join(__dirname, "../scripts/check-update.js")], {
      timeout: 10000, windowsHide: true,
    }, (err: Error | null, stdout: string) => {
      if (err) return;
      try {
        const data = JSON.parse(stdout.trim());
        if (data.hasUpdate) {
          console.log(`\n  ⚠ Update available: v${data.current} → v${data.latest}`);
          console.log(`  ${data.updateUrl}`);
          console.log(`  Run "bridge update" to upgrade.\n`);
          // Notify connected browsers
          broadcast(envelope("update.available", {
            current: data.current,
            latest: data.latest,
            url: data.updateUrl,
          }));
        }
      } catch {}
    });
  }, 5000); // Check 5s after startup

  // ── Port validation (0 = random port, skip check) ──────
  if (p !== 0 && (p < 1 || p > 65535)) {
    console.error(`  ✗ Invalid port: ${p}. Using default 8080.`);
    process.exit(1);
  }

  return new Promise((resolve) => {
    httpServer!.listen(p, () => {
      const addr = httpServer!.address() as import("net").AddressInfo;
      const proto = sslKey && sslCert ? "https" : "http";
      console.log(`\n  ┌──────────────────────────────────────┐`);
      console.log(`  │  SessionBridge Relay Server         │`);
      console.log(`  │                                      │`);
      console.log(`  │  Server:    ${proto}://localhost:${String(addr.port).padEnd(5)}            │`);
      console.log(`  │  Web UI:    ${proto}://localhost:${String(addr.port).padEnd(5)} (static frontend) │`);
      console.log(`  │  Health:    ${proto}://localhost:${String(addr.port).padEnd(5)}/api/health  │`);
      console.log(`  │                                      │`);
      console.log(`  │  Instance spawns on first connection   │`);
      console.log(`  └──────────────────────────────────────┘\n`);
      resolve({
        close: () => {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          for (const inst of instanceManager.list()) {
            if (inst.handle) { inst.handle.stop().catch(() => {}); }
            if (inst.process) { inst.process.kill(); inst.process = null; }
          }
          instanceManager.stopAll();
          if (wss) { for (const ws of wss.clients) ws.close(1001, "Server shutting down"); }
          if (httpServer) httpServer.close();
        },
        port: addr.port,
      });
    });
  });
}

// ─── NodeRelayServer — class wrapper for NodeRuntime ═══════════
export class NodeRelayServer {
  private _port: number;
  private _token: string;
  private _bind?: string;

  constructor(port?: number, token?: string, bind?: string) {
    this._port = port ?? PORT;
    this._token = token || '';
    this._bind = bind;
  }

  /** Start the relay HTTP+WebSocket server. Returns the actual port. */
  async start(): Promise<number> {
    if (this._token) setRelayToken(this._token);
    ensureServer();
    // Validate port
    if (this._port !== 0 && (this._port < 1 || this._port > 65535)) {
      this._port = 8080;
    }
    // Register adapters via extension loader — await so the adapter registry
    // is populated before the server accepts connections. Without this,
    // shell.spawn (and other adapter-dependent operations) can race and fail.
    const extResult = await (async () => {
      try {
        const { scanAndActivate } = await import("../agent-core/extension-loader");
        return await scanAndActivate({ log: (msg: string) => console.log(`[ext] ${msg}`) });
      } catch (err) {
        console.warn(`  ⚠ Extension loading failed: ${(err as Error).message}`);
        return null;
      }
    })();
    if (extResult) {
      console.log(`  ✓ Extensions activated: ${extResult.activated.map(a => a.manifest.id).join(', ')}`);
      if (extResult.diagnostics.some(d => d.status === 'failed' || d.status === 'invalid')) {
        const bad = extResult.diagnostics.filter(d => d.status === 'failed' || d.status === 'invalid');
        for (const d of bad) console.warn(`  ⚠ Extension "${d.id}": ${d.message}`);
      }
    }
    // Restore sessions from previous run
    const snapshot = sessionPersistence.restore();
    if (snapshot) {
      for (const inst of snapshot.instances) {
        const restored = instanceManager.create(inst.dir, inst.label, inst.source, inst.adapterId);
        applyAlias(restored);
        restored.agentVersion = inst.agentVersion;
        restored.status = 'stopped'; // OS processes died with the relay; user must restart
        console.log(`[relay] Restored session: ${restored.id} (${inst.label})`);
        auditLog.log('session.restored', 'system', { originalId: inst.id }, restored.id);
      }
      if (snapshot.activeId) {
        const match = instanceManager.list().find(i => i.label === snapshot.instances.find(p => p.id === snapshot.activeId)?.label);
        if (match) instanceManager.setActive(match.id);
      }
    }
    // Start listening
    return new Promise((resolve, reject) => {
      httpServer!.listen(this._port, this._bind, () => {
        const addr = httpServer!.address() as import("net").AddressInfo;
        this._port = addr.port;
        console.log(`[relay] Listening on ${addr.port}`);
        if (!relayToken) {
          console.warn('');
          console.warn('  ⚠  SECURITY WARNING: Relay server running without a token.');
          console.warn('  ⚠  Anyone who can reach this port can control connected agents.');
          console.warn('  ⚠  Set a token: bridge setup --relay-token <token>');
          console.warn('');
        }
        resolve(addr.port);
      });
      httpServer!.once('error', reject);
    });
  }

  /** Shut down the relay server gracefully. */
  async stop(): Promise<void> {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    sessionPersistence.flush(instanceManager);
    auditLog.log('server.shutdown', 'system', { instanceCount: instanceManager.count });
    for (const inst of instanceManager.list()) {
      if (inst.handle) { inst.handle.stop().catch(() => {}); }
      if (inst.process) { inst.process.kill(); inst.process = null; }
    }
    instanceManager.stopAll();
    if (wss) { for (const ws of wss.clients) ws.close(1001, "Server shutting down"); }
    return new Promise((resolve) => {
      if (httpServer) { httpServer.close(() => resolve()); } else { resolve(); }
    });
  }
}

// Auto-start when run directly (not imported)
if (require.main === module || process.argv[1]?.endsWith("relay-server.js")) {
  startRelayServer();
}
