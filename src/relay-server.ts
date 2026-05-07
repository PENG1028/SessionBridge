import { createServer as createHttpServer } from "http";
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
import { envelope, parseMsg } from "../adapters/protocol";
import { adapterRegistry } from "../adapters/registry";
import { extensionPoints, evaluateWhen } from "../adapters/agent-core/extension-points";
import type { WhenContext, StreamParserDeps } from "../adapters/types";
import { RelayEventBus } from "../adapters/agent-core/event-bus";
import { AuditLogger } from "./audit-log";
import { appConfig } from "./config";
import { ensureCert } from "./cert";
import { SessionPersistence } from "./session-persistence";
import { registerApiRoutes } from "./api-routes";
import { RelayConfigManager } from "../adapters/agent-core/config-sync";
import { PermissionModel } from "../adapters/agent-core/permissions";
import { CryptoStream } from "./crypto-stream";
import { tryDecrypt } from "./crypto-layer";
import { loadOrCreateIdentity } from "./identity-manager";

// ─── Adapter path helper — avoids repeating adapterRegistry.get('claude-code') ──
function claudePaths() {
  return adapterRegistry.get('claude-code')?.getSessionPaths?.();
}

// ─── Start Time ────────────────────────────────────────────────────
const START_TIME = Date.now();

import { VERSION as SERVER_VERSION } from "../adapters/version";
import { mismatchSeverity } from "../adapters/semver";

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

// ─── Core Services ────────────────────────────────────────────────
const eventBus = new RelayEventBus();
const instanceManager = new InstanceManager(eventBus);
const auditLog = new AuditLogger(process.cwd());
const sessionPersistence = new SessionPersistence(process.cwd(), eventBus);
const permissions = new PermissionModel();
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

const defaultInstance = instanceManager.create(process.cwd(), "shell");
defaultInstance.status = "running";
defaultInstance.adapterId = "shell";  // default = terminal, Claude is a plugin
instanceManager.setActive(defaultInstance.id);

/** Get the currently active instance */
function inst(): import("./instance-manager").InstanceData {
  return instanceManager.getActive() || defaultInstance;
}

/** Check an HTTP request against the permission model. Returns true if allowed. */
function checkHttpPermission(
  res: import("http").ServerResponse,
  category: import("../adapters/types").PermissionCategory,
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

  const adapter = adapterRegistry.get(i.adapterId || 'shell') || adapterRegistry.get('shell')!;
  const adapterName = adapter.displayName;

  broadcast(envelope("instance.block", { blockType: "status", text: `Spawning ${adapterName} instance...` }));

  // Delegate to adapter.start() — adapter owns process lifecycle
  i.handle = await adapter.start({
    workspaceId: i.id,
    directory: i.dir,
    label: i.label,
    adapterId: i.adapterId || 'shell',
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
      if (adapter.id === 'shell') {
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
  if (instanceId) {
    const existing = instanceManager.get(instanceId);
    i = existing || instanceManager.create(process.cwd(), "shell", "local", "shell");
  } else {
    i = instanceManager.create(process.cwd(), "shell", "local", "shell");
  }

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
  const adapter = adapterRegistry.get("shell")!;
  i.handle = await adapter.start({
    workspaceId: i.id,
    directory: i.dir,
    label: i.label || "Shell",
    adapterId: "shell",
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

  const cap = adapterRegistry.get(i.adapterId || 'shell')?.getCapabilities();
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
const OUT_DIR = join(__dirname, "../out");
let ROOT_DIR = inst().dir;

const serverRequestHandler = (req: import("http").IncomingMessage, res: import("http").ServerResponse) => {
  // Delegate to structured API routes first
  if (registerApiRoutes(req, res, { instanceManager, broadcast, auditLog, checkPermission: checkHttpPermission, configManager: appConfig, relayConfig: relayConfigManager })) return;

  const url = new URL(req.url!, `http://${req.headers.host}`);
  const path = url.pathname;
  const clientIp = req.socket.remoteAddress || "unknown";

  // API-level rate limiting (skip for static and health)
  const isApiRoute = path.startsWith("/api/") && path !== "/api/health" && path !== "/api/info";
  if (isApiRoute && req.method === "POST" && !checkRateLimit(clientIp)) {
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Too many requests. Please slow down." }));
    return;
  }

  // ── API: List directory ──────────────────────────────────
  if (path === "/api/list" && req.method === "GET") {
    if (!checkHttpPermission(res, 'fileRead', { path: url.searchParams.get("dir") || "." })) return;
    const dirParam = url.searchParams.get("dir") || ".";
    const targetDir = isAbsolute(dirParam) ? dirParam : resolve(ROOT_DIR, dirParam);
    const root = ROOT_DIR;

    if (!targetDir.startsWith(ROOT_DIR)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Outside workspace" }));
      return;
    }
    if (!existsSync(targetDir)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Directory not found" }));
      return;
    }

    try {
      const entries = readdirSync(targetDir, { withFileTypes: true });
      const items = entries
        .filter(e => !e.name.startsWith(".") && !e.name.startsWith("node_modules"))
        .map(e => {
          const full = join(targetDir, e.name);
          const rel = relative(root, full).replace(/\\/g, "/");
          return {
            name: e.name,
            path: rel,
            type: e.isDirectory() ? "dir" : "file",
            size: e.isFile() ? statSync(full).size : 0,
          };
        })
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ items, cwd: ROOT_DIR }));
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
    try {
      const result = execSync(`node "${join(__dirname, "../scripts/check-update.js")}"`, {
        encoding: "utf-8", timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'],
      });
      const data = JSON.parse(result.trim());
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ current: SERVER_VERSION, latest: SERVER_VERSION, hasUpdate: false, error: "check failed" }));
    }
    return;
  }

  // ── API: Trigger update ─────────────────────────────────
  if (path === "/api/do-update" && req.method === "POST") {
    const { execSync } = require("child_process");
    try {
      execSync(`node "${join(__dirname, "../scripts/update.js")}" --force`, {
        encoding: "utf-8", timeout: 120000, stdio: 'pipe',
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, message: "Update installed. Restart to apply." }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: String(err) }));
    }
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

  // ── Read compaction count from a session file ────────────
  const compactionCountCache = new Map<string, number>();
  function getCompactionCount(claudeDir: string, project: string, sessionId: string): number {
    const cacheKey = sessionId;
    if (compactionCountCache.has(cacheKey)) return compactionCountCache.get(cacheKey)!;
    try {
      const slug = project.replace(/[\\\/: ]/g, "-");
      const f = claudePaths()!.sessionPath(slug, sessionId);
      if (!existsSync(f)) { compactionCountCache.set(cacheKey, 0); return 0; }
      const c = readFileSync(f, "utf8");
      const count = (c.match(/"isCompactSummary":true/g) || []).length;
      compactionCountCache.set(cacheKey, count);
      return count;
    } catch { compactionCountCache.set(cacheKey, 0); return 0; }
  }

  // ── Group consecutive assistant entries ──────────────────
  // Claude Code splits a single assistant turn across multiple JSONL entries
  // (one per content block: thinking, tool_use, text). Merge them back.
  function groupConsecutiveAssistantEntries(messages: any[]): any[] {
    const grouped: any[] = [];
    for (const msg of messages) {
      const last = grouped[grouped.length - 1];
      if (last && last.role === 'assistant' && msg.role === 'assistant') {
        last.blocks.push(...msg.blocks);
        if (msg.text) last.text = (last.text + ' ' + msg.text).trim().slice(0, 5000);
        if (msg.timestamp) last.timestamp = msg.timestamp;
        if (msg.isCompactSummary) last.isCompactSummary = true;
      } else {
        grouped.push({ ...msg, blocks: [...msg.blocks] });
      }
    }
    return grouped;
  }

  // ── API: Search Sessions (Claude Code history) ──────────
  if (path === "/api/sessions/search" && req.method === "GET") {
    const query = (url.searchParams.get("q") || "").toLowerCase().trim();
    const claudeDir = claudePaths()!.dataDir;
    const historyFile = claudePaths()!.historyPath;
    const results: any[] = [];

    try {
      if (existsSync(historyFile)) {
        const content = readFileSync(historyFile, "utf8");
        const lines = content.split("\n").filter(Boolean).map(l => {
          try { return JSON.parse(l); } catch { return null; }
        }).filter(Boolean);

        for (const entry of lines) {
          const display = entry.display || "";
          const project = entry.project || "";
          const sessionId = entry.sessionId || "";
          const ts = entry.timestamp || 0;

          const inDisplay = query ? display.toLowerCase().includes(query) : false;
          const inProject = query ? project.toLowerCase().includes(query) : false;

          if (query && !inDisplay && !inProject) {
            const projectSlug = project.replace(/[\\\/: ]/g, "-");
            const sessionFile = claudePaths()!.sessionPath(projectSlug, sessionId);
            try {
              const st = statSync(sessionFile);
              if (st.size > 0 && st.size <= 100 * 1024) {  // skip large files to avoid OOM
                const sessionContent = readFileSync(sessionFile, "utf8");
                if (sessionContent.toLowerCase().includes(query)) {
                  const idx = sessionContent.toLowerCase().indexOf(query);
                  const start = Math.max(0, idx - 60);
                  const end = Math.min(sessionContent.length, idx + query.length + 120);
                  results.push({
                    sessionId,
                    display: display.slice(0, 200),
                    project,
                    timestamp: ts,
                    matchedIn: "content",
                    snippet: sessionContent.slice(start, end).replace(/\n/g, " ").trim(),
                    compactionCount: (sessionContent.match(/"isCompactSummary":true/g) || []).length,
                  });
                  continue;
                }
              }
            } catch {}
          }

          if (!query || inDisplay || inProject) {
            results.push({
              sessionId,
              display: display.slice(0, 300),
              project,
              timestamp: ts,
              matchedIn: query ? (inDisplay ? "display" : "project") : "",
              snippet: "",
            });
          }
        }
      }

      results.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      // Deduplicate by sessionId (keep most recent entry per session)
      const seen = new Set<string>();
      const deduped = results.filter(r => {
        if (seen.has(r.sessionId)) return false;
        seen.add(r.sessionId);
        return true;
      });
      const limited = deduped.slice(0, 50);
      // Compute compaction count for all limited results
      for (const r of limited) {
        r.compactionCount = getCompactionCount(claudeDir, r.project, r.sessionId);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ results: limited }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── API: Session detail (full conversation) ─────────────
  if (path === "/api/sessions/detail" && req.method === "GET") {
    const sessionId = url.searchParams.get("id") || "";
    const project = url.searchParams.get("project") || "";
    const claudeDir = claudePaths()!.dataDir;

    if (!sessionId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing sessionId" }));
      return;
    }

    try {
      let sessionContent = "";
      if (project) {
        const projectSlug = project.replace(/[\\\/: ]/g, "-");
        const sessionFile = claudePaths()!.sessionPath(projectSlug, sessionId);
        if (existsSync(sessionFile)) {
          sessionContent = readFileSync(sessionFile, "utf8");
        }
      }

      if (!sessionContent) {
        const projectsDir = claudePaths()!.projectsDir;
        if (existsSync(projectsDir)) {
          const projectDirs = readdirSync(projectsDir);
          for (const pdir of projectDirs) {
            const candidateFile = claudePaths()!.sessionPath(pdir, sessionId);
            if (existsSync(candidateFile)) {
              sessionContent = readFileSync(candidateFile, "utf8");
              break;
            }
          }
        }
      }

      const messages: any[] = [];
      if (sessionContent) {
        const lines = sessionContent.split("\n").filter(Boolean);

        // Pre-scan: queue-operation enqueue content → used to detect system-generated user messages
        const systemContents = new Set<string>();
        for (const line of lines) {
          try {
            const p = JSON.parse(line);
            if (p.type === "queue-operation" && p.operation === "enqueue" && typeof p.content === "string") {
              systemContents.add(p.content.slice(0, 200));
            }
          } catch {}
        }

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            const entryType = parsed.type || "";
            if (entryType === "queue-operation") continue;

            const message = parsed.message || {};
            const role = message.role || "";
            const contentArr = Array.isArray(message.content) ? message.content : [];
            const textContent = typeof message.content === 'string' ? message.content : '';

            if (!role) continue;
            if (contentArr.length === 0 && !textContent) continue;

            const blocks: any[] = [];
            let combinedText = "";

            for (const c of contentArr) {
              switch (c.type) {
                case "text":
                  blocks.push({ type: "text", text: c.text || "" });
                  combinedText += (c.text || "") + " ";
                  break;
                case "thinking":
                  blocks.push({ type: "thinking", text: c.thinking || "" });
                  break;
                case "tool_use":
                  blocks.push({
                    type: "tool_use",
                    name: c.name || "",
                    input: JSON.stringify(c.input || {}),
                  });
                  combinedText += `[${c.name}] `;
                  break;
                case "plan":
                  blocks.push({ type: "plan", text: c.plan || c.text || "" });
                  combinedText += "[Plan] ";
                  break;
                case "tool_result": {
                  const resultText = typeof c.content === "string" ? c.content
                    : Array.isArray(c.content) ? c.content.map((x: any) => x.text || x.content || "").join("\n")
                    : JSON.stringify(c.content || "");
                  blocks.push({ type: "tool_result", text: resultText.slice(0, 2000) });
                  break;
                }
              }
            }

            if (contentArr.length === 0 && textContent) {
              blocks.push({ type: "text", text: textContent });
              combinedText = textContent;
            }

            const isSystem = role === "user" && textContent && systemContents.has(textContent.slice(0, 200));

            messages.push({
              role,
              blocks,
              text: combinedText.trim().slice(0, 5000),
              timestamp: parsed.timestamp || 0,
              isCompactSummary: parsed.isCompactSummary === true || message.isCompactSummary === true,
              isSystem,
            });
          } catch {}
        }
      }

      const groupedMessages = groupConsecutiveAssistantEntries(messages);
      const mergedMessages: any[] = [];
      for (const msg of groupedMessages) {
        if (msg.role === "user" && msg.blocks.length > 0 && msg.blocks.every((b: any) => b.type === "tool_result")) {
          if (mergedMessages.length > 0) {
            const prev = mergedMessages[mergedMessages.length - 1];
            // Distribute tool_results in order to unmatched tool_use blocks
            let ti = 0;
            for (const block of msg.blocks) {
              if (block.type === "tool_result") {
                let found = false;
                for (let i = ti; i < prev.blocks.length; i++) {
                  if (prev.blocks[i].type === "tool_use" && !prev.blocks[i].output) {
                    prev.blocks[i].output = block.text.slice(0, 3000);
                    ti = i + 1;
                    found = true;
                    break;
                  }
                }
                if (!found) {
                  for (let i = prev.blocks.length - 1; i >= 0; i--) {
                    if (prev.blocks[i].type === "tool_use") {
                      prev.blocks[i].output = (prev.blocks[i].output || '') + '\n' + block.text.slice(0, 3000);
                      break;
                    }
                  }
                }
              }
            }
          }
        } else {
          mergedMessages.push({ role: msg.role, blocks: msg.blocks, text: msg.text, timestamp: msg.timestamp, isCompactSummary: msg.isCompactSummary, isSystem: msg.isSystem });
        }
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessionId, messages: mergedMessages, content: sessionContent.slice(0, 50000) }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── API: Current session detail ──────────────────────────
  if (path === "/api/sessions/current") {
    try {
      const claudeDir = claudePaths()!.dataDir;
      const projectSlug = ROOT_DIR.replace(/[^a-zA-Z0-9-]/g, "-");
      const projectsDir = join(claudePaths()!.projectsDir, projectSlug);
      let latestFile = "";
      let latestTime = 0;

      if (existsSync(projectsDir)) {
        const files = readdirSync(projectsDir).filter(f => f.endsWith(".jsonl"));
        for (const f of files) {
          const fp = join(projectsDir, f);
          const mtime = statSync(fp).mtimeMs;
          if (mtime > latestTime) { latestTime = mtime; latestFile = fp; }
        }
      }

      if (!latestFile) {
        const debugInfo = { ROOT_DIR, projectSlug, projectsDir, claudeDir: claudePaths()!.dataDir, dirExists: existsSync(projectsDir) };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ sessionId: "", messages: [], found: false, debug: debugInfo }));
        return;
      }

      const sessionId = basename(latestFile, ".jsonl");
      const sessionContent = readFileSync(latestFile, "utf8");

      const lines = sessionContent.split("\n").filter(Boolean);

      // Pre-scan: queue-operation enqueue content → used to detect system-generated user messages
      const systemContents = new Set<string>();
      for (const line of lines) {
        try {
          const p = JSON.parse(line);
          if (p.type === "queue-operation" && p.operation === "enqueue" && typeof p.content === "string") {
            systemContents.add(p.content.slice(0, 200));
          }
        } catch {}
      }

      const messages: any[] = [];
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          const entryType = parsed.type || "";
          if (entryType === "queue-operation") continue;

          const message = parsed.message || {};
          const role = message.role || "";
          const contentArr = Array.isArray(message.content) ? message.content : [];
          const textContent = typeof message.content === 'string' ? message.content : '';
          if (!role) continue;
          if (contentArr.length === 0 && !textContent) continue;

          const blocks: any[] = [];
          let combinedText = "";

          for (const c of contentArr) {
            switch (c.type) {
              case "text":
                blocks.push({ type: "text", text: c.text || "" });
                combinedText += (c.text || "") + " ";
                break;
              case "thinking":
                blocks.push({ type: "thinking", text: c.thinking || "" });
                break;
              case "tool_use":
                blocks.push({ type: "tool_use", name: c.name || "", input: JSON.stringify(c.input || {}) });
                combinedText += `[${c.name}] `;
                break;
              case "plan":
                blocks.push({ type: "plan", text: c.plan || c.text || "" });
                combinedText += "[Plan] ";
                break;
              case "tool_result": {
                const resultText = typeof c.content === "string" ? c.content
                  : Array.isArray(c.content) ? c.content.map((x: any) => x.text || x.content || "").join("\n")
                  : JSON.stringify(c.content || "");
                blocks.push({ type: "tool_result", text: resultText.slice(0, 2000) });
                break;
              }
            }
          }

          if (contentArr.length === 0 && textContent) {
            blocks.push({ type: "text", text: textContent });
            combinedText = textContent;
          }

          const isSystem = role === "user" && textContent && systemContents.has(textContent.slice(0, 200));

          messages.push({
            role, blocks,
            text: combinedText.trim().slice(0, 5000),
            timestamp: parsed.timestamp || 0,
            isCompactSummary: parsed.isCompactSummary === true || message.isCompactSummary === true,
            isSystem,
          });
        } catch {}
      }

      const groupedMessages = groupConsecutiveAssistantEntries(messages);
      const mergedMessages: any[] = [];
      for (const msg of groupedMessages) {
        if (msg.role === "user" && msg.blocks.length > 0 && msg.blocks.every((b: any) => b.type === "tool_result")) {
          if (mergedMessages.length > 0) {
            const prev = mergedMessages[mergedMessages.length - 1];
            // Distribute tool_results in order to unmatched tool_use blocks
            let ti = 0;
            for (const block of msg.blocks) {
              if (block.type === "tool_result") {
                let found = false;
                for (let i = ti; i < prev.blocks.length; i++) {
                  if (prev.blocks[i].type === "tool_use" && !prev.blocks[i].output) {
                    prev.blocks[i].output = block.text.slice(0, 3000);
                    ti = i + 1;
                    found = true;
                    break;
                  }
                }
                if (!found) {
                  for (let i = prev.blocks.length - 1; i >= 0; i--) {
                    if (prev.blocks[i].type === "tool_use") {
                      prev.blocks[i].output = (prev.blocks[i].output || '') + '\n' + block.text.slice(0, 3000);
                      break;
                    }
                  }
                }
              }
            }
          }
        } else {
          mergedMessages.push({ role: msg.role, blocks: msg.blocks, text: msg.text, timestamp: msg.timestamp, isCompactSummary: msg.isCompactSummary, isSystem: msg.isSystem });
        }
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessionId, messages: mergedMessages, found: true }));
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
        instanceManager.setActive(newInst.id);
        ROOT_DIR = targetDir;
        spawnInstance(newInst.id);
        broadcast(envelope("instance.added", { instance: { id: newInst.id, dir: newInst.dir, label: newInst.label, status: newInst.status } }));
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
        spawnInstance(newInst.id);
        broadcast(envelope("instance.added", { instance: { id: newInst.id, dir: newInst.dir, label: newInst.label, status: newInst.status } }));
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

  // ── Static files ─────────────────────────────────────────
  let filePath = path;
  if (filePath.endsWith("/")) filePath += "index.html";
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
      return;
    }
    heartbeatMap.set(ws, false);
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
        if (!activeInst.process && activeInst.adapterId !== 'shell') spawnInstance();
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
        if (!activeInst.process && activeInst.adapterId !== 'shell') spawnInstance();
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
      const remoteInst = instanceManager.create(dir, label, 'remote', 'shell');
      remoteInst.agentConnection = ws;
      remoteInst.agentVersion = agentVersion;
      remoteInst.status = 'running';
      (ws as any)._isAgent = true;
      (ws as any)._agentInstanceId = remoteInst.id;
      (ws as any)._agentLabel = label;
      clients.delete(ws);
      send(ws, envelope("agent.registered", { instanceId: remoteInst.id, sessionId: remoteInst.id }));
      const entry = instanceManager.toJSON().find(i => i.id === remoteInst.id);
      broadcast(envelope("instance.added", { instance: entry }));
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
      if (remoteInst.adapterId === 'shell') {
        // Raw shell output → terminal view (cap line size for broadcast)
        broadcast(envelope("shell.output", { data: line.slice(0, 65536), stream: "stdout" }));
        remoteInst.outputBuffer.push(line);
        remoteInst.outputSize += line.length;
        while (remoteInst.outputSize > 512 * 1024 && remoteInst.outputBuffer.length > 0) {
          remoteInst.outputSize -= remoteInst.outputBuffer.shift()?.length ?? 0;
        }
      } else {
        adapterRegistry.get(remoteInst.adapterId || 'claude-code')?.parseLine?.(line, remoteInst, parserDepsFor(remoteInst));
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
      if (remoteInst.adapterId === 'shell') {
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
      const remoteInst = instanceManager.create(dir, label, 'remote', 'shell');
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

      // Shell write-lock: only the lock owner can send input
      const lockOwner = shellLockMap.get(i.id);
      if (lockOwner && lockOwner !== ws) {
        send(ws, envelope("shell.lock_status", { instanceId: i.id, locked: true, owner: "another-browser" }));
        return;
      }
      // Auto-acquire lock on first input
      if (!lockOwner) {
        shellLockMap.set(i.id, ws);
        broadcast(envelope("shell.lock_status", { instanceId: i.id, locked: true, owner: "browser" }));
      }

      if (i.source === 'remote') {
        sendStdin(i, msg.data);
      } else if (i.handle) {
        i.handle.send(msg.data).catch(() => {});
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
      // PTY resize would go here when using node-pty
      return;
    }

    // ── Claude chat commands ────────────────────────────────
    const targetInst = msg.instanceId ? (instanceManager.get(msg.instanceId) || inst()) : inst();
    const prevActive = instanceManager.activeId;
    instanceManager.setActive(targetInst.id);

    switch (msg.type) {
      case "direct":
      case "auth":
        // Already handled above — no-op (except "direct" falls through)
        break;

      case "instance.input":
      case "input": {
        sendBlock({ blockType: "user", text: msg.data });
        enqueueInput(msg.data, "web");
        instanceManager.startOperation(targetInst.id, 'chat', msg.data?.slice(0, 200));
        auditLog.log('instance.input', 'web', { text: msg.data?.slice(0, 200) }, targetInst.id);
        break;
      }

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
              view: targetInst?.adapterId || 'shell',
              instanceStatus: targetInst?.status || 'stopped',
              activeAdapterId: targetInst?.adapterId || 'shell',
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
    // Release shell write-locks held by this WS
    for (const [instId, owner] of shellLockMap) {
      if (owner === ws) {
        shellLockMap.delete(instId);
        broadcast(envelope("shell.lock_status", { instanceId: instId, locked: false }));
      }
    }
    // Session persistence: mark session as disconnected, don't kill shells immediately
    const clientToken = wsToClientToken.get(ws);
    wsToClientToken.delete(ws);
    if (clientToken) {
      const session = clientSessionMap.get(clientToken);
      if (session && session.ws === ws) {
        session.disconnectTime = Date.now();
        // Schedule cleanup after grace period
        setTimeout(() => {
          const s = clientSessionMap.get(clientToken);
          if (s?.disconnectTime && Date.now() - s.disconnectTime >= SESSION_RECONNECT_GRACE_MS) {
            for (const shellId of s.shellIds) {
              killInstance(shellId);
              instanceManager.kill(shellId);
            }
            clientSessionMap.delete(clientToken);
          }
        }, SESSION_RECONNECT_GRACE_MS);
        return; // Don't kill shells — keep them for reconnection
      }
    }
    // Kill all shell instances owned by this WS (no session token)
    const ownedShells = shellWsMap.get(ws);
    if (ownedShells) {
      for (const instId of ownedShells) {
        killInstance(instId);
        instanceManager.kill(instId);
        broadcast(envelope("instance.removed", { instanceId: instId }));
      }
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
          auditLog.log('agent.auto_unregistered', inst.label, {}, inst.id);
          instanceManager.cancelOperation(inst.id);
          break;
        }
      }
    }
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
export function startRelayServer(port?: number): Promise<{ close: () => void; port: number }> {
  ensureServer();
  const p = port ?? PORT;

  // ── Adapter environment validation ──────────────────────
  // (delegated to extension loader below — adapters self-report availability)

  // ── Register adapters via extension loader ──────────────
  (async () => {
    try {
      const { scanAndActivate } = await import("../adapters/agent-core/extension-loader");
      const activated = await scanAndActivate({ log: (msg: string) => console.log(`[ext] ${msg}`) });
      console.log(`  ✓ Adapters registered: ${activated.map(a => a.manifest.id).join(', ')}`);
    } catch (err) {
      console.warn(`  ⚠ Adapter loading failed: ${(err as Error).message}`);
    }
  })();

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

  constructor(port?: number, token?: string) {
    this._port = port ?? PORT;
    this._token = token || '';
  }

  /** Start the relay HTTP+WebSocket server. Returns the actual port. */
  async start(): Promise<number> {
    if (this._token) setRelayToken(this._token);
    ensureServer();
    // Validate port
    if (this._port !== 0 && (this._port < 1 || this._port > 65535)) {
      this._port = 8080;
    }
    // Register adapters via extension loader
    (async () => {
      const { scanAndActivate } = await import("../adapters/agent-core/extension-loader");
      await scanAndActivate({ log: (msg: string) => console.log(`[ext] ${msg}`) });
    })();
    // Restore sessions from previous run
    const snapshot = sessionPersistence.restore();
    if (snapshot) {
      for (const inst of snapshot.instances) {
        const restored = instanceManager.create(inst.dir, inst.label, inst.source, inst.adapterId);
        restored.agentVersion = inst.agentVersion;
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
      httpServer!.listen(this._port, () => {
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
