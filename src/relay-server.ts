import { createServer } from "http";
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, unlinkSync } from "fs";
import { join, extname, basename, resolve, isAbsolute, relative } from "path";
import { WebSocketServer, WebSocket } from "ws";
import { spawn, execSync } from "child_process";
import { createInterface } from "readline";
import { memoryUsage } from "process";
import os from "os";

import { checkRateLimit } from "./rate-limiter";
import { CheckpointManager } from "./checkpoint-manager";
import { InstanceManager } from "./instance-manager";

// ─── Start Time ────────────────────────────────────────────────────
const START_TIME = Date.now();

// ─── Config ──────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "8080", 10);

// ─── Instance Manager ─────────────────────────────────────────────
const instanceManager = new InstanceManager();
const defaultInstance = instanceManager.create(process.cwd(), "default");
defaultInstance.status = "running";
instanceManager.setActive(defaultInstance.id);

/** Get the currently active instance */
function inst(): import("./instance-manager").InstanceData {
  return instanceManager.getActive() || defaultInstance;
}

// ─── MIME ────────────────────────────────────────────────────────
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
};

// ─── Claude binary resolution (Windows .cmd support) ──────────────
function resolveClaude(): { cmd: string; args: string[] } {
  if (process.platform === "win32") {
    try {
      const out = execSync("where claude", { encoding: "utf8", timeout: 5000 });
      const cmdPath = out.split("\n")[0].trim();
      if (cmdPath) return { cmd: "cmd.exe", args: ["/c", cmdPath] };
    } catch { /* fall through */ }
    return { cmd: "cmd.exe", args: ["/c", "claude"] };
  }
  return { cmd: "claude", args: [] };
}

// ─── Instance-based shorthand accessors ───────────────────────

let blockSeq = 0;
const nextId = () => `blk_${++blockSeq}`;

const MAX_BLOCKS = 500;

function bufferBlock(block: Record<string, unknown>) {
  const i = inst();
  i.blockBuffer.push(block);
  if (i.blockBuffer.length > MAX_BLOCKS) i.blockBuffer.shift();
}

function bufferOutput(data: string) {
  const i = inst();
  i.outputBuffer.push(data);
  i.outputSize += data.length;
  while (i.outputSize > 512 * 1024 && i.outputBuffer.length > 0) {
    i.outputSize -= i.outputBuffer.shift()?.length ?? 0;
  }
}

function flushBuffer(ws: WebSocket) {
  const i = inst();
  for (const block of i.blockBuffer) send(ws, block);
  for (const data of i.outputBuffer) send(ws, { type: "output", data });
}

// ─── WS Clients ──────────────────────────────────────────────────
const clients = new Set<WebSocket>();

function send(ws: WebSocket, msg: unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg: unknown) {
  for (const ws of clients) send(ws, msg);
}

function sendBlock(block: Record<string, unknown>) {
  const msg = { type: "block", ...block, ts: Date.now() };
  broadcast(msg);
  if (block.blockType !== 'user') {
    bufferBlock(msg);
  }
}

function flushText() {
  const i = inst();
  if (i.textBuffer) {
    sendBlock({ blockType: "text", text: i.textBuffer });
    i.textBuffer = "";
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

// ─── Spawn / Kill Claude ──────────────────────────────────────────
function spawnClaude(instanceId?: string) {
  const i = instanceId ? (instanceManager.get(instanceId) || inst()) : inst();
  const prevId = instanceManager.activeId;
  instanceManager.setActive(i.id);

  // Kill existing process for this instance
  if (i.process) {
    i.process.kill();
    i.process = null;
  }

  // Clear stale blocks
  i.blockBuffer.length = 0;
  i.outputBuffer.length = 0;
  i.outputSize = 0;

  broadcast({ type: "block", blockType: "status", text: "Spawning Claude process...", ts: Date.now() });

  const { cmd, args: prefix } = resolveClaude();
  const allArgs = [
    ...prefix,
    "--output-format", "stream-json",
    "--input-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--dangerously-skip-permissions",
  ];
  if (i.model) allArgs.push("--model", i.model);

  i.process = spawn(cmd, allArgs, { stdio: ["pipe", "pipe", "pipe"] });
  i.status = 'starting';

  // ── stdout: readline-based JSON event parsing ────────────
  const rl = createInterface({ input: i.process.stdout! });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let ev: any;
    try { ev = JSON.parse(line); } catch { return; }

    // Ensure we're operating on the right instance
    const ii = instanceManager.get(i.id) || i;
    ii.status = 'running';

    switch (ev.type) {
      case "system": {
        if (ev.subtype === "init") {
          sendBlock({ blockType: "status", text: `Model: ${ev.model} | v${ev.claude_code_version}` });
          sendBlock({ blockType: "status", text: "Agent ready — waiting for your message..." });
          // Apply default effort level on initial spawn
          if (currentEffortLevel !== "low") {
            const tokens = currentEffortLevel === "medium" ? 31999 : 31999;
            sendControlRequest("set_max_thinking_tokens", { maxThinkingTokens: tokens });
          }
        }
        // ── Background task events ──
        else if (ev.subtype === "task_started") {
          sendBlock({
            blockType: "task_started",
            taskId: ev.task_id,
            taskType: ev.task_type,
            description: ev.description,
            prompt: ev.prompt,
          });
        }
        else if (ev.subtype === "task_progress") {
          sendBlock({
            blockType: "task_progress",
            taskId: ev.task_id,
            description: ev.description,
            lastToolName: ev.last_tool_name,
            usage: ev.usage,
            summary: ev.summary,
          });
        }
        else if (ev.subtype === "task_notification") {
          sendBlock({
            blockType: "task_notification",
            taskId: ev.task_id,
          });
        }
        break;
      }

      case "stream_event": {
        const e = ev.event;
        if (!e) break;
        switch (e.type) {
          case "content_block_start": {
            const cb = e.content_block;
            if (cb?.type === "thinking") {
              ii.thinkingId = nextId();
              ii.thinkingText = "";
              sendBlock({ id: ii.thinkingId, blockType: "thinking", text: "", status: "running" });
            } else if (cb?.type === "tool_use") {
              ii.toolUseId = nextId();
              sendBlock({
                id: ii.toolUseId, blockType: "tool_use",
                name: cb.name || "", args: "", status: "running",
              });

              // ── Checkpoint: snapshot before Edit/Write executes ──
              const input = cb.input || ({} as Record<string, unknown>);
              if ((cb.name === "Edit" || cb.name === "Write") && typeof input.file_path === "string") {
                const oldStr = typeof input.old_string === "string" ? input.old_string : undefined;
                ii.checkpointManager.createCheckpoint(ii.toolUseId, cb.name, input.file_path, oldStr);
              }
            }
            break;
          }
          case "content_block_delta": {
            const d = e.delta;
            if (d?.type === "thinking_delta" && ii.thinkingId) {
              ii.thinkingText += d.thinking;
              if (ii.thinkingText.split(/\s+/).length % 20 === 0) {
                sendBlock({ id: ii.thinkingId, blockType: "thinking", text: ii.thinkingText, status: "running" });
              }
            } else if (d?.type === "text_delta") {
              ii.textBuffer += d.text || "";
              if (ii.textBuffer.length > 40) {
                const backup = inst();
                if (backup.id === ii.id) flushText();
              }
            }
            break;
          }
          case "tool_progress": {
            sendBlock({
              blockType: "tool_progress",
              toolUseId: e.tool_use_id,
              innerToolUseId: e.inner_tool_use_id,
              progress: e.progress,
            });
            break;
          }
        }
        break;
      }

      case "user": {
        // Tool result echo from Claude
        for (const c of ev.message?.content || []) {
          if (c.type === "tool_result") {
            const rc = c.content;
            ii.toolResult = typeof rc === "string" ? rc
              : Array.isArray(rc) ? rc.map((x: any) => x.text || "").join("\n")
              : JSON.stringify(rc || "");
            break;
          }
        }
        break;
      }

      case "assistant": {
        // Temporarily set active instance for flushText
        const prevActive = instanceManager.activeId;
        instanceManager.setActive(ii.id);
        flushText();
        // Finalize thinking
        if (ii.thinkingId) {
          sendBlock({ id: ii.thinkingId, blockType: "thinking", text: ii.thinkingText, status: "done" });
          ii.thinkingId = null;
          ii.thinkingText = "";
        }
        // Finalize tool_use blocks from authoritative snapshot
        for (const c of ev.message?.content || []) {
          if (c.type === "tool_use") {
            const id = ii.toolUseId || nextId();
            ii.toolUseId = null;
            sendBlock({
              id, blockType: "tool_use",
              name: c.name, args: JSON.stringify(c.input),
              status: "done", result: ii.toolResult || "",
            });
            ii.toolResult = "";
          }
        }
        if (prevActive) instanceManager.setActive(prevActive);
        break;
      }

      case "result": {
        const prevActive = instanceManager.activeId;
        instanceManager.setActive(ii.id);
        flushText();
        if (ev.cost || ev.tokens || ev.usage) {
          sendBlock({
            blockType: "token_usage",
            cost: ev.cost, tokens: ev.tokens || ev.usage, model: ev.model,
          });
        }
        sendBlock({ blockType: "done", text: ev.subtype === "success" ? "Completed" : ev.error || "Error" });
        if (ev.subtype !== "success") {
          sendBlock({ blockType: "error", text: ev.error || "Unknown error" });
        }
        // Turn done — process next in queue
        ii.isProcessing = false;
        processQueueForInstance(ii);
        if (prevActive) instanceManager.setActive(prevActive);
        break;
      }
    }
  });

  // ── stderr → raw output ──────────────────────────────────
  i.process.stderr?.on("data", (chunk: Buffer) => {
    const data = chunk.toString();
    broadcast({ type: "output", data });
    bufferOutput(data);
  });

  i.process.on("error", (err) => {
    sendBlock({ blockType: "error", text: `Process error: ${err.message}` });
  });

  i.process.on("close", (code) => {
    if (code !== null && code !== 0) {
      sendBlock({ blockType: "status", text: `Process exited (${code})` });
    }
    i.process = null;
    i.status = 'stopped';
  });
}

function killClaude(instanceId?: string) {
  const i = instanceId ? instanceManager.get(instanceId) : inst();
  if (!i) return;
  if (i.process) {
    i.process.kill();
    i.process = null;
  }
  i.status = 'stopped';
  releaseQueueForInstance(i);
}

function interruptClaude(instanceId?: string) {
  const i = instanceId ? instanceManager.get(instanceId) : inst();
  if (!i?.process?.pid) return false;

  // Broadcast that we're interrupting
  sendBlock({ blockType: "status", text: "Interrupting and rewinding changes..." });

  // Rewind all checkpoints from the current turn immediately
  const rewindResult = i.checkpointManager.rewindCurrentTurn();
  if (rewindResult.restored > 0) {
    sendBlock({ blockType: "status", text: `↩ Rewound ${rewindResult.restored} change(s) (${rewindResult.skipped} skipped)` });
  }

  try {
    // Send SIGINT on Unix, Ctrl+C equivalent on Windows
    if (process.platform === "win32") {
      execSync(`taskkill //PID ${i.process.pid} //T`, { timeout: 3000 });
    } else {
      process.kill(i.process.pid, "SIGINT");
    }
    // If Claude doesn't respond within 5s, force-kill + respawn
    setTimeout(() => {
      if (i.process) {
        i.process.kill();
        i.process = null;
        spawnClaude(i.id);
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
  if (!i.process?.stdin?.writable) return false;
  const requestId = `r${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const msg = JSON.stringify({
    type: "control_request",
    request_id: requestId,
    request: { subtype, ...data },
  }) + "\n";
  i.process.stdin.write(msg);
  broadcast({ type: "control_sent", subtype, ...data, requestId });
  return true;
}

function setPermissionMode(mode: "default" | "acceptEdits" | "plan") {
  currentPermissionMode = mode;
  sendControlRequest("set_permission_mode", { mode });
  broadcast({ type: "mode_changed", mode, effort: currentEffortLevel });
}

function setThinkingLevel(level: "low" | "medium" | "high") {
  currentEffortLevel = level;
  const tokens = level === "low" ? 0 : 31999;
  sendControlRequest("set_max_thinking_tokens", { maxThinkingTokens: tokens });
  broadcast({ type: "mode_changed", mode: currentPermissionMode, effort: level });
}

// ─── Message Queue (sequential processing, source-locked) ──────────

function processQueueForInstance(i: import("./instance-manager").InstanceData) {
  if (i.isProcessing || i.pendingQueue.length === 0 || !i.process?.stdin?.writable) {
    if (i.pendingQueue.length === 0) i.queueLock = null;
    return;
  }
  i.isProcessing = true;
  const entry = i.pendingQueue.shift()!;
  const pipeIdx = entry.indexOf("|");
  const source = pipeIdx > 0 ? entry.slice(0, pipeIdx) : "terminal";
  const text = pipeIdx > 0 ? entry.slice(pipeIdx + 1) : entry;

  broadcast({
    type: "queue_status",
    processing: true,
    source,
    queueDepth: i.pendingQueue.length,
  });

  resetStreamState();
  i.checkpointManager.startNewTurn();
  i.process.stdin.write(JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
  }) + "\n");
}

function processQueue() {
  const i = inst();
  processQueueForInstance(i);
}

function enqueueInput(text: string, source: string = "terminal") {
  const i = inst();
  if (i.isProcessing && i.queueLock && i.queueLock !== source && !text.startsWith("/")) {
    broadcast({
      type: "system",
      subtype: "queue_blocked",
      message: `Cannot send — ${i.queueLock} is currently processing. Wait or interrupt first.`,
      blockedSource: source,
      activeSource: i.queueLock,
    });
    return;
  }

  if (!i.queueLock) i.queueLock = source;
  i.pendingQueue.push(`${source}|${text}`);

  broadcast({
    type: "queue_status",
    processing: i.isProcessing,
    source: i.queueLock,
    queueDepth: i.pendingQueue.length,
  });

  processQueueForInstance(i);
}

function releaseQueueForInstance(i: import("./instance-manager").InstanceData) {
  i.pendingQueue.length = 0;
  i.queueLock = null;
  i.isProcessing = false;
  broadcast({
    type: "queue_status",
    processing: false,
    source: null,
    queueDepth: 0,
  });
}

function releaseQueue() {
  const i = inst();
  releaseQueueForInstance(i);
}

// ─── HTTP Server ──────────────────────────────────────────────────
const OUT_DIR = join(__dirname, "../out");
let ROOT_DIR = inst().dir;

const httpServer = createServer((req, res) => {
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

  // ── API: Write file (for revert) ────────────────────────
  if (path === "/api/write" && req.method === "POST") {
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

  // ── API: Search Sessions (Claude Code history) ──────────
  if (path === "/api/sessions/search" && req.method === "GET") {
    const query = (url.searchParams.get("q") || "").toLowerCase().trim();
    const claudeDir = join(process.env.HOME || process.env.USERPROFILE || "~", ".claude");
    const historyFile = join(claudeDir, "history.jsonl");
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

          // Search in display text and project path
          const inDisplay = query ? display.toLowerCase().includes(query) : false;
          const inProject = query ? project.toLowerCase().includes(query) : false;

          if (query && !inDisplay && !inProject) {
            // Try deeper: search per-session content
            const projectSlug = project.replace(/[\\/:]/g, "-");
            const sessionFile = join(claudeDir, "projects", projectSlug, sessionId + ".jsonl");
            if (existsSync(sessionFile)) {
              try {
                const sessionContent = readFileSync(sessionFile, "utf8");
                if (sessionContent.toLowerCase().includes(query)) {
                  // Extract a snippet around the match
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
                  });
                  continue;
                }
              } catch {}
            }
          }

          // Match display/project, or no query (show all)
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

      // Sort by timestamp descending
      results.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      // Limit results
      const limited = results.slice(0, 50);

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
    const claudeDir = join(process.env.HOME || process.env.USERPROFILE || "~", ".claude");

    if (!sessionId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing sessionId" }));
      return;
    }

    try {
      // Try the project path
      let sessionContent = "";
      if (project) {
        const projectSlug = project.replace(/[\\/:]/g, "-");
        const sessionFile = join(claudeDir, "projects", projectSlug, sessionId + ".jsonl");
        if (existsSync(sessionFile)) {
          sessionContent = readFileSync(sessionFile, "utf8");
        }
      }

      // If not found, search all project dirs
      if (!sessionContent) {
        const projectsDir = join(claudeDir, "projects");
        if (existsSync(projectsDir)) {
          const projectDirs = readdirSync(projectsDir);
          for (const pdir of projectDirs) {
            const candidateFile = join(projectsDir, pdir, sessionId + ".jsonl");
            if (existsSync(candidateFile)) {
              sessionContent = readFileSync(candidateFile, "utf8");
              break;
            }
          }
        }
      }

      // Parse lines into structured messages with content blocks
      const messages: any[] = [];
      if (sessionContent) {
        const lines = sessionContent.split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            const entryType = parsed.type || "";
            // Skip non-message entries
            if (entryType === "queue-operation") continue;

            const message = parsed.message || {};
            const role = message.role || "";
            const contentArr = Array.isArray(message.content) ? message.content : [];
            const textContent = typeof message.content === 'string' ? message.content : '';

            if (!role) continue;
            // Claude Code stores user messages as plain string content, not arrays
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
                case "tool_result": {
                  const resultText = typeof c.content === "string" ? c.content
                    : Array.isArray(c.content) ? c.content.map((x: any) => x.text || x.content || "").join("\n")
                    : JSON.stringify(c.content || "");
                  blocks.push({ type: "tool_result", text: resultText.slice(0, 2000) });
                  break;
                }
              }
            }

            // If content was a plain string (user message), create a text block
            if (contentArr.length === 0 && textContent) {
              blocks.push({ type: "text", text: textContent });
              combinedText = textContent;
            }

            messages.push({
              role,
              blocks,
              text: combinedText.trim().slice(0, 5000),
              timestamp: parsed.timestamp || 0,
              isCompactSummary: parsed.isCompactSummary === true,
            });
          } catch {}
        }
      }

      // Merge tool_result-only user messages into preceding assistant messages
      const mergedMessages: any[] = [];
      for (const msg of messages) {
        if (msg.role === "user" && msg.blocks.length > 0 && msg.blocks.every((b: any) => b.type === "tool_result")) {
          if (mergedMessages.length > 0) {
            const prev = mergedMessages[mergedMessages.length - 1];
            for (const block of msg.blocks) {
              if (block.type === "tool_result") {
                for (let i = prev.blocks.length - 1; i >= 0; i--) {
                  if (prev.blocks[i].type === "tool_use") {
                    prev.blocks[i].output = block.text.slice(0, 3000);
                    break;
                  }
                }
              }
            }
          }
        } else {
          mergedMessages.push({ role: msg.role, blocks: msg.blocks, text: msg.text, timestamp: msg.timestamp, isCompactSummary: msg.isCompactSummary });
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

  // ── API: Current session detail (Claude Code .jsonl) ──────
  if (path === "/api/sessions/current") {
    try {
      const userHome = process.env.HOME || process.env.USERPROFILE || "~";
      const claudeDir = join(userHome, ".claude");
      const projectSlug = ROOT_DIR.replace(/[^a-zA-Z0-9-]/g, "-");
      const projectsDir = join(claudeDir, "projects", projectSlug);
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
        // Debug info to help diagnose path issues
        const debugInfo = { ROOT_DIR, projectSlug, projectsDir, userHome, dirExists: existsSync(projectsDir) };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ sessionId: "", messages: [], found: false, debug: debugInfo }));
        return;
      }

      const sessionId = basename(latestFile, ".jsonl");
      const sessionContent = readFileSync(latestFile, "utf8");

      // Reuse the same parsing logic as detail endpoint
      const lines = sessionContent.split("\n").filter(Boolean);
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
              case "tool_result": {
                const resultText = typeof c.content === "string" ? c.content
                  : Array.isArray(c.content) ? c.content.map((x: any) => x.text || x.content || "").join("\n")
                  : JSON.stringify(c.content || "");
                blocks.push({ type: "tool_result", text: resultText.slice(0, 2000) });
                break;
              }
            }
          }

          // User messages: content is a plain string
          if (contentArr.length === 0 && textContent) {
            blocks.push({ type: "text", text: textContent });
            combinedText = textContent;
          }

          messages.push({
            role, blocks,
            text: combinedText.trim().slice(0, 5000),
            timestamp: parsed.timestamp || 0,
            isCompactSummary: parsed.isCompactSummary === true,
          });
        } catch {}
      }

      // Merge tool_result-only user messages into preceding assistant messages
      const mergedMessages: any[] = [];
      for (const msg of messages) {
        if (msg.role === "user" && msg.blocks.length > 0 && msg.blocks.every((b: any) => b.type === "tool_result")) {
          if (mergedMessages.length > 0) {
            const prev = mergedMessages[mergedMessages.length - 1];
            for (const block of msg.blocks) {
              if (block.type === "tool_result") {
                for (let i = prev.blocks.length - 1; i >= 0; i--) {
                  if (prev.blocks[i].type === "tool_use") {
                    prev.blocks[i].output = block.text.slice(0, 3000);
                    break;
                  }
                }
              }
            }
          }
        } else {
          mergedMessages.push({ role: msg.role, blocks: msg.blocks, text: msg.text, timestamp: msg.timestamp, isCompactSummary: msg.isCompactSummary });
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

  // ── API: Interrupt current task ──────────────
  if (path === "/api/interrupt" && req.method === "POST") {
    interruptClaude();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, message: "Interrupt sent" }));
    return;
  }

  // ── API: Rewind last checkpoint ────────────
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

  // ── API: List checkpoints ──────────────────
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

  // ── API: Rewind all (current turn) ────────
  if (path === "/api/rewind-all" && req.method === "POST") {
    const result = inst().checkpointManager.rewindCurrentTurn();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
    return;
  }

  // ── API: Queue status ────────────────────────
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

  // ── API: Mode / Effort state ────────────────
  if (path === "/api/mode") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      mode: currentPermissionMode,
      effort: currentEffortLevel,
    }));
    return;
  }

  // ── API: Switch session directory ───────────────────────
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
        // Create a new instance for the target directory
        const newInst = instanceManager.create(targetDir, basename(targetDir));
        instanceManager.setActive(newInst.id);
        ROOT_DIR = targetDir;
        spawnClaude(newInst.id);
        broadcast({ type: "instance_added", instance: { id: newInst.id, dir: newInst.dir, label: newInst.label, status: newInst.status } });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, cwd: targetDir, instanceId: newInst.id }));
      } catch (err) {
        res.writeHead(500); res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // ── API: List instances ────────────────────────────────
  if (path === "/api/instances") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      instances: instanceManager.toJSON(),
      activeId: instanceManager.activeId,
    }));
    return;
  }

  // ── API: Create instance ───────────────────────────────
  if (path === "/api/instances" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      try {
        const { dir, label } = JSON.parse(body);
        const targetDir = resolve(process.cwd(), dir);
        if (!existsSync(targetDir)) {
          res.writeHead(400); res.end(JSON.stringify({ error: "Directory not found" }));
          return;
        }
        const newInst = instanceManager.create(targetDir, label);
        spawnClaude(newInst.id);
        broadcast({ type: "instance_added", instance: { id: newInst.id, dir: newInst.dir, label: newInst.label, status: newInst.status } });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, instance: { id: newInst.id, dir: newInst.dir, label: newInst.label } }));
      } catch (err) {
        res.writeHead(500); res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // ── API: Delete (kill) instance ────────────────────────
  if (path.startsWith("/api/instances/") && req.method === "DELETE") {
    const instId = path.replace("/api/instances/", "");
    const target = instanceManager.get(instId);
    if (!target) {
      res.writeHead(404); res.end(JSON.stringify({ error: "Instance not found" }));
      return;
    }
    killClaude(instId);
    instanceManager.kill(instId);
    broadcast({ type: "instance_removed", instanceId: instId });
    // If we killed the active instance, switch to another
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

  // ── API: Activate (switch to) instance ─────────────────
  if (path.startsWith("/api/instances/") && req.method === "POST" && path.endsWith("/activate")) {
    const instId = path.replace("/api/instances/", "").replace("/activate", "");
    const target = instanceManager.get(instId);
    if (!target) {
      res.writeHead(404); res.end(JSON.stringify({ error: "Instance not found" }));
      return;
    }
    instanceManager.setActive(instId);
    ROOT_DIR = target.dir;
    broadcast({ type: "instance_switched", instanceId: instId });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, instanceId: instId }));
    return;
  }

  // ── API: Health check ────────────────────────────────────
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
      connections: wss.clients.size,
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
});

// ─── WebSocket Server ─────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });

// ── Heartbeat ────────────────────────────────────────────────
const HEARTBEAT_INTERVAL = 30000; // 30s
const heartbeatMap = new WeakMap<WebSocket, boolean>();

function heartbeatPing() {
  for (const ws of wss.clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (heartbeatMap.get(ws) === false) {
      // Missed a pong — terminate
      ws.terminate();
      return;
    }
    heartbeatMap.set(ws, false);
    ws.ping();
  }
}

const heartbeatTimer = setInterval(heartbeatPing, HEARTBEAT_INTERVAL);
wss.on("close", () => clearInterval(heartbeatTimer));

wss.on("connection", (ws) => {
  heartbeatMap.set(ws, true);
  clients.add(ws);

  ws.on("pong", () => {
    heartbeatMap.set(ws, true);
  });

  // Start Claude for active instance on first connection
  const activeInst = inst();
  if (!activeInst.process) spawnClaude();

  // Flush history to reconnecting client
  flushBuffer(ws);

  // Immediately authenticate (no token needed — local mode)
  send(ws, { type: "auth_result", success: true, sessionId: activeInst.id, instances: instanceManager.toJSON() });
  send(ws, { type: "workspace_connected" });

  ws.on("message", (raw) => {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    // Route to target instance if specified
    const targetInst = msg.instanceId ? (instanceManager.get(msg.instanceId) || inst()) : inst();
    const prevActive = instanceManager.activeId;
    instanceManager.setActive(targetInst.id);

    switch (msg.type) {
      case "direct":
      case "auth":
        // Already authenticated above — no-op
        break;

      case "input": {
        // Echo user input as a block for the UI
        sendBlock({ blockType: "user", text: msg.data });
        enqueueInput(msg.data, "web");
        break;
      }

      case "command": {
        if (msg.name === "clear" || msg.name === "restart") {
          if (msg.args?.model) targetInst.model = msg.args.model;
          targetInst.checkpointManager.clear();
          spawnClaude(targetInst.id);
          sendBlock({
            blockType: "status",
            text: msg.name === "restart" && msg.args?.model
              ? `Model switched to ${msg.args.model}`
              : "Session cleared — starting fresh...",
          });
        } else if (msg.name === "interrupt") {
          interruptClaude(targetInst.id);
        } else if (msg.name === "rewind") {
          const { success, checkpoint } = targetInst.checkpointManager.rewindLastCheckpoint();
          if (success) {
            sendBlock({ blockType: "status", text: `Rewound: ${checkpoint?.filePath ?? "unknown"}` });
          } else {
            sendBlock({ blockType: "status", text: "Nothing to rewind" });
          }
        } else if (msg.name === "rewind-all") {
          const result = targetInst.checkpointManager.rewindCurrentTurn();
          sendBlock({ blockType: "status", text: `Rewound ${result.restored} change(s) (${result.skipped} skipped, ${result.failed} failed)` });
        } else if (msg.name === "setMode") {
          const mode = msg.args?.mode;
          if (["default", "acceptEdits", "plan"].includes(mode)) {
            setPermissionMode(mode);
            sendBlock({ blockType: "status", text: `Permission mode: ${mode}` });
          }
        } else if (msg.name === "setEffort") {
          const level = msg.args?.level;
          if (["low", "medium", "high"].includes(level)) {
            setThinkingLevel(level);
            sendBlock({ blockType: "status", text: `Thinking effort: ${level}` });
          }
        } else if (msg.name === "switch-instance") {
          const target = msg.args?.instanceId;
          if (target && instanceManager.get(target)) {
            instanceManager.setActive(target);
            sendBlock({ blockType: "status", text: `Switched to instance: ${target}` });
            send(ws, { type: "instance_switched", instanceId: target });
          }
        } else if (msg.name === "list-instances") {
          send(ws, { type: "instance_list", instances: instanceManager.toJSON(), activeId: instanceManager.activeId });
        }
        break;
      }
    }

    // Restore previous active instance if routing was temporary
    if (msg.instanceId && prevActive) {
      instanceManager.setActive(prevActive);
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    // Claude stays alive even with no clients
  });
});

// ─── Graceful Shutdown ───────────────────────────────────────────
function shutdown(signal: string) {
  console.log(`\n  [${signal}] Shutting down gracefully...`);

  // Notify clients
  broadcast({ type: "system", subtype: "shutdown", message: "Server is shutting down..." });

  // Kill all Claude processes
  for (const inst of instanceManager.list()) {
    if (inst.process) {
      inst.process.kill();
      inst.process = null;
    }
  }
  instanceManager.stopAll();

  // Clear timers
  clearInterval(heartbeatTimer);

  // Close all WebSocket connections
  for (const ws of wss.clients) {
    ws.close(1001, "Server shutting down");
  }

  // Close HTTP server
  httpServer.close(() => {
    console.log(`  [${signal}] Server stopped.`);
    process.exit(0);
  });

  // Force exit after 5s
  setTimeout(() => {
    console.error(`  [${signal}] Forced exit after timeout.`);
    process.exit(1);
  }, 5000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ─── Start ────────────────────────────────────────────────────────
export function startRelayServer(port?: number) {
  const p = port ?? PORT;

  // ── Environment validation ──────────────────────────────
  try {
    const { cmd, args: prefix } = resolveClaude();
    execSync(`"${prefix.length ? prefix.join(" ") : cmd}" --version`, { timeout: 10000, stdio: "pipe" });
    console.log(`  ✓ Claude binary resolved: ${cmd} ${prefix.join(" ")}`);
  } catch {
    console.warn(`  ⚠ Claude binary not found or not responding.`);
    console.warn(`    The server will start but Claude will not be available.`);
    console.warn(`    Install Claude Code: npm install -g @anthropic-ai/claude-code\n`);
  }

  // ── Port validation ────────────────────────────────────
  if (p < 1 || p > 65535) {
    console.error(`  ✗ Invalid port: ${p}. Using default 8080.`);
    process.exit(1);
  }

  httpServer.listen(p, () => {
    console.log(`\n  ┌──────────────────────────────────────┐`);
    console.log(`  │  SessionBridge Relay Server         │`);
    console.log(`  │                                      │`);
    console.log(`  │  Server:    http://localhost:${String(p).padEnd(5)}            │`);
    console.log(`  │  Web UI:    http://localhost:${String(p).padEnd(5)} (static frontend) │`);
    console.log(`  │  Health:    http://localhost:${String(p).padEnd(5)}/api/health  │`);
    console.log(`  │                                      │`);
    console.log(`  │  Claude spawns on first connection   │`);
    console.log(`  └──────────────────────────────────────┘\n`);
  });
}

// Auto-start when run directly (not imported)
if (require.main === module || process.argv[1]?.endsWith("relay-server.js")) {
  startRelayServer();
}
