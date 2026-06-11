#!/usr/bin/env node

// ══════════════════════════════════════════════════════
// SessionBridge — Claude Chat Adapter
//
// Node.js adapter process that connects to LLM APIs
// and streams structured events back to the plugin.
//
// Communication protocol (JSON lines):
//
//   stdin (plugin → adapter):
//     {"type":"configure","provider":"anthropic","apiKey":"...","model":"..."}
//     {"type":"user_message","text":"..."}
//     {"type":"tool_result","toolUseId":"tu_xxx","content":"..."}
//     {"type":"interrupt"}
//
//   stdout (adapter → plugin):
//     {"type":"system","subtype":"init","model":"...","adapterVersion":"..."}
//     {"type":"stream_event","event":{"type":"content_block_start",...}}
//     {"type":"stream_event","event":{"type":"content_block_delta",...}}
//     {"type":"assistant","message":{"content":[...]}}
//     {"type":"result","subtype":"success","cost":0,"tokens":{...}}
//
// This output format matches what useChatParser already parses.
// ══════════════════════════════════════════════════════

'use strict';

const readline = require('readline');

// ─── Standard tool definitions ──────────────────────
// These match Claude Code's built-in tool set.

const BUILTIN_TOOLS = [
  {
    name: 'Bash',
    description: 'Run shell commands',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to execute' },
        description: { type: 'string', description: 'What this command does' },
      },
      required: ['command'],
    },
  },
  {
    name: 'Read',
    description: 'Read a file from the filesystem',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'Write',
    description: 'Write content to a file',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file' },
        content: { type: 'string', description: 'File content to write' },
      },
      required: ['file_path', 'content'],
    },
  },
  {
    name: 'Edit',
    description: 'Edit an existing file using a search-and-replace',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file' },
        old_string: { type: 'string', description: 'Text to search for' },
        new_string: { type: 'string', description: 'Text to replace with' },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'Glob',
    description: 'List files matching a pattern',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g. **/*.ts)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'Grep',
    description: 'Search for a pattern across files',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern (regex)' },
        include: { type: 'string', description: 'File glob to include' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'WebSearch',
    description: 'Search the web for information',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'WebFetch',
    description: 'Fetch and read content from a URL',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
      },
      required: ['url'],
    },
  },
];

// ─── State ───────────────────────────────────────────

let config = {
  provider: 'anthropic',
  apiKey: '',
  baseUrl: '',
  model: 'claude-sonnet-4-6',
  systemPrompt: '',
};

let conversationHistory = [];        // { role, content, text, toolCalls, toolUseId }
let running = false;
let abortController = null;

// ─── Output helpers ─────────────────────────────────

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function emitStreamEvent(event) {
  emit({ type: 'stream_event', event });
}

function emitSystem(subtype, data = {}) {
  emit({ type: 'system', subtype, ...data });
}

function emitError(message) {
  emit({ type: 'system', subtype: 'error', error: message });
}

// ─── Provider router ────────────────────────────────

function getProvider(cfg) {
  const p = (cfg.provider || 'anthropic').toLowerCase();
  if (p === 'anthropic') {
    const { AnthropicProvider } = require('./providers/anthropic');
    return new AnthropicProvider(cfg);
  }
  // Default to OpenAI-compatible
  const { OpenAIProvider } = require('./providers/openai');
  return new OpenAIProvider(cfg);
}

// ─── Conversation handler ───────────────────────────

async function callProvider(onToolResult) {
  if (running) return;
  running = true;
  abortController = new AbortController();

  try {
    const provider = getProvider(config);
    globalThis.__adapterTools = BUILTIN_TOOLS;

    // Text buffer for accumulating assistant response
    let textBuf = '';
    let toolCalls = [];
    let inputTokens = 0;
    let outputTokens = 0;

    // Start with system event
    emitSystem('init', { model: config.model, adapterVersion: '1.0.0' });

    // Stream from provider
    const stream = provider.stream(conversationHistory, config.systemPrompt);
    for await (const event of stream) {
      if (abortController.signal.aborted) break;

      switch (event.type) {
        case 'text_delta': {
          textBuf += event.text;
          emitStreamEvent({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: event.text },
          });
          break;
        }

        case 'thinking_start': {
          emitStreamEvent({
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'thinking', id: `think_${Date.now()}`, thinking: '' },
          });
          break;
        }

        case 'thinking_delta': {
          emitStreamEvent({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', thinking: event.thinking },
          });
          break;
        }

        case 'tool_use': {
          // Emit tool_use event
          emitStreamEvent({
            type: 'content_block_start',
            content_block: {
              type: 'tool_use', id: event.id, name: event.name, input: event.input,
            },
          });

          const tc = { id: event.id, name: event.name, input: event.input };
          toolCalls.push(tc);

          // Emit as assistant message tool_use
          emit({
            type: 'assistant',
            message: {
              content: [
                ...(textBuf ? [{ type: 'text', text: textBuf }] : []),
                { type: 'tool_use', id: event.id, name: event.name, input: event.input },
              ],
            },
          });

          // Wait for tool result (the plugin will read this event, execute the tool,
          // and send tool_result back via stdin)
          running = false;  // pause the API loop — waiting for result
          await onToolResult(tc);

          // Continue: send tool result back to API
          running = true;
          break;
        }

        case 'usage': {
          inputTokens = event.inputTokens || inputTokens;
          outputTokens = event.outputTokens || outputTokens;
          break;
        }

        case 'done': {
          // Finalize
          emit({
            type: 'assistant',
            message: {
              content: textBuf ? [{ type: 'text', text: textBuf }] : [],
            },
          });

          // Token usage
          const tokens = { input: inputTokens, output: outputTokens };
          const cost = estimateCost(config.model || 'claude-sonnet-4-6', inputTokens, outputTokens);
          emit({ type: 'result', subtype: 'success', cost, tokens });

          // Store assistant message in history
          conversationHistory.push({
            role: 'assistant',
            text: textBuf,
            toolCalls,
          });

          textBuf = '';
          toolCalls = [];
          running = false;
          abortController = null;
          return;
        }

        case 'need_tool_result': {
          // The API says it wants to use tools, but we already emitted them.
          // This happens when the stream doesn't include tool_use in content_block_start.
          // Just emit the text accumulated so far.
          if (textBuf) {
            emitStreamEvent({
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: textBuf },
            });
          }
          break;
        }

        case 'error': {
          emitError(event.message || 'Unknown provider error');
          emit({ type: 'result', subtype: 'error', error: event.message });
          running = false;
          abortController = null;
          return;
        }
      }
    }

    // Stream ended without 'done' event
    if (running) {
      // Flush remaining text
      if (textBuf) {
        emit({ type: 'assistant', message: { content: [{ type: 'text', text: textBuf }] } });
        conversationHistory.push({ role: 'assistant', text: textBuf, toolCalls });
      }
      const tokens = { input: inputTokens, output: outputTokens };
      emit({ type: 'result', subtype: 'success', cost: estimateCost(config.model, inputTokens, outputTokens), tokens });
      running = false;
      abortController = null;
    }

  } catch (err) {
    emitError(err.message || String(err));
    emit({ type: 'result', subtype: 'error', error: err.message });
    running = false;
    abortController = null;
  }
}

// ─── Cost estimation ────────────────────────────────

const PRICES = {
  'claude-sonnet-4-6':       { input: 3, output: 15 },
  'claude-sonnet-4-20250514':{ input: 3, output: 15 },
  'claude-haiku-3-5-sonnet': { input: 0.8, output: 4 },
  'claude-opus-4-5':         { input: 15, output: 75 },
  'gpt-4o':                  { input: 2.5, output: 10 },
  'gpt-4o-mini':             { input: 0.15, output: 0.6 },
  'deepseek-chat':           { input: 0.14, output: 0.28 },
};

function estimateCost(model, inputTokens, outputTokens) {
  const p = PRICES[model] || { input: 3, output: 15 };
  return ((inputTokens * p.input) + (outputTokens * p.output)) / 1_000_000;
}

// ─── STDIN message handler ──────────────────────────

function handleMessage(msg) {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'configure': {
      config = { ...config, ...msg };
      emitSystem('init', { model: config.model, adapterVersion: '1.0.0' });
      break;
    }

    case 'user_message': {
      if (!msg.text?.trim()) break;
      conversationHistory.push({ role: 'user', content: msg.text });

      emit({ type: 'stream_event', event: {
        type: 'content_block_start', content_block: { type: 'text', text: '' },
      }});

      callProvider(async (toolCall) => {
        // This callback is invoked when the provider emits a tool_use.
        // The adapter pauses and waits for the plugin to send tool_result via stdin.
        // We use a promise + queue mechanism.
        return new Promise((resolve) => {
          pendingToolResult.resolve = resolve;
          pendingToolResult.toolUseId = toolCall.id;
        });
      }).catch(err => {
        emitError(err.message);
        emit({ type: 'result', subtype: 'error', error: err.message });
        running = false;
      });
      break;
    }

    case 'tool_result': {
      if (pendingToolResult.resolve) {
        conversationHistory.push({
          role: 'tool_result',
          toolUseId: msg.toolUseId || pendingToolResult.toolUseId,
          content: msg.content || '',
        });

        const resolve = pendingToolResult.resolve;
        pendingToolResult.resolve = null;
        pendingToolResult.toolUseId = null;
        resolve();

        // Resume the provider call
        if (!running) {
          callProvider(async (nextToolCall) => {
            return new Promise((resolve) => {
              pendingToolResult.resolve = resolve;
              pendingToolResult.toolUseId = nextToolCall.id;
            });
          }).catch(err => {
            emitError(err.message);
            running = false;
          });
        }
      }
      break;
    }

    case 'interrupt': {
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
      running = false;
      emit({ type: 'system', subtype: 'interrupt', text: 'Interrupted by user' });
      emit({ type: 'result', subtype: 'success', cost: 0, tokens: {} });
      break;
    }

    case 'reset': {
      conversationHistory = [];
      running = false;
      abortController = null;
      pendingToolResult = { resolve: null, toolUseId: null };
      emitSystem('interrupt', { text: 'Session reset' });
      break;
    }
  }
}

// ─── Pending tool result queue ──────────────────────

let pendingToolResult = { resolve: null, toolUseId: null };

// ─── STDIN setup ────────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  terminal: false,
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const msg = JSON.parse(trimmed);
    handleMessage(msg);
  } catch (err) {
    emitError(`Invalid JSON: ${err.message}`);
  }
});

rl.on('close', () => {
  process.exit(0);
});

// ─── Startup ────────────────────────────────────────

emitSystem('init', { model: 'waiting...', adapterVersion: '1.0.0' });
