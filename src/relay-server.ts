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

// ─── Start Time ────────────────────────────────────────────────────
const START_TIME = Date.now();

// ─── Config ──────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "8080", 10);

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

// ─── Checkpoint Manager ─────────────────────────────────────────
const checkpointManager = new CheckpointManager(process.cwd());

// Shorthand: update root dir when ROOT_DIR changes
function updateCheckpointRoot(dir: string) {
  checkpointManager.setRootDir(dir);
}

const startNewTurn = () => checkpointManager.startNewTurn();
const createCheckpoint = (...args: Parameters<CheckpointManager['createCheckpoint']>) => checkpointManager.createCheckpoint(...args);
const rewindCurrentTurn = () => checkpointManager.rewindCurrentTurn();
const rewindLastCheckpoint = () => checkpointManager.rewindLastCheckpoint();
const clearCheckpoints = () => checkpointManager.clear();
const countCurrentTurnCheckpoints = () => checkpointManager.countCurrentTurnCheckpoints();

// ─── Block ID ─────────────────────────────────────────────────────
let blockSeq = 0;
const nextId = () => `blk_${++blockSeq}`;

// ─── Block / Output Buffer (for reconnect persistence) ────────────
const MAX_BLOCKS = 500;
const blockBuffer: Record<string, unknown>[] = [];
const outputBuffer: string[] = [];
let outputSize = 0;

function bufferBlock(block: Record<string, unknown>) {
  blockBuffer.push(block);
  if (blockBuffer.length > MAX_BLOCKS) blockBuffer.shift();
}

function bufferOutput(data: string) {
  outputBuffer.push(data);
  outputSize += data.length;
  while (outputSize > 512 * 1024 && outputBuffer.length > 0) {
    outputSize -= outputBuffer.shift()?.length ?? 0;
  }
}

function flushBuffer(ws: WebSocket) {
  for (const block of blockBuffer) send(ws, block);
  for (const data of outputBuffer) send(ws, { type: "output", data });
}

// ─── Claude Process Manager ───────────────────────────────────────
let claudeProc: ReturnType<typeof spawn> | null = null;
let currentModel: string | null = null;

// Streaming state (reset per turn)
let currentThinkingId: string | null = null;
let currentThinkingText = "";
let currentToolUseId: string | null = null;
let currentToolResult = "";
let textBuffer = "";

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
  // Don't buffer user blocks — they come from history API on page refresh.
  // Buffering them causes duplicates when flushBuffer replays them to new WS clients.
  if (block.blockType !== 'user') {
    bufferBlock(msg);
  }
}

function flushText() {
  if (textBuffer) {
    sendBlock({ blockType: "text", text: textBuffer });
    textBuffer = "";
  }
}

function resetStreamState() {
  currentThinkingId = null;
  currentThinkingText = "";
  currentToolUseId = null;
  currentToolResult = "";
  textBuffer = "";
}

// ─── Spawn / Kill Claude ──────────────────────────────────────────
function spawnClaude() {
  killClaude();

  // Clear stale blocks from previous session to prevent duplicate replay
  blockBuffer.length = 0;
  outputBuffer.length = 0;
  outputSize = 0;

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
  if (currentModel) allArgs.push("--model", currentModel);

  claudeProc = spawn(cmd, allArgs, { stdio: ["pipe", "pipe", "pipe"] });

  // ── stdout: readline-based JSON event parsing ────────────
  const rl = createInterface({ input: claudeProc.stdout! });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let ev: any;
    try { ev = JSON.parse(line); } catch { return; }

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
              currentThinkingId = nextId();
              currentThinkingText = "";
              sendBlock({ id: currentThinkingId, blockType: "thinking", text: "", status: "running" });
            } else if (cb?.type === "tool_use") {
              currentToolUseId = nextId();
              sendBlock({
                id: currentToolUseId, blockType: "tool_use",
                name: cb.name || "", args: "", status: "running",
              });

              // ── Checkpoint: snapshot before Edit/Write executes ──
              const input = cb.input || ({} as Record<string, unknown>);
              if ((cb.name === "Edit" || cb.name === "Write") && typeof input.file_path === "string") {
                const oldStr = typeof input.old_string === "string" ? input.old_string : undefined;
                createCheckpoint(currentToolUseId, cb.name, input.file_path, oldStr);
              }
            }
            break;
          }
          case "content_block_delta": {
            const d = e.delta;
            if (d?.type === "thinking_delta" && currentThinkingId) {
              currentThinkingText += d.thinking;
              if (currentThinkingText.split(/\s+/).length % 20 === 0) {
                sendBlock({ id: currentThinkingId, blockType: "thinking", text: currentThinkingText, status: "running" });
              }
            } else if (d?.type === "text_delta") {
              textBuffer += d.text || "";
              if (textBuffer.length > 40) flushText();
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
            currentToolResult = typeof rc === "string" ? rc
              : Array.isArray(rc) ? rc.map((x: any) => x.text || "").join("\n")
              : JSON.stringify(rc || "");
            break;
          }
        }
        break;
      }

      case "assistant": {
        flushText();
        // Finalize thinking
        if (currentThinkingId) {
          sendBlock({ id: currentThinkingId, blockType: "thinking", text: currentThinkingText, status: "done" });
          currentThinkingId = null;
          currentThinkingText = "";
        }
        // Finalize tool_use blocks from authoritative snapshot
        for (const c of ev.message?.content || []) {
          if (c.type === "tool_use") {
            const id = currentToolUseId || nextId();
            currentToolUseId = null;
            sendBlock({
              id, blockType: "tool_use",
              name: c.name, args: JSON.stringify(c.input),
              status: "done", result: currentToolResult || "",
            });
            currentToolResult = "";
          }
        }
        break;
      }

      case "result": {
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
        isProcessing = false;
        processQueue();
        break;
      }
    }
  });

  // ── stderr → raw output ──────────────────────────────────
  claudeProc.stderr?.on("data", (chunk: Buffer) => {
    const data = chunk.toString();
    broadcast({ type: "output", data });
    bufferOutput(data);
  });

  claudeProc.on("error", (err) => {
    sendBlock({ blockType: "error", text: `Process error: ${err.message}` });
  });

  claudeProc.on("close", (code) => {
    if (code !== null && code !== 0) {
      sendBlock({ blockType: "status", text: `Process exited (${code})` });
    }
    claudeProc = null;
  });
}

function killClaude() {
  if (claudeProc) {
    claudeProc.kill();
    claudeProc = null;
  }
  releaseQueue();
}

function interruptClaude() {
  if (!claudeProc?.pid) return false;

  // Broadcast that we're interrupting
  sendBlock({ blockType: "status", text: "Interrupting and rewinding changes..." });

  // Rewind all checkpoints from the current turn immediately
  const rewindResult = rewindCurrentTurn();
  if (rewindResult.restored > 0) {
    sendBlock({ blockType: "status", text: `↩ Rewound ${rewindResult.restored} change(s) (${rewindResult.skipped} skipped)` });
  }

  try {
    // Send SIGINT on Unix, Ctrl+C equivalent on Windows
    if (process.platform === "win32") {
      execSync(`taskkill //PID ${claudeProc.pid} //T`, { timeout: 3000 });
    } else {
      process.kill(claudeProc.pid, "SIGINT");
    }
    // If Claude doesn't respond within 5s, force-kill + respawn
    setTimeout(() => {
      if (claudeProc) {
        killClaude();
        spawnClaude();
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
function sendControlRequest(subtype: string, data: Record<string, unknown>): boolean {
  if (!claudeProc?.stdin?.writable) return false;
  const requestId = `r${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const msg = JSON.stringify({
    type: "control_request",
    request_id: requestId,
    request: { subtype, ...data },
  }) + "\n";
  claudeProc.stdin.write(msg);
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
let isProcessing = false;
const pendingQueue: string[] = [];
/** Which source currently holds the queue lock */
let queueLock: string | null = null;
const QUEUE_LOCK_TIMEOUT = 5 * 60 * 1000; // 5 min auto-release

function releaseQueueLock() {
  queueLock = null;
}

function acquireQueueLock(source: string): boolean {
  if (!queueLock || queueLock === source) {
    queueLock = source;
    return true;
  }
  return false;
}

function processQueue() {
  if (isProcessing || pendingQueue.length === 0 || !claudeProc?.stdin?.writable) {
    if (pendingQueue.length === 0) queueLock = null;
    return;
  }
  isProcessing = true;
  const entry = pendingQueue.shift()!;
  // Extract source from the stored entry (format: "source|text")
  const pipeIdx = entry.indexOf("|");
  const source = pipeIdx > 0 ? entry.slice(0, pipeIdx) : "terminal";
  const text = pipeIdx > 0 ? entry.slice(pipeIdx + 1) : entry;

  // Broadcast which source is being processed
  broadcast({
    type: "queue_status",
    processing: true,
    source,
    queueDepth: pendingQueue.length,
  });

  resetStreamState();
  startNewTurn();
  claudeProc.stdin.write(JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
  }) + "\n");
  // stdin stays open — process lives forever
}

function enqueueInput(text: string, source: string = "terminal") {
  // Enforce source lock: only one source can queue at a time
  if (isProcessing && queueLock && queueLock !== source && !text.startsWith("/")) {
    // Non-interrupt source trying to queue while another source is active
    broadcast({
      type: "system",
      subtype: "queue_blocked",
      message: `Cannot send — ${queueLock} is currently processing. Wait or interrupt first.`,
      blockedSource: source,
      activeSource: queueLock,
    });
    return;
  }

  // Acquire lock if free
  if (!queueLock) queueLock = source;

  // Store source prefix so we can route output back
  pendingQueue.push(`${source}|${text}`);

  // Notify all clients of queue state
  broadcast({
    type: "queue_status",
    processing: isProcessing,
    source: queueLock,
    queueDepth: pendingQueue.length,
  });

  processQueue();
}

/** Force-release the queue lock (e.g., on interrupt) */
function releaseQueue() {
  pendingQueue.length = 0;
  queueLock = null;
  isProcessing = false;
  broadcast({
    type: "queue_status",
    processing: false,
    source: null,
    queueDepth: 0,
  });
}

// ─── HTTP Server ──────────────────────────────────────────────────
const OUT_DIR = join(__dirname, "../out");
let ROOT_DIR = process.cwd();

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
    const { success, checkpoint } = rewindLastCheckpoint();
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
    const currentTurnCps = checkpointManager.getCurrentTurnCheckpoints();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      total: checkpointManager.totalCheckpoints(),
      currentTurn: currentTurnCps.length,
      turnStartIndex: checkpointManager.getTurnStartIndex(),
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
    const result = rewindCurrentTurn();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
    return;
  }

  // ── API: Queue status ────────────────────────
  if (path === "/api/queue") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      isProcessing,
      queueDepth: pendingQueue.length,
      queue: pendingQueue.slice(0, 10).map((t, i) => ({ pos: i + 1, text: t.slice(0, 100) })),
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
        // Kill Claude, change dir, restart
        killClaude();
        process.chdir(targetDir);
        ROOT_DIR = targetDir;
        updateCheckpointRoot(targetDir);
        // Clear buffers and checkpoints for new session
        clearCheckpoints();
        blockBuffer.length = 0;
        outputBuffer.length = 0;
        outputSize = 0;
        currentModel = null;
        spawnClaude();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, cwd: targetDir }));
      } catch (err) {
        res.writeHead(500); res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // ── API: Health check ────────────────────────────────────
  if (path === "/api/health") {
    const mem = memoryUsage();
    const heartbeatAlive = heartbeatTimer !== undefined;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: claudeProc ? "ok" : "degraded",
      uptime: Date.now() - START_TIME,
      claude: {
        alive: claudeProc !== null,
        pid: claudeProc?.pid || null,
        model: currentModel,
      },
      queue: {
        depth: pendingQueue.length,
        processing: isProcessing,
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
      blocksBuffered: blockBuffer.length,
      outputBuffered: outputBuffer.length,
      outputSizeKB: Math.round(outputSize / 1024),
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

  // Start Claude on first connection
  if (!claudeProc) spawnClaude();

  // Flush history to reconnecting client
  flushBuffer(ws);

  // Immediately authenticate (no token needed — local mode)
  send(ws, { type: "auth_result", success: true, sessionId: "default" });
  send(ws, { type: "workspace_connected" });

  ws.on("message", (raw) => {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

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
          if (msg.args?.model) currentModel = msg.args.model;
          clearCheckpoints();
          spawnClaude();
          sendBlock({
            blockType: "status",
            text: msg.name === "restart" && msg.args?.model
              ? `Model switched to ${msg.args.model}`
              : "Session cleared — starting fresh...",
          });
        } else if (msg.name === "interrupt") {
          interruptClaude();
          // interruptClaude already broadcasts rewind status
        } else if (msg.name === "rewind") {
          const { success, checkpoint } = rewindLastCheckpoint();
          if (success) {
            sendBlock({ blockType: "status", text: `Rewound: ${checkpoint?.filePath ?? "unknown"}` });
          } else {
            sendBlock({ blockType: "status", text: "Nothing to rewind" });
          }
        } else if (msg.name === "rewind-all") {
          const result = rewindCurrentTurn();
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
        }
        break;
      }
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

  // Kill Claude process
  if (claudeProc) {
    claudeProc.kill();
    claudeProc = null;
  }

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
    console.log(`  │  Persistent Claude process mode     │`);
    console.log(`  │                                      │`);
    console.log(`  │  http://0.0.0.0:${String(p).padEnd(5)}              │`);
    console.log(`  │  Claude spawns on first connection  │`);
    console.log(`  │  Health:  http://0.0.0.0:${String(p).padEnd(5)}/api/health  │`);
    console.log(`  └──────────────────────────────────────┘\n`);
  });
}

// Auto-start when run directly (not imported)
if (require.main === module || process.argv[1]?.endsWith("relay-server.js")) {
  startRelayServer();
}
