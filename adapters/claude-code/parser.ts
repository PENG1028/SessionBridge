// ─── Stream Parser ───────────────────────────────────────────
// Claude stream-json line processor, extracted from spawnClaude()
// so local (ChildProcess stdout) and remote (agent WS) can share it.

export interface ParserInstance {
  id: string;
  status: string;
  source: string;
  thinkingId: string | null;
  thinkingText: string;
  toolUseId: string | null;
  toolResult: string;
  textBuffer: string;
  checkpointManager: {
    createCheckpoint: (id: string, name: string, filePath: string, oldStr?: string) => void;
  };
  isProcessing: boolean;
}

export type StreamParserDeps = {
  sendBlock: (block: Record<string, unknown>) => void;
  broadcast: (msg: unknown) => void;
  bufferOutput: (data: string) => void;
  nextId: () => string;
  setActive: (id: string | null) => void;
  getActiveId: () => string | null;
  processQueueForInstance: (inst: ParserInstance) => void;
  sendControlRequest: (subtype: string, data: Record<string, unknown>, instanceId?: string) => boolean;
  getEffortLevel: () => string;
};

/**
 * Process a single stream-json line from Claude output.
 *
 * Designed to be called either from:
 * - readline on a local ChildProcess stdout (local instances)
 * - WS message handler receiving agent_stdout (remote instances)
 */
export function processStreamLine(
  i: ParserInstance,
  line: string,
  deps: StreamParserDeps,
): void {
  if (!line.trim()) return;
  let ev: any;
  try { ev = JSON.parse(line); } catch { return; }

  // Ensure we're operating on an up-to-date instance reference
  const ii = i;
  ii.status = 'running';

  switch (ev.type) {
    case "system": {
      if (ev.subtype === "init") {
        deps.sendBlock({ blockType: "status", text: `Model: ${ev.model} | v${ev.claude_code_version}` });
        deps.sendBlock({ blockType: "status", text: "Agent ready — waiting for your message..." });
        // Apply default effort level on initial spawn
        if (deps.getEffortLevel() !== "low") {
          const tokens = deps.getEffortLevel() === "medium" ? 31999 : 31999;
          deps.sendControlRequest("set_max_thinking_tokens", { maxThinkingTokens: tokens }, ii.id);
        }
      }
      // ── Background task events ──
      else if (ev.subtype === "task_started") {
        deps.sendBlock({
          blockType: "task_started",
          taskId: ev.task_id,
          taskType: ev.task_type,
          description: ev.description,
          prompt: ev.prompt,
        });
      }
      else if (ev.subtype === "task_progress") {
        deps.sendBlock({
          blockType: "task_progress",
          taskId: ev.task_id,
          description: ev.description,
          lastToolName: ev.last_tool_name,
          usage: ev.usage,
          summary: ev.summary,
        });
      }
      else if (ev.subtype === "task_notification") {
        deps.sendBlock({
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
            ii.thinkingId = (cb as any).id || deps.nextId();
            ii.thinkingText = "";
            deps.sendBlock({ id: ii.thinkingId, blockType: "thinking", text: "", status: "running" });
          } else if (cb?.type === "tool_use") {
            // Use the API's own tool_use_id for stable correlation across multi-tool turns
            ii.toolUseId = (cb as any).id || deps.nextId();
            deps.sendBlock({
              id: ii.toolUseId, blockType: "tool_use",
              name: cb.name || "", args: "", status: "running",
            });

            // ── Checkpoint: snapshot before Edit/Write executes ──
            if (ii.source !== 'remote') {
              const input = cb.input || ({} as Record<string, unknown>);
              if ((cb.name === "Edit" || cb.name === "Write") && typeof input.file_path === "string") {
                const oldStr = typeof input.old_string === "string" ? input.old_string : undefined;
                ii.checkpointManager.createCheckpoint(ii.toolUseId!, cb.name, input.file_path, oldStr);
              }
            }
          }
          break;
        }
        case "content_block_delta": {
          const d = e.delta;
          if (d?.type === "thinking_delta" && ii.thinkingId) {
            ii.thinkingText += d.thinking;
            if (ii.thinkingText.split(/\s+/).length % 20 === 0) {
              deps.sendBlock({ id: ii.thinkingId, blockType: "thinking", text: ii.thinkingText, status: "running" });
            }
          } else if (d?.type === "text_delta") {
            ii.textBuffer += d.text || "";
            if (ii.textBuffer.length > 40) {
              if (deps.getActiveId() === ii.id) {
                if (ii.textBuffer) {
                  deps.sendBlock({ blockType: "text", text: ii.textBuffer });
                  ii.textBuffer = "";
                }
              }
            }
          }
          break;
        }
        case "tool_progress": {
          deps.sendBlock({
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
      const prevActive = deps.getActiveId();
      deps.setActive(ii.id);
      if (ii.textBuffer) {
        deps.sendBlock({ blockType: "text", text: ii.textBuffer });
        ii.textBuffer = "";
      }
      // Finalize thinking
      if (ii.thinkingId) {
        deps.sendBlock({ id: ii.thinkingId, blockType: "thinking", text: ii.thinkingText, status: "done" });
        ii.thinkingId = null;
        ii.thinkingText = "";
      }
      // Finalize tool_use blocks from authoritative snapshot
      for (const c of ev.message?.content || []) {
        if (c.type === "tool_use") {
          const id = ii.toolUseId || deps.nextId();
          ii.toolUseId = null;
          deps.sendBlock({
            id, blockType: "tool_use",
            name: c.name, args: JSON.stringify(c.input),
            status: "done", result: ii.toolResult || "",
          });
          ii.toolResult = "";
        }
      }
      if (prevActive) deps.setActive(prevActive);
      break;
    }

    case "result": {
      const prevActive = deps.getActiveId();
      deps.setActive(ii.id);
      if (ii.textBuffer) {
        deps.sendBlock({ blockType: "text", text: ii.textBuffer });
        ii.textBuffer = "";
      }
      if (ev.cost || ev.tokens || ev.usage) {
        deps.sendBlock({
          blockType: "token_usage",
          cost: ev.cost, tokens: ev.tokens || ev.usage, model: ev.model,
        });
      }
      deps.sendBlock({ blockType: "done", text: ev.subtype === "success" ? "Completed" : ev.error || "Error" });
      if (ev.subtype !== "success") {
        deps.sendBlock({ blockType: "error", text: ev.error || "Unknown error" });
      }
      // Turn done — process next in queue
      ii.isProcessing = false;
      deps.processQueueForInstance(ii);
      if (prevActive) deps.setActive(prevActive);
      break;
    }
  }
}
